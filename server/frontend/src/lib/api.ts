import axios from 'axios';
import { useAuthStore } from '@/store/auth-store';

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
        !window.location.pathname.startsWith('/register') &&
        !window.location.pathname.startsWith('/verify-email') &&
        !window.location.pathname.startsWith('/pair')
      ) {
        // Claim the redirect only once we know we're actually navigating —
        // so concurrent 401s see the flag and bail out, and 401s on auth
        // pages don't permanently disarm the interceptor.
        isRedirecting = true;
        // Clear both Zustand store and raw localStorage keys in one call
        useAuthStore.getState().logout();
        const data = error.response?.data;
        const isInactive = data?.error === 'User account is inactive';
        if (isInactive) {
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

export async function getChannelOperations(signal?: AbortSignal): Promise<ChannelOperationsData> {
  const response = await api.get<{ success: boolean; data: ChannelOperationsData }>(
    '/admin/stats/channel-operations',
    { signal },
  );
  return response.data.data;
}
