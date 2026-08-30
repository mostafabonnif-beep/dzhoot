'use client';

import { Suspense, useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Tv, Check, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';
import { useLocale } from '@/components/locale-provider';

type PairState = 'loading' | 'no-pin' | 'needs-auth' | 'pairing' | 'success' | 'error';

function PairContent() {
  const searchParams = useSearchParams();
  const { user, isAuthenticated } = useAuthStore();
  const { t } = useLocale();
  const [state, setState] = useState<PairState>('loading');
  const [error, setError] = useState('');
  const [device, setDevice] = useState<{ name: string; model: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // Track which pin we've attempted to prevent double-fire but allow retry
  const attemptedPin = useRef<string | null>(null);

  // Get PIN from URL or sessionStorage fallback
  const urlPin = searchParams.get('pin');
  const pin =
    urlPin ||
    (typeof window !== 'undefined' ? sessionStorage.getItem('dzhoof-pairing-pin') : null);

  // Wait for Zustand hydration
  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAuthStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);

  const attemptPairing = useCallback((pinToUse: string) => {
    setState('pairing');
    setError('');

    api
      .post('/tv/pairing/confirm', { pin: pinToUse })
      .then((res) => {
        const data = res.data;
        setDevice(data.device || null);
        setState('success');
        // Clear stored PIN on success
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('dzhoof-pairing-pin');
        }
      })
      .catch((err) => {
        const msg = err.response?.data?.error || t('pair.errorFallback');
        setError(msg);
        setState('error');
      });
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    if (!pin) {
      setState('no-pin');
      return;
    }

    // Store PIN in sessionStorage for OAuth/redirect flows
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('dzhoof-pairing-pin', pin);
    }

    if (!isAuthenticated || !user) {
      setState('needs-auth');
      return;
    }

    // Prevent double-fire for the same pin
    if (attemptedPin.current === pin) return;
    attemptedPin.current = pin;

    attemptPairing(pin);
  }, [hydrated, pin, isAuthenticated, user, attemptPairing]);

  const handleRetry = useCallback(() => {
    if (!pin) return;
    attemptedPin.current = null;
    attemptPairing(pin);
  }, [pin, attemptPairing]);

  const redirectParam = pin ? encodeURIComponent(`/pair?pin=${pin}`) : '';

  if (!hydrated || state === 'loading') {
    return (
      <div className="text-center space-y-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
        <p className="text-sm text-muted-foreground">{t('pair.loading')}</p>
      </div>
    );
  }

  if (state === 'no-pin') {
    return (
      <div className="text-center space-y-4 max-w-sm">
        <div className="flex h-12 w-12 items-center justify-center border border-destructive/30 bg-destructive/10 mx-auto">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="text-lg font-display font-bold uppercase tracking-wider">{t('pair.noPinTitle')}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t('pair.noPinBody')}
        </p>
      </div>
    );
  }

  if (state === 'needs-auth') {
    return (
      <div className="text-center space-y-6 max-w-sm">
        <div className="flex h-12 w-12 items-center justify-center border border-primary/30 bg-primary/10 mx-auto">
          <Tv className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-display font-bold uppercase tracking-wider">{t('pair.title')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('pair.signInPrompt')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {t('pair.pinLabel')} <span className="font-mono font-medium text-foreground">{pin}</span>
          </p>
        </div>
        <div className="space-y-3">
          <Link
            href={`/login?redirect=${redirectParam}`}
            className="flex h-10 w-full items-center justify-center bg-primary text-sm font-semibold text-primary-foreground uppercase tracking-wider transition-colors hover:bg-primary/90"
          >
            {t('pair.signIn')}
          </Link>
          <Link
            href={`/register?redirect=${redirectParam}`}
            className="flex h-10 w-full items-center justify-center border border-border text-sm font-semibold uppercase tracking-wider transition-colors hover:bg-muted"
          >
            {t('pair.createAccount')}
          </Link>
        </div>
        <p className="text-xs text-muted-foreground/70">
          {t('pair.afterSignIn')}
        </p>
      </div>
    );
  }

  if (state === 'pairing') {
    return (
      <div className="text-center space-y-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
        <p className="text-sm text-muted-foreground">{t('pair.pairing')}</p>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="text-center space-y-4 max-w-sm">
        <div className="flex h-12 w-12 items-center justify-center border border-green-500/30 bg-green-500/10 mx-auto">
          <Check className="h-6 w-6 text-green-500" />
        </div>
        <h1 className="text-lg font-display font-bold uppercase tracking-wider">{t('pair.pairedTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('pair.pairedBody')}
          {device && (
            <span className="block mt-1 text-xs">
              {device.name} ({device.model})
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground/70">
          {t('pair.pairedClose')}
        </p>
        <Link
          href={user?.role === 'Admin' ? '/admin' : '/user'}
          className="inline-flex items-center px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90"
        >
          {t('pair.goDashboard')}
        </Link>
      </div>
    );
  }

  // error state
  return (
    <div className="text-center space-y-4 max-w-sm">
      <div className="flex h-12 w-12 items-center justify-center border border-destructive/30 bg-destructive/10 mx-auto">
        <AlertCircle className="h-6 w-6 text-destructive" />
      </div>
      <h1 className="text-lg font-display font-bold uppercase tracking-wider">{t('pair.failedTitle')}</h1>
      <div className="border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
        {error}
      </div>
      <button
        onClick={handleRetry}
        className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90"
      >
        <RefreshCw className="h-4 w-4" />
        {t('pair.tryAgain')}
      </button>
      <p className="text-sm text-muted-foreground">
        {t('pair.failedBody')}
      </p>
    </div>
  );
}

export default function PairPage() {
  return (
    <div className="h-screen supports-[height:100dvh]:h-dvh overflow-y-auto flex items-center justify-center px-6 bg-background">
      <Suspense
        fallback={
          <div className="text-center space-y-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
          </div>
        }
      >
        <PairContent />
      </Suspense>
    </div>
  );
}
