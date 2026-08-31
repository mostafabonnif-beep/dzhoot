'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import api from '@/lib/api';

export function useRequireAuth(requiredRole?: 'Admin' | 'User') {
  const router = useRouter();
  const { user, sessionId, accessToken, setUser } = useAuthStore();
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

  useEffect(() => {
    if (!hydrated || validated.current) return;
    if (!user || (!sessionId && !accessToken)) return;
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
  }, [hydrated, user, sessionId, accessToken, setUser]);

  useEffect(() => {
    if (!hydrated) return;
    if (!user || (!sessionId && !accessToken)) {
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
  }, [user, sessionId, accessToken, requiredRole, router, hydrated]);

  return {
    user,
    isAuthenticated: !!user && (!!sessionId || !!accessToken) && user.emailVerified !== false,
    isLoading: !hydrated,
  };
}
