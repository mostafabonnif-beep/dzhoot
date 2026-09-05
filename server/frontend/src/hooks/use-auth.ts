'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import api from '@/lib/api';

export function useRequireAuth(requiredRole?: 'Admin' | 'User') {
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const [hydrated, setHydrated] = useState(false);
  const validated = useRef(false);

  useEffect(() => {
    if (hydrated) return;
    let active = true;
    const finishHydration = () => {
      if (active) setHydrated(true);
    };
    const persistApi = useAuthStore.persist;
    const unsub = persistApi?.onFinishHydration?.(finishHydration);

    if (persistApi?.hasHydrated?.()) {
      finishHydration();
    } else if (persistApi?.rehydrate) {
      void Promise.resolve(persistApi.rehydrate()).then(finishHydration, finishHydration);
    } else {
      finishHydration();
    }

    return () => {
      active = false;
      unsub?.();
    };
  }, [hydrated]);

  // Validate the session against the server once per mount. Credentials may be
  // in-memory (sessionId/accessToken after login) or purely cookie-based after
  // a reload (only `user` is persisted, the httpOnly cookie authenticates the
  // request). A 401 is handled by the api response interceptor (silent cookie
  // refresh, then logout + redirect).
  useEffect(() => {
    if (!hydrated || validated.current) return;
    if (!user) return;
    validated.current = true;
    const controller = new AbortController();
    api
      .get('/auth/me', { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        const serverUser = res.data?.user;
        if (serverUser && user) {
          const updates: Partial<typeof user> = {};
          if (serverUser.emailVerified !== user.emailVerified) {
            updates.emailVerified = serverUser.emailVerified;
          }
          if (serverUser.profilePicture !== user.profilePicture) {
            updates.profilePicture = serverUser.profilePicture;
          }
          if (Object.keys(updates).length > 0) {
            if (controller.signal.aborted) return;
            setUser({ ...user, ...updates });
          }
        }
      })
      .catch(() => {
        // 401 is handled by the response interceptor (calls logout + redirects)
      });
    return () => controller.abort();
  }, [hydrated, user, setUser]);

  useEffect(() => {
    if (!hydrated) return;
    // `user` presence decides the guard: after login it is set together with
    // the in-memory credential, and after a reload it is the persisted profile
    // while the httpOnly cookie authenticates API calls. Anything else gets
    // sent to the login page.
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.emailVerified === false) {
      router.replace('/verify-email');
      return;
    }
    if (requiredRole && user.role !== requiredRole) {
      router.replace(user.role === 'Admin' ? '/admin' : '/user');
      return;
    }
  }, [user, requiredRole, router, hydrated]);

  return {
    user,
    isAuthenticated: !!user && user.emailVerified !== false,
    isLoading: !hydrated,
  };
}
