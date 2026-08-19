'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Copy, Check, Trash2, ShieldCheck, ShieldOff } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useLocale } from '@/components/locale-provider';

interface ServerInfo {
  name: string;
  version: string;
  status: string;
  features: Record<string, boolean>;
}

interface CacheEntry {
  key: string;
  cached: boolean;
  age?: number;
  count?: number;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const { t, locale } = useLocale();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [cacheStatus, setCacheStatus] = useState<CacheEntry[]>([]);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [totpLoading, setTotpLoading] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    return () => clearTimeout(copyTimeoutRef.current);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function fetchData() {
      try {
        const [infoRes, configRes, meRes] = await Promise.all([
          api.get('/config/info', { signal: controller.signal }).catch(() => null),
          api.get('/config/defaults', { signal: controller.signal }).catch(() => null),
          api.get('/auth/me', { signal: controller.signal }).catch(() => null),
        ]);
        if (meRes?.data?.user) setTotpEnabled(meRes.data.user.totpEnabled === true);
        if (infoRes) setInfo(infoRes.data.data || infoRes.data);
        const config = configRes?.data?.data || configRes?.data;
        if (config?.defaultTvCode) {
          setPlaylistUrl(
            `${window.location.origin}/api/v1/channels/playlist.m3u?code=${config.defaultTvCode}`,
          );
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'CanceledError')
          console.error('Failed to load settings data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    fetchCacheStatus();
    return () => controller.abort();
  }, []);

  async function fetchCacheStatus() {
    try {
      const res = await api.get('/iptv-org/cache-status');
      const data = res.data.data || res.data;
      if (Array.isArray(data)) {
        setCacheStatus(data);
      } else if (typeof data === 'object') {
        setCacheStatus(
          Object.entries(data).map(([key, val]) => ({
            key,
            ...(typeof val === 'object' && val !== null
              ? (val as { cached: boolean; age?: number; count?: number })
              : { cached: false }),
          })),
        );
      }
    } catch (err) {
      console.error('Failed to fetch cache status:', err);
    }
  }

  async function startTotpSetup() {
    setTotpLoading(true);
    try {
      const res = await api.post('/auth/2fa/setup');
      const data = res.data?.data || res.data;
      setTotpSetup({ secret: data.secret, uri: data.uri });
      setTotpCode('');
      toast('تم إنشاء إعداد 2FA. أكمل التأكيد من تطبيق المصادقة.', 'success');
    } catch {
      toast('تعذر بدء إعداد 2FA', 'error');
    } finally {
      setTotpLoading(false);
    }
  }

  async function confirmTotp() {
    setTotpLoading(true);
    try {
      await api.post('/auth/2fa/confirm', { token: totpCode });
      setTotpEnabled(true);
      setTotpSetup(null);
      setTotpCode('');
      toast('تم تفعيل المصادقة الثنائية بنجاح', 'success');
    } catch {
      toast('رمز 2FA غير صحيح أو منتهي', 'error');
    } finally {
      setTotpLoading(false);
    }
  }

  async function disableTotp() {
    setTotpLoading(true);
    try {
      await api.post('/auth/2fa/disable', { password: disablePassword, token: disableCode });
      setTotpEnabled(false);
      setDisablePassword('');
      setDisableCode('');
      toast('تم تعطيل المصادقة الثنائية', 'success');
    } catch {
      toast('تعذر تعطيل 2FA. تحقق من كلمة المرور والرمز.', 'error');
    } finally {
      setTotpLoading(false);
    }
  }

  async function handleClearCache() {
    setCacheLoading(true);
    try {
      await api.post('/iptv-org/clear-cache');
      await fetchCacheStatus();
    } catch {
      toast('Failed to clear cache', 'error');
    } finally {
      setCacheLoading(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(playlistUrl);
    setCopied(true);
    clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
  }

  function formatAge(ms?: number) {
    if (!ms) return '—';
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return '< 1 min';
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">{t('settings.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('settings.server')}</p>
      </div>

      {info && (
        <div className="border border-border">
          <div className="px-4 py-2 bg-muted/50 border-b border-border">
            <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
              {locale === 'ar' ? 'معلومات الخادم' : locale === 'fr' ? 'Informations du serveur' : 'Server info'}
            </h2>
          </div>
          <dl className="divide-y divide-border">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">{t('common.name')}</dt>
              <dd className="text-sm font-medium">{info.name}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">Version</dt>
              <dd className="text-sm font-medium">{info.version}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">{t('common.status')}</dt>
              <dd className="relative inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-signal-green" />
                <span className="text-sm font-medium capitalize">{info.status}</span>
              </dd>
            </div>
            {info.features && Object.keys(info.features).length > 0 && (
              <div className="px-4 py-3">
                <dt className="text-sm text-muted-foreground mb-2">Features</dt>
                <dd className="flex flex-wrap gap-2">
                  {Object.entries(info.features).map(([key, enabled]) => (
                    <span
                      key={key}
                      className={`text-xs uppercase tracking-[0.1em] px-2 py-1 border border-border ${enabled ? 'bg-muted/50' : 'bg-muted/20 line-through text-muted-foreground/50'}`}
                    >
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* Global M3U Playlist */}
      {playlistUrl && (
        <div className="border border-border">
          <div className="px-4 py-2 bg-muted/50 border-b border-border">
            <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
              {locale === 'ar' ? 'قائمة التشغيل العامة' : locale === 'fr' ? 'Playlist globale' : 'Global playlist'}
            </h2>
          </div>
          <div className="px-4 py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              M3U playlist URL containing all channels in the system.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-muted px-3 py-2 truncate border border-border">
                {playlistUrl}
              </code>
              <button
                onClick={handleCopy}
                aria-label="Copy to clipboard"
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors shrink-0"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-signal-green" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? t('common.copied') : t('common.copy')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Two-factor authentication */}
      <div className="border border-border">
        <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
          <div>
            <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">Two-factor authentication</h2>
            <p className="mt-1 text-xs text-muted-foreground">حماية إضافية لحسابات المشرفين عبر تطبيق Authenticator.</p>
          </div>
          {totpEnabled ? <ShieldCheck className="h-5 w-5 text-signal-green" /> : <ShieldOff className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div className="space-y-4 px-4 py-4">
          {totpEnabled ? (
            <>
              <div className="rounded-xl border border-signal-green/30 bg-signal-green/10 px-3 py-3 text-sm text-signal-green">
                2FA مفعّل على حساب المشرف الحالي.
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <input type="password" value={disablePassword} onChange={(event) => setDisablePassword(event.target.value)} placeholder="كلمة المرور الحالية" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" autoComplete="current-password" />
                <input inputMode="numeric" maxLength={8} value={disableCode} onChange={(event) => setDisableCode(event.target.value.replace(/\\D/g, ''))} placeholder="رمز 2FA الحالي" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" autoComplete="one-time-code" />
              </div>
              <button type="button" onClick={disableTotp} disabled={totpLoading || !disablePassword || disableCode.length < 6} className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-4 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50">
                {totpLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />} تعطيل 2FA
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">فعّل 2FA قبل إطلاق النسخة النهائية. استخدم تطبيقًا موثوقًا مثل Google Authenticator أو Aegis.</p>
              {!totpSetup ? (
                <button type="button" onClick={startTotpSetup} disabled={totpLoading} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {totpLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} بدء إعداد 2FA
                </button>
              ) : (
                <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                  <p className="text-sm font-medium">أضف الحساب إلى تطبيق المصادقة، ثم أدخل الرمز الظاهر حاليًا.</p>
                  <label className="block space-y-1.5 text-xs text-muted-foreground">
                    <span>URI الخاص بالتطبيق</span>
                    <textarea readOnly value={totpSetup.uri} className="min-h-20 w-full rounded-lg border border-border bg-background p-2 font-mono text-[11px]" />
                  </label>
                  <label className="block space-y-1.5 text-xs text-muted-foreground">
                    <span>المفتاح اليدوي الاحتياطي — احفظه في مدير أسرار</span>
                    <code className="block rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground">{totpSetup.secret}</code>
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input inputMode="numeric" maxLength={8} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\\D/g, ''))} placeholder="رمز 2FA من 6 أرقام" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" autoComplete="one-time-code" />
                    <button type="button" onClick={confirmTotp} disabled={totpLoading || totpCode.length < 6} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                      {totpLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} تأكيد وتفعيل
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Session Management */}
      <div className="border border-border">
        <div className="px-4 py-2 bg-muted/50 border-b border-border">
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            {locale === 'ar' ? 'إدارة الجلسات' : locale === 'fr' ? 'Gestion des sessions' : 'Session management'}
          </h2>
        </div>
        <div className="px-4 py-4 space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-3">
              Revoke all sessions except your current one. Other users and tabs will need to log in
              again.
            </p>
            <button
              onClick={async () => {
                try {
                  const res = await api.post('/auth/revoke-other-sessions');
                  toast(res.data.message || 'Other sessions revoked', 'success');
                } catch {
                  toast('Failed to revoke sessions', 'error');
                }
              }}
              className="inline-flex items-center px-4 py-2 text-sm font-medium border-2 border-destructive/40 bg-destructive/5 text-destructive shadow-sm transition-colors hover:bg-destructive/10 active:bg-destructive/15"
            >
              Revoke All Other Sessions
            </button>
          </div>
          <div className="border-t border-border pt-4">
            <p className="text-sm text-muted-foreground mb-3">
              Remove all expired sessions from the database.
            </p>
            <button
              onClick={async () => {
                try {
                  const res = await api.post('/auth/cleanup-sessions');
                  toast(res.data.message || 'Sessions cleaned up', 'success');
                } catch {
                  toast('Failed to clean up sessions', 'error');
                }
              }}
              className="inline-flex items-center px-4 py-2 text-sm font-medium border-2 border-border bg-card shadow-sm transition-colors hover:border-primary/40 active:bg-muted"
            >
              Clean Up Expired Sessions
            </button>
          </div>
        </div>
      </div>

      {/* IPTV-Org Cache Management */}
      <div className="border border-border">
        <div className="px-4 py-2 bg-muted/50 border-b border-border flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            {locale === 'ar' ? 'ذاكرة IPTV-Org المؤقتة' : locale === 'fr' ? 'Cache IPTV-Org' : 'IPTV-Org cache'}
          </h2>
          <button
            onClick={handleClearCache}
            disabled={cacheLoading}
            aria-label="Clear IPTV-Org cache"
            className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.1em] text-destructive hover:text-destructive/80 transition-colors font-medium disabled:opacity-50"
          >
            {cacheLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            {t('common.clear')}
          </button>
        </div>
        <div className="divide-y divide-border">
          {cacheStatus.length === 0 ? (
            <div className="px-4 py-4 text-sm text-muted-foreground">No cache data available</div>
          ) : (
            cacheStatus.map((entry) => (
              <div key={entry.key} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm capitalize">{entry.key}</span>
                <div className="flex items-center gap-3">
                  {entry.count !== undefined && (
                    <span className="text-xs text-muted-foreground">{entry.count} items</span>
                  )}
                  <span className="text-xs text-muted-foreground">{formatAge(entry.age)}</span>
                  <div className="relative inline-flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${entry.cached ? 'bg-signal-green' : 'bg-muted-foreground/30'}`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {entry.cached ? 'Cached' : 'Empty'}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
