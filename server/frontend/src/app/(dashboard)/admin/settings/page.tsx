'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Copy, Check, Trash2, ShieldCheck, ShieldOff, Download, Upload, BellRing, Mail, KeyRound } from 'lucide-react';
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
  const [settingsBusy, setSettingsBusy] = useState(false);
  // Change-password (admins have no other self-service path — /user is User-only).
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [brevoConfigured, setBrevoConfigured] = useState(false);
  const [alertWebhook, setAlertWebhook] = useState('');
  const [brevoUser, setBrevoUser] = useState('');
  const [brevoPass, setBrevoPass] = useState('');
  const [mailFrom, setMailFrom] = useState('');
  const [codeExpiryDays, setCodeExpiryDays] = useState('30');
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertTesting, setAlertTesting] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    return () => clearTimeout(copyTimeoutRef.current);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function fetchData() {
      try {
        const [infoRes, configRes, meRes, appSettingsRes] = await Promise.all([
          api.get('/config/info', { signal: controller.signal }).catch(() => null),
          api.get('/config/defaults', { signal: controller.signal }).catch(() => null),
          api.get('/auth/me', { signal: controller.signal }).catch(() => null),
          api.get('/admin/app-settings', { signal: controller.signal }).catch(() => null),
        ]);
        const appSettings = appSettingsRes?.data?.data || {};
        if (appSettings.alert_webhook_url !== undefined) setAlertWebhook(String(appSettings.alert_webhook_url));
        if (appSettings.brevo_user !== undefined) setBrevoUser(String(appSettings.brevo_user));
        // The API never returns the SMTP password — only whether it's set.
        setBrevoConfigured(appSettings.brevo_configured === true);
        setBrevoPass('');
        if (appSettings.mail_from !== undefined) setMailFrom(String(appSettings.mail_from));
        if (appSettings.code_expiry_days !== undefined) setCodeExpiryDays(String(appSettings.code_expiry_days));
        if (meRes?.data?.user) setTotpEnabled(meRes.data.user.totpEnabled === true);
        if (infoRes) setInfo(infoRes.data.data || infoRes.data);
        const config = configRes?.data?.data || configRes?.data;
        if (config?.defaultTvCode) {
          // The legacy /api/v1/channels/playlist.m3u endpoint is 410-gated;
          // the canonical public playlist is the TV route (same as dashboard).
          setPlaylistUrl(
            `${window.location.origin}/api/v1/tv/playlist/${encodeURIComponent(config.defaultTvCode)}`,
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

  async function changeAdminPassword() {
    if (pwNew.length < 8) {
      toast('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل', 'error');
      return;
    }
    if (pwNew !== pwConfirm) {
      toast('كلمتا المرور غير متطابقتين', 'error');
      return;
    }
    setPwLoading(true);
    try {
      // Wrong current password returns 401 — the interceptor would otherwise
      // treat it as session expiry and log the admin out.
      const res = await api.post(
        '/auth/change-password',
        { currentPassword: pwCurrent, newPassword: pwNew },
        { headers: { 'X-Skip-Auth-Redirect': '1' } },
      );
      toast(res.data?.message || 'تم تغيير كلمة المرور بنجاح', 'success');
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || 'فشل تغيير كلمة المرور', 'error');
    } finally {
      setPwLoading(false);
    }
  }

  async function handleExportSettings() {
    setSettingsBusy(true);
    try {
      const res = await api.get('/admin/app-settings/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `dzhoot-settings-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast(
        locale === 'ar' ? 'تم تصدير الإعدادات' : locale === 'fr' ? 'Paramètres exportés' : 'Settings exported',
        'success',
      );
    } catch {
      toast(locale === 'ar' ? 'فشل تصدير الإعدادات' : 'Export failed', 'error');
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleImportSettingsFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so picking the same file twice still fires onChange.
    e.target.value = '';
    if (!file) return;
    if (
      !window.confirm(
        locale === 'ar'
          ? 'تأكيد: استيراد الإعدادات من هذا الملف سيستبدل القيم الحالية للمفاتيح المعروفة. متابعة؟'
          : locale === 'fr'
            ? 'Confirmer : importer remplacera les valeurs actuelles. Continuer ?'
            : 'Confirm: importing will overwrite current known settings. Continue?',
      )
    ) {
      return;
    }
    setSettingsBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await api.post('/admin/app-settings/import', parsed);
      const keys = res.data?.importedKeys || [];
      toast(
        locale === 'ar'
          ? `تم استيراد ${keys.length} إعداداً: ${keys.join('، ')}`
          : `Imported ${keys.length} settings`,
        'success',
      );
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (locale === 'ar' ? 'فشل الاستيراد — تحقق من صيغة الملف' : 'Import failed');
      toast(msg, 'error');
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleClearCache() {
    const confirmed = window.confirm(
      locale === 'ar'
        ? 'سيتم مسح جميع بيانات IPTV-Org المخزنة مؤقتًا (القوائم وحالة البث). يستغرق إعادة جلبها وقتًا. هل تريد المتابعة؟'
        : locale === 'fr'
          ? 'Toutes les données mises en cache d’IPTV-Org (listes et état des flux) seront effacées. Leur récupération prend du temps. Continuer ?'
          : 'All cached IPTV-Org data (playlists and liveness state) will be cleared. Refetching takes time. Continue?',
    );
    if (!confirmed) return;
    setCacheLoading(true);
    try {
      await api.post('/iptv-org/clear-cache');
      await fetchCacheStatus();
      toast(
        locale === 'ar'
          ? 'تم مسح ذاكرة التخزين المؤقت'
          : locale === 'fr'
            ? 'Cache vidé'
            : 'Cache cleared',
        'success',
      );
    } catch {
      toast('فشل مسح ذاكرة التخزين المؤقت', 'error');
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
    if (mins < 1)
      return locale === 'ar' ? 'أقل من دقيقة' : locale === 'fr' ? "< 1 min" : '< 1 min';
    if (mins < 60)
      return locale === 'ar' ? `${mins} دقيقة` : locale === 'fr' ? `${mins} min` : `${mins} min`;
    return locale === 'ar'
      ? `${Math.floor(mins / 60)} س و${mins % 60} د`
      : `${Math.floor(mins / 60)}h ${mins % 60}m`;
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
              <dt className="text-sm text-muted-foreground">الإصدار</dt>
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
                <dt className="text-sm text-muted-foreground mb-2">الميزات</dt>
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
              {locale === 'ar'
                ? 'رابط قائمة تشغيل M3U يحتوي على جميع قنوات النظام.'
                : locale === 'fr'
                  ? 'URL de la playlist M3U contenant toutes les chaînes du système.'
                  : 'M3U playlist URL containing all channels in the system.'}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-muted px-3 py-2 truncate border border-border">
                {playlistUrl}
              </code>
              <button
                onClick={handleCopy}
                aria-label={
                  locale === 'ar'
                    ? 'نسخ إلى الحافظة'
                    : locale === 'fr'
                      ? 'Copier dans le presse-papiers'
                      : 'Copy to clipboard'
                }
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
            <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">المصادقة الثنائية</h2>
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
                <input inputMode="numeric" maxLength={8} value={disableCode} onChange={(event) => setDisableCode(event.target.value.replace(/\D/g, ''))} placeholder="رمز 2FA الحالي" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" autoComplete="one-time-code" />
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
                    <input inputMode="numeric" maxLength={8} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))} placeholder="رمز 2FA من 6 أرقام" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" autoComplete="one-time-code" />
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

      {/* Change password (admin self-service rotation) */}
      <div className="border border-border">
        <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
          <div>
            <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">تغيير كلمة المرور</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              غيّر كلمة مرور حساب المشرف الحالي. تُسجَّل الخروج من جميع الجلسات الأخرى تلقائيًا.
            </p>
          </div>
          <KeyRound className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="grid gap-3 md:grid-cols-3">
            <input type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} placeholder="كلمة المرور الحالية" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" autoComplete="current-password" />
            <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} placeholder="كلمة المرور الجديدة (8+ أحرف)" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" autoComplete="new-password" />
            <input type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} placeholder="تأكيد كلمة المرور الجديدة" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" autoComplete="new-password" />
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={changeAdminPassword} disabled={pwLoading || !pwCurrent || !pwNew || !pwConfirm} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {pwLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} تغيير كلمة المرور
            </button>
          </div>
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
              {locale === 'ar'
                ? 'إلغاء جميع الجلسات باستثناء جلستك الحالية. سيُطلب من المستخدمين والتبويبات الأخرى تسجيل الدخول مجددًا.'
                : locale === 'fr'
                  ? 'Révoquer toutes les sessions sauf la vôtre. Les autres utilisateurs et onglets devront se reconnecter.'
                  : 'Revoke all sessions except your current one. Other users and tabs will need to log in again.'}
            </p>
            <button
              onClick={async () => {
                const confirmed = window.confirm(
                  locale === 'ar'
                    ? 'سيتم تسجيل خروج جميع المستخدمين والتبويبات الأخرى من لوحة التحكم. هل تريد المتابعة؟'
                    : locale === 'fr'
                      ? 'Tous les autres utilisateurs et onglets seront déconnectés du panneau d’administration. Continuer ?'
                      : 'All other users and tabs will be logged out of the admin panel. Continue?',
                );
                if (!confirmed) return;
                try {
                  const res = await api.post('/auth/revoke-other-sessions');
                  toast(
                    res.data.message ||
                      (locale === 'ar'
                        ? 'تم إلغاء الجلسات الأخرى'
                        : locale === 'fr'
                          ? 'Sessions révoquées'
                          : 'Other sessions revoked'),
                    'success',
                  );
                } catch {
                  toast('فشل إلغاء الجلسات', 'error');
                }
              }}
              className="inline-flex items-center px-4 py-2 text-sm font-medium border-2 border-destructive/40 bg-destructive/5 text-destructive shadow-sm transition-colors hover:bg-destructive/10 active:bg-destructive/15"
            >
              {locale === 'ar'
                ? 'إلغاء الجلسات الأخرى'
                : locale === 'fr'
                  ? 'Révoquer les autres sessions'
                  : 'Revoke All Other Sessions'}
            </button>
          </div>
          <div className="border-t border-border pt-4">
            <p className="text-sm text-muted-foreground mb-3">
              {locale === 'ar'
                ? 'حذف جميع الجلسات المنتهية من قاعدة البيانات.'
                : locale === 'fr'
                  ? 'Supprimer toutes les sessions expirées de la base de données.'
                  : 'Remove all expired sessions from the database.'}
            </p>
            <button
              onClick={async () => {
                const confirmed = window.confirm(
                  locale === 'ar'
                    ? 'سيتم حذف جميع الجلسات المنتهية نهائيًا. هل تريد المتابعة؟'
                    : locale === 'fr'
                      ? 'Toutes les sessions expirées seront supprimées définitivement. Continuer ?'
                      : 'All expired sessions will be permanently removed. Continue?',
                );
                if (!confirmed) return;
                try {
                  const res = await api.post('/auth/cleanup-sessions');
                  toast(
                    res.data.message ||
                      (locale === 'ar'
                        ? 'تم تنظيف الجلسات'
                        : locale === 'fr'
                          ? 'Sessions nettoyées'
                          : 'Sessions cleaned up'),
                    'success',
                  );
                } catch {
                  toast('فشل تنظيف الجلسات', 'error');
                }
              }}
              className="inline-flex items-center px-4 py-2 text-sm font-medium border-2 border-border bg-card shadow-sm transition-colors hover:border-primary/40 active:bg-muted"
            >
              {locale === 'ar'
                ? 'تنظيف الجلسات المنتهية'
                : locale === 'fr'
                  ? 'Nettoyer les sessions expirées'
                  : 'Clean Up Expired Sessions'}
            </button>
          </div>
        </div>
      </div>

      {/* App Settings Backup (export / import) */}
      <div className="border border-border">
        <div className="px-4 py-2 bg-muted/50 border-b border-border">
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            {locale === 'ar'
              ? 'نسخ الإعدادات الاحتياطي'
              : locale === 'fr'
                ? 'Sauvegarde des paramètres'
                : 'Settings backup'}
          </h2>
        </div>
        <div className="px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {locale === 'ar'
              ? 'صدّر إعدادات التطبيق (الصفحة الرئيسية، شرط الاشتراك) إلى ملف JSON، أو استعدها من نسخة سابقة. حالات إيقاف المهام المجدولة لا تُصدَّر.'
              : locale === 'fr'
                ? 'Exportez les paramètres (accueil, abonnement requis) en JSON ou restaurez-les.'
                : 'Export app settings (home, subscription requirement) to JSON, or restore from a backup.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportSettings}
              disabled={settingsBusy}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-2 border-border bg-card shadow-sm transition-colors hover:border-primary/40 active:bg-muted disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {locale === 'ar' ? 'تصدير' : locale === 'fr' ? 'Exporter' : 'Export'}
            </button>
            <button
              type="button"
              onClick={() => importFileRef.current?.click()}
              disabled={settingsBusy}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-2 border-border bg-card shadow-sm transition-colors hover:border-primary/40 active:bg-muted disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {locale === 'ar' ? 'استيراد' : locale === 'fr' ? 'Importer' : 'Import'}
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportSettingsFile}
            />
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
            aria-label={
              locale === 'ar'
                ? 'مسح ذاكرة IPTV-Org المؤقتة'
                : locale === 'fr'
                  ? 'Vider le cache IPTV-Org'
                  : 'Clear IPTV-Org cache'
            }
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
            <div className="px-4 py-4 text-sm text-muted-foreground">لا توجد بيانات ذاكرة تخزين مؤقت</div>
          ) : (
            cacheStatus.map((entry) => (
              <div key={entry.key} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm capitalize">{entry.key}</span>
                <div className="flex items-center gap-3">
                  {entry.count !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      {entry.count}{' '}
                      {locale === 'ar'
                        ? 'عنصر'
                        : locale === 'fr'
                          ? 'éléments'
                          : 'items'}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">{formatAge(entry.age)}</span>
                  <div className="relative inline-flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${entry.cached ? 'bg-signal-green' : 'bg-muted-foreground/30'}`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {entry.cached
                        ? locale === 'ar'
                          ? 'مخزّنة'
                          : locale === 'fr'
                            ? 'En cache'
                            : 'Cached'
                        : locale === 'ar'
                          ? 'فارغة'
                          : locale === 'fr'
                            ? 'Vide'
                            : 'Empty'}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {/* Alerts & notifications (webhook + SMTP) */}
      <div className="border border-border">
        <div className="px-4 py-2 bg-muted/50 border-b border-border">
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            {locale === 'ar' ? 'التنبيهات والإشعارات' : locale === 'fr' ? 'Alertes et notifications' : 'Alerts & notifications'}
          </h2>
        </div>
        <div className="px-4 py-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            {locale === 'ar'
              ? 'رابط الـ webhook (مثل Discord/Slack) يُرسَل إليه كل تنبيه تشغيلي (فشل مزامنة، انقطاع بث…). بيانات Brevo لتفعيل البريد (تقارير يومية وتنبيهات انتهاء الاشتراك). تُحفظ في القاعدة ولا تُعرض كاملة بعد الحفظ.'
              : locale === 'fr'
                ? 'L\'URL du webhook (Discord/Slack…) reçoit chaque alerte opérationnelle. Les identifiants Brevo activent l\'e-mail (rapports quotidiens, alertes d\'expiration).'
                : 'Webhook URL (Discord/Slack…) receives every operational alert. Brevo credentials enable email (daily reports, expiry alerts).'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Webhook URL</label>
              <input
                dir="ltr"
                className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm"
                placeholder="https://discord.com/api/webhooks/…"
                value={alertWebhook}
                onChange={(e) => setAlertWebhook(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Brevo SMTP — المستخدم</label>
              <input
                dir="ltr"
                className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm"
                placeholder="login"
                value={brevoUser}
                onChange={(e) => setBrevoUser(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Brevo SMTP — كلمة المرور</label>
              <input
                dir="ltr"
                type="password"
                className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm"
                placeholder={brevoConfigured ? '•••••••• (اتركه فارغًا للإبقاء عليه)' : 'لم تُضبط بعد'}
                value={brevoPass}
                onChange={(e) => setBrevoPass(e.target.value)}
              />
              {brevoConfigured ? (
                <p className="text-xs text-signal-green">✓ كلمة المرور مضبوطة — اترك الحقل فارغًا عند الحفظ للإبقاء عليها.</p>
              ) : null}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">بريد المُرسِل (MAIL_FROM)</label>
              <input
                dir="ltr"
                className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm"
                placeholder="no-reply@yourdomain.com"
                value={mailFrom}
                onChange={(e) => setMailFrom(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={async () => {
                setAlertSaving(true);
                try {
                  const payload: Record<string, unknown> = {
                    alert_webhook_url: alertWebhook,
                    brevo_user: brevoUser,
                    mail_from: mailFrom,
                  };
                  if (brevoPass) payload.brevo_password = brevoPass;
                  await api.put('/admin/app-settings', payload);
                  const newlySet = Boolean(brevoPass);
                  setBrevoPass('');
                  // Configured stays true if it was already set and we kept it.
                  setBrevoConfigured((prev) => prev || newlySet);
                  toast(locale === 'ar' ? 'تم حفظ إعدادات التنبيهات' : locale === 'fr' ? 'Alertes enregistrées' : 'Alert settings saved', 'success');
                } catch {
                  toast(locale === 'ar' ? 'فشل حفظ الإعدادات' : 'Échec de l\'enregistrement', 'error');
                } finally {
                  setAlertSaving(false);
                }
              }}
              disabled={alertSaving}
              className="inline-flex items-center px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {alertSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {locale === 'ar' ? 'حفظ الإعدادات' : locale === 'fr' ? 'Enregistrer' : 'Save settings'}
            </button>
            <button
              onClick={async () => {
                setAlertTesting(true);
                try {
                  await api.post('/admin/app-settings/test-alert');
                  toast(locale === 'ar' ? 'أُرسل تنبيه تجريبي بنجاح ✓' : 'Alerte test envoyée ✓', 'success');
                } catch (err) {
                  toast((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'فشل إرسال التنبيه', 'error');
                } finally {
                  setAlertTesting(false);
                }
              }}
              disabled={alertTesting}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-2 border-border bg-card hover:border-primary/40 disabled:opacity-50"
            >
              {alertTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
              {locale === 'ar' ? 'إرسال تنبيه تجريبي' : locale === 'fr' ? 'Alerte test' : 'Send test alert'}
            </button>
            <button
              onClick={async () => {
                setEmailTesting(true);
                try {
                  const res = await api.post('/admin/app-settings/test-email');
                  toast(`${locale === 'ar' ? 'أُرسل بريد تجريبي إلى' : 'E-mail test envoyé à'} ${res.data?.data?.to || ''} ✓`, 'success');
                } catch (err) {
                  toast((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'فشل إرسال البريد', 'error');
                } finally {
                  setEmailTesting(false);
                }
              }}
              disabled={emailTesting}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-2 border-border bg-card hover:border-primary/40 disabled:opacity-50"
            >
              {emailTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {locale === 'ar' ? 'إرسال بريد تجريبي' : locale === 'fr' ? 'E-mail test' : 'Send test email'}
            </button>
          </div>
        </div>
      </div>

      {/* Code expiry window */}
      <div className="border border-border">
        <div className="px-4 py-2 bg-muted/50 border-b border-border">
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            {locale === 'ar' ? 'صلاحية أكواد الموزعين' : locale === 'fr' ? 'Validité des codes' : 'Reseller code expiry'}
          </h2>
        </div>
        <div className="px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {locale === 'ar'
              ? 'عدد الأيام قبل انتهاء الكود غير المُفعَّل تلقائيًا وإعادة رصيده للموزع. الأكواد الجديدة فقط.'
              : locale === 'fr'
                ? 'Jours avant expiration automatique des codes inutilisés et retour du crédit au revendeur.'
                : 'Days before unused codes expire automatically and credit returns to the reseller.'}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              className="flex h-10 w-28 border border-border bg-background px-3 py-2 text-sm"
              value={codeExpiryDays}
              onChange={(e) => setCodeExpiryDays(e.target.value)}
            />
            <button
              onClick={async () => {
                setSettingsBusy(true);
                try {
                  await api.put('/admin/app-settings', { code_expiry_days: Number(codeExpiryDays) || 30 });
                  toast(locale === 'ar' ? 'تم حفظ مدة الصلاحية' : 'Validité enregistrée', 'success');
                } catch {
                  toast(locale === 'ar' ? 'فشل الحفظ' : 'Échec', 'error');
                } finally {
                  setSettingsBusy(false);
                }
              }}
              disabled={settingsBusy}
              className="inline-flex items-center px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {locale === 'ar' ? 'حفظ (أيام)' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
