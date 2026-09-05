import axios from 'axios';
import { useAuthStore } from '@/store/auth-store';

/** Decode a JWT payload (base64url) without verification — used only to route
 * 401s to the right login (user/admin vs reseller portal). */
export function decodeTokenRole(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json?.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

const api = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach session ID or JWT token from Zustand store
api.interceptors.request.use((config) => {
  const { accessToken, sessionId } = useAuthStore.getState();

  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  } else if (sessionId) {
    config.headers['x-session-id'] = sessionId;
  }

  // Customer web player (/watch): a stored TV channel-list code authenticates
  // every API call (same contract as the Android TV app).
  if (typeof window !== 'undefined') {
    const tvCode = window.localStorage.getItem('watch_tv_code');
    if (tvCode) config.headers['X-TV-Code'] = tvCode;
  }

  return config;
});

// ---------------------------------------------------------------------------
// Silent cookie refresh (F11)
//
// After a reload the store only has `user` (persisted); sessionId/accessToken
// live in memory and are gone, so browser sessions authenticate purely via the
// httpOnly cookies (dzhoof_sid for DB sessions, dzhoof_refresh for JWT pairs).
// When such a cookie-only request 401s, try POST /jwt/refresh ONCE (no body —
// the server reads the refresh cookie), then replay the original request with
// the fresh access token. A failed refresh falls through to the normal
// logout+redirect handling below. Concurrent 401s share one in-flight refresh
// via the module-level promise; each caller replays its own request.
// ---------------------------------------------------------------------------

const PRE_AUTH_URLS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/logout',
  '/auth/verify-email',
  '/auth/resend-verification',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/oauth-exchange',
  '/reseller/auth/login',
  '/jwt/login',
  '/jwt/refresh',
]);

/** Request URL (path only, without query string), relative to the /api/v1 base. */
function requestPath(config: { url?: string } | undefined): string {
  const raw = String(config?.url || '');
  const queryAt = raw.indexOf('?');
  return queryAt === -1 ? raw : raw.slice(0, queryAt);
}

/** Pre-auth endpoints must never trigger a refresh (bad credentials, flows the
 * server explicitly rejected). */
function isPreAuthRequest(config: { url?: string } | undefined): boolean {
  const path = requestPath(config);
  if (PRE_AUTH_URLS.has(path)) return true;
  // Public, unauthenticated surfaces never refresh either.
  return path.startsWith('/config/') || path.startsWith('/public/') || path.startsWith('/oauth/');
}

async function performRefresh(): Promise<string> {
  // No body: the server reads the httpOnly dzhoof_refresh cookie.
  const resp = await api.post('/jwt/refresh', null, {
    headers: { 'X-Skip-Auth-Redirect': '1' },
  });
  const data = resp.data as { accessToken?: unknown; refreshToken?: unknown; user?: unknown };
  if (typeof data?.accessToken !== 'string' || !data.accessToken) {
    throw new Error('Refresh response missing accessToken');
  }
  const current = useAuthStore.getState();
  type StoreUser = ReturnType<typeof useAuthStore.getState>['user'];
  useAuthStore.setState({
    accessToken: data.accessToken,
    refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : current.refreshToken,
    user: (data.user as StoreUser | null | undefined) ?? current.user,
    isAuthenticated: current.isAuthenticated || !!current.user,
  });
  return data.accessToken;
}

let refreshingPromise: Promise<string> | null = null;

/** Shared, deduped refresh — concurrent 401s await the same in-flight request. */
function getRefreshing(): Promise<string> {
  if (!refreshingPromise) {
    refreshingPromise = performRefresh().finally(() => {
      refreshingPromise = null;
    });
  }
  return refreshingPromise;
}

// Response interceptor: handle 401 (unauthorized)
let isRedirecting = false;
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && !isRedirecting) {
      // Skip redirect for fire-and-forget requests (e.g. report-play)
      if (error.config?.headers?.['X-Skip-Auth-Redirect']) {
        return Promise.reject(error);
      }

      const state = useAuthStore.getState();
      // Cookie-only session (no in-memory credential after a reload) and the
      // failed request is not itself an auth flow → try one silent refresh.
      // `_refreshed` caps it at a single retry so we can never loop.
      if (
        !state.accessToken &&
        !state.sessionId &&
        !error.config?._refreshed &&
        !isPreAuthRequest(error.config)
      ) {
        try {
          await getRefreshing();
          const retryConfig = { ...error.config, _refreshed: true };
          return await api.request(retryConfig);
        } catch {
          // Refresh failed (no refresh cookie, revoked, network…). Fall
          // through to the normal logout + redirect handling below.
        }
      }

      // Skip redirect if already on auth pages
      if (
        typeof window !== 'undefined' &&
        !window.location.pathname.startsWith('/login') &&
        !window.location.pathname.startsWith('/reseller/login') &&
        !window.location.pathname.startsWith('/register') &&
        !window.location.pathname.startsWith('/verify-email') &&
        !window.location.pathname.startsWith('/pair')
      ) {
        // Claim the redirect only once we know we're actually navigating —
        // so concurrent 401s see the flag and bail out, and 401s on auth
        // pages don't permanently disarm the interceptor.
        isRedirecting = true;
        // Resellers carry a JWT with role 'reseller' — send them to the
        // reseller login, never the user/admin login (their portal shares
        // the same store, so the token alone can't tell the two apart).
        const tokenRole = decodeTokenRole(useAuthStore.getState().accessToken);
        const onResellerPath = window.location.pathname.startsWith('/reseller');
        const isReseller = tokenRole === 'reseller' || onResellerPath;
        // Clear both Zustand store and raw localStorage keys in one call
        useAuthStore.getState().logout();
        const data = error.response?.data;
        const isInactive = data?.error === 'User account is inactive';
        if (isReseller) {
          // Same intentional pattern as the /login redirect below: this
          // interceptor runs outside React components, so no router hook.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = '/reseller/login';
        } else if (isInactive) {
          const email = data?.adminEmail;
          window.location.href = email
            ? `/login?message=account_disabled&admin_email=${encodeURIComponent(email)}`
            : '/login?message=account_disabled';
        } else {
          // This interceptor runs outside React components, so a router hook is
          // unavailable; replace performs the same full navigation safely.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = '/login';
        }
        // No timeout reset — module reloads on navigation, resetting isRedirecting naturally
      }
    }
    return Promise.reject(error);
  },
);

export default api;


export interface ChannelOperationsSource {
  _id: string;
  name: string;
  status: 'Active' | 'Inactive';
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncAt?: string | null;
  lastError?: string | null;
  stats?: Record<string, number>;
  updatedAt?: string;
}

export interface ChannelOperationsData {
  channels: {
    total: number;
    active: number;
    healthy: number;
    failing: number;
    unknown: number;
    withFallback: number;
    avgResponseTime: number | null;
  };
  sources: {
    m3u: ChannelOperationsSource[];
    xtream: ChannelOperationsSource[];
  };
  identities: {
    total: number;
    multiSource: number;
    lowConfidence: number;
    lastReconciledAt: string | null;
  };
  epg: {
    totalPrograms: number;
    channelsWithEpg: number;
    totalSystemChannels: number;
    lastRefreshedAt: string | null;
    nextRefreshAt: string | null;
    sourcesDiscovered: number;
    refreshInProgress: boolean;
    lastRefreshDurationMs: number;
    lastRefreshProgramCount: number;
    lastRefreshErrorCount: number;
    lastRefreshErrorSources: string[];
  };
  generatedAt: string;
}

export interface EpgCoverageData {
  totalSystemChannels: number;
  matchedSystemChannels: number;
  overallCoveragePercent: number;
  unmatchedChannelCount: number;
  sources: Array<{
    source: string;
    coveredChannelCount: number;
    matchedChannelCount: number;
    coveragePercent: number;
    unmatchedChannels: Array<{ channelId: string; name: string; tvgId: string | null }>;
  }>;
}

export interface PlaybackQualityData {
  windowDays: number;
  summary: {
    totalEvents: number;
    startupSuccesses: number;
    startupFailures: number;
    startupSuccessRate: number | null;
    avgStartupMs: number | null;
    avgRebufferCount: number;
    fallbackAttempts: number;
    fallbackSuccesses: number;
    fallbackSuccessRate: number | null;
  };
  daily: Array<{
    date: string;
    totalEvents: number;
    startupSuccesses: number;
    startupFailures: number;
    startupSuccessRate: number | null;
    avgStartupMs: number | null;
    avgRebufferCount: number;
    fallbackAttempts: number;
    fallbackSuccesses: number;
  }>;
  topErrors: Array<{ errorCode: string; count: number }>;
}

export async function getPlaybackQuality(signal?: AbortSignal): Promise<PlaybackQualityData> {
  const response = await api.get<{ success: boolean; data: PlaybackQualityData }>(
    '/admin/stats/playback-quality?days=7',
    { signal },
  );
  return response.data.data;
}

export async function getEpgCoverage(signal?: AbortSignal): Promise<EpgCoverageData> {
  const response = await api.get<{ success: boolean; data: EpgCoverageData }>(
    '/admin/stats/epg-coverage',
    { signal },
  );
  return response.data.data;
}

export async function getChannelOperations(signal?: AbortSignal): Promise<ChannelOperationsData> {
  const response = await api.get<{ success: boolean; data: ChannelOperationsData }>(
    '/admin/stats/channel-operations',
    { signal },
  );
  return response.data.data;
}
