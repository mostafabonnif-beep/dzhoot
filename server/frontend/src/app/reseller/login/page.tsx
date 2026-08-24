'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Store, Loader2, Eye, EyeOff } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';
import { useToast } from '@/hooks/use-toast';

export default function ResellerLoginPage() {
  const { toast } = useToast();
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
      const res = await api.post('/reseller/auth/login', { username: username.trim(), password });
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
      toast('تم تسجيل الدخول بنجاح', 'success');
      router.push('/reseller');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr.response?.data?.error || 'تعذر تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4" dir="rtl">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <Store className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold">بوابة الموزعين — DZ HOOF</h1>
          <p className="text-sm text-muted-foreground mt-1">دخول المحلات وأصحاب الـ Panel</p>
        </div>
        <form
          onSubmit={handleLogin}
          className="border border-border bg-card p-6 space-y-4 shadow-sm"
        >
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              اسم المستخدم
            </label>
            <input
              className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              dir="ltr"
              autoComplete="username"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              كلمة المرور
            </label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                dir="ltr"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute inset-y-0 left-2 flex items-center text-muted-foreground"
                aria-label="إظهار كلمة المرور"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="w-full inline-flex items-center justify-center px-6 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'تسجيل الدخول'}
          </button>
        </form>
      </div>
    </div>
  );
}
