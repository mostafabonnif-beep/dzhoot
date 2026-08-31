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
