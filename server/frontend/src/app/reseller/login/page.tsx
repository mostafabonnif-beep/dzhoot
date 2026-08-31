'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Store, Loader2, Eye, EyeOff } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';
import { useToast } from '@/hooks/use-toast';
import { useLocale } from '@/components/locale-provider';

export default function ResellerLoginPage() {
  const { toast } = useToast();
  const { t } = useLocale();
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);
  const logout = useAuthStore((s) => s.logout);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      // Wrong credentials return 401 — skip the interceptor redirect so the
      // error message below actually shows instead of a page reload.
      const res = await api.post(
        '/reseller/auth/login',
        { username: username.trim(), password },
        { headers: { 'X-Skip-Auth-Redirect': '1' } },
      );
      const data = res.data?.data;
      if (!data?.token) throw new Error('no token');
      // Clear any admin session, then store the reseller JWT (api client sends Bearer)
      logout();
      setTokens(
        {
          id: data.reseller._id,
          username: data.reseller.name,
          email: '',
          role: 'User',
          channelListCode: undefined,
        } as never,
        data.token,
        '',
      );
      toast(t('portal.loginSuccess'), 'success');
      router.push('/reseller');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr.response?.data?.error || t('portal.loginError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-screen supports-[height:100dvh]:h-dvh overflow-y-auto flex items-center justify-center bg-background px-4" dir="rtl">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <Store className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold">{t('portal.loginTitle')}</h1>
        </div>
        <form
          onSubmit={handleLogin}
          className="border border-border bg-card p-6 space-y-4"
        >
          {error && (
            <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('portal.username')}
            </label>
            <input
              className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              dir="ltr"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('portal.password')}
            </label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute inset-y-0 left-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                aria-label="show/hide"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="inline-flex w-full items-center justify-center gap-2 h-10 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('portal.login')}
          </button>
        </form>
      </div>
    </div>
  );
}
