import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  username: string;
  email: string;
  role: 'Admin' | 'User';
  channelListCode?: string;
  emailVerified?: boolean;
  profilePicture?: string;
}

interface AuthState {
  user: User | null;
  sessionId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setUser: (user: User) => void;
  setSession: (user: User, sessionId: string) => void;
  setTokens: (user: User, accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      sessionId: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setUser: (user) => set({ user }),

      setSession: (user, sessionId) => {
        set({ user, sessionId, isAuthenticated: true });
      },

      setTokens: (user, accessToken, refreshToken) => {
        set({ user, accessToken, refreshToken, isAuthenticated: true });
      },

      logout: () => {
        const { user, sessionId, accessToken } = get();
        // Best-effort server-side logout: the backend deletes the DB session
        // and clears the httpOnly cookies (dzhoof_sid / dzhoof_refresh).
        // Fire-and-forget on purpose — the store must clear even when the
        // network call fails or the user is already signed out server-side.
        //
        // Deliberately uses raw fetch, NOT the shared api client:
        //  - no import cycle (api.ts imports this store)
        //  - the axios 401 interceptor can never fire for this call
        //    (the X-Skip-Auth-Redirect header is kept as a belt-and-braces
        //    marker for anything that inspects the request)
        //  - keepalive lets the request finish across navigation
        if (user || sessionId || accessToken) {
          const headers: Record<string, string> = { 'X-Skip-Auth-Redirect': '1' };
          if (accessToken) {
            headers.Authorization = `Bearer ${accessToken}`;
          } else if (sessionId) {
            headers['x-session-id'] = sessionId;
          }
          void fetch('/api/v1/auth/logout', {
            method: 'POST',
            headers,
            credentials: 'same-origin',
            keepalive: true,
          }).catch(() => {
            // network failure — nothing else to do, state clears regardless
          });
        }
        set({
          user: null,
          sessionId: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        });
      },
    }),
    {
      name: 'dzhoof-auth',
      // F11: web credentials (sessionId/accessToken/refreshToken) must NEVER
      // touch localStorage. Only the non-sensitive user profile is persisted,
      // so a reload restores the UI shell while every API call authenticates
      // via the httpOnly cookies the backend set at login. sessionId and the
      // JWT pair live in memory for the lifetime of the tab only.
      partialize: (state) => ({
        user: state.user,
      }),
      // Migration guard: pre-F11 storage blobs (or any tampered storage) may
      // still contain sessionId/accessToken/isAuthenticated. Never merge those
      // into memory — keep only the user profile.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { user?: User | null };
        return { ...current, user: p.user ?? null };
      },
      onRehydrateStorage: () => (state) => {
        // Rewrite the storage entry with the sanitized shape ({user} only) so
        // legacy credentials are scrubbed from localStorage immediately.
        if (state) {
          useAuthStore.setState({ user: useAuthStore.getState().user });
        }
      },
    },
  ),
);
