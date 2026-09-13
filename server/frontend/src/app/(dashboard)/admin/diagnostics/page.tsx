'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  Stethoscope,
  Server,
  Smartphone,
  Activity,
} from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';

type OverallStatus = 'ok' | 'degraded' | 'fail';
type CheckStatus = 'pass' | 'warn' | 'fail';

interface DiagnosticCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
}

interface ServerInfo {
  version: string;
  commit: string | null;
  builtAt: string | null;
  environment: string;
  uptimeSeconds: number;
  nodeVersion: string;
}

interface ReleaseInfo {
  versionName: string | null;
  versionCode: number | null;
  releaseChannel: string | null;
  distribution: string | null;
  sha256Preview: string | null;
  downloadUrlHost: string | null;
  publishedAt: string | null;
}

interface DiagnosticsResponse {
  generatedAt: string;
  overall: OverallStatus;
  server: ServerInfo;
  release: ReleaseInfo;
  checks: DiagnosticCheck[];
}

/** Placeholder shown for missing/null values. */
const EMPTY = '—';

function formatDate(value?: string | null): string {
  if (!value) return EMPTY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleString();
}

/** Human readable Arabic-style uptime, e.g. «3 ساعات و12 دقيقة». */
function formatUptime(seconds: number, pick: (ar: string, en: string, fr: string) => string): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return EMPTY;
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${pick('يوم', days === 1 ? 'day' : 'days', days === 1 ? 'jour' : 'jours')}`);
  if (hours > 0) parts.push(`${hours} ${pick('ساعة', hours === 1 ? 'hour' : 'hours', hours === 1 ? 'heure' : 'heures')}`);
  if (minutes > 0 && days === 0) {
    parts.push(`${minutes} ${pick('دقيقة', minutes === 1 ? 'minute' : 'minutes', minutes === 1 ? 'minute' : 'minutes')}`);
  }
  if (parts.length === 0) parts.push(`${total} ${pick('ثانية', total === 1 ? 'second' : 'seconds', total === 1 ? 'seconde' : 'secondes')}`);
  return parts.join(pick(' و', ' ', ' '));
}

/** Turn an axios/network failure into a readable message (401/403/500 included). */
function describeError(err: unknown, pick: (ar: string, en: string, fr: string) => string): string {
  const error = err as {
    response?: { status?: number; data?: unknown };
    message?: string;
  };
  const status = error?.response?.status;
  const data = error?.response?.data;

  let serverMessage = '';
  if (typeof data === 'string') {
    serverMessage = data;
  } else if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.error === 'string') serverMessage = record.error;
    else if (typeof record.message === 'string') serverMessage = record.message;
  }

  if (status === 401) {
    return pick(
      'انتهت صلاحية الجلسة أو لا تملك صلاحية الوصول (401). أعد تسجيل الدخول ثم حاول مجدداً.',
      'Your session expired or you are not authorized (401). Sign in again and retry.',
      'Votre session a expiré ou vous n’êtes pas autorisé (401). Reconnectez-vous et réessayez.',
    );
  }
  if (status === 403) {
    return pick(
      'لا تملك صلاحية الوصول إلى لوحة التشخيص (403).',
      'You do not have access to diagnostics (403).',
      'Vous n’avez pas accès aux diagnostics (403).',
    );
  }
  if (status === 500) {
    return pick(
      'فشل الخادم أثناء توليد التشخيص (500). حاول مجدداً بعد قليل.',
      'The server failed to generate diagnostics (500). Try again shortly.',
      'Le serveur n’a pas pu générer les diagnostics (500). Réessayez bientôt.',
    );
  }
  if (serverMessage) return serverMessage;
  if (status) {
    return pick(
      `فشل تحميل التشخيص (رمز ${status}).`,
      `Failed to load diagnostics (status ${status}).`,
      `Échec du chargement des diagnostics (code ${status}).`,
    );
  }
  return pick(
    'تعذّر الاتصال بالخادم. تحقق من الشبكة وحاول مجدداً.',
    'Could not reach the server. Check your connection and retry.',
    'Impossible de joindre le serveur. Vérifiez la connexion et réessayez.',
  );
}

export default function DiagnosticsPage() {
  const { t, locale } = useLocale();
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const pick = useCallback(
    (ar: string, en: string, fr: string) => (locale === 'ar' ? ar : locale === 'fr' ? fr : en),
    [locale],
  );

  const load = useCallback(
    async (signal?: AbortSignal, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError('');

      try {
        const response = await api.get<DiagnosticsResponse>('/admin/diagnostics', { signal });
        if (signal?.aborted) return;
        const raw = response.data;
        // Accept either a bare payload or a { data: payload } envelope.
        const payload =
          raw && typeof raw === 'object' && 'generatedAt' in raw
            ? raw
            : (raw as unknown as { data?: DiagnosticsResponse })?.data;
        if (!payload || typeof payload !== 'object') {
          throw new Error('Malformed diagnostics response');
        }
        setData(payload);
      } catch (err) {
        if (signal?.aborted) return;
        if ((err as { code?: string })?.code === 'ERR_CANCELED') return;
        setError(describeError(err, pick));
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [pick],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const overall = data?.overall;
  const overallMeta: Record<OverallStatus, { label: string; wrap: string; dot: string; text: string }> = {
    ok: {
      label: pick('سليم', 'Healthy', 'Sain'),
      wrap: 'border-signal-green/40 bg-signal-green/5',
      dot: 'bg-signal-green',
      text: 'text-signal-green',
    },
    degraded: {
      label: pick('منقوص', 'Degraded', 'Dégradé'),
      wrap: 'border-signal-amber/40 bg-signal-amber/5',
      dot: 'bg-signal-amber',
      text: 'text-signal-amber',
    },
    fail: {
      label: pick('متعطّل', 'Down', 'En panne'),
      wrap: 'border-signal-red/40 bg-signal-red/5',
      dot: 'bg-signal-red',
      text: 'text-signal-red',
    },
  };
  const overallStyle = overall ? overallMeta[overall] : null;

  const checkMeta: Record<CheckStatus, string> = {
    pass: 'bg-signal-green/10 text-signal-green border-signal-green/20',
    warn: 'bg-signal-amber/10 text-signal-amber border-signal-amber/20',
    fail: 'bg-signal-red/10 text-signal-red border-signal-red/20',
  };
  const checkLabel: Record<CheckStatus, string> = {
    pass: pick('ناجح', 'Pass', 'Réussi'),
    warn: pick('تحذير', 'Warn', 'Alerte'),
    fail: pick('فاشل', 'Fail', 'Échec'),
  };

  const refresh = () => void load(undefined, true);

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em] flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-primary" aria-hidden="true" />
          {pick('التشخيص', 'Diagnostics', 'Diagnostics')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {pick(
            'حالة الخادم والإصدار المنشور والفحوصات الفنية',
            'Server, release and health checks',
            'Serveur, version et contrôles de santé',
          )}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {data?.generatedAt && (
          <span className="text-xs text-muted-foreground">
            {pick('آخر تحديث:', 'Last updated:', 'Dernière mise à jour :')} {formatDate(data.generatedAt)}
          </span>
        )}
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          {t('common.refresh')}
        </button>
      </div>
    </div>
  );

  if (loading && !data) {
    return (
      <div className="space-y-6">
        {header}
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        {header}
        <div className="border border-destructive/40 bg-destructive/10 px-4 py-4 space-y-3">
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  const server = data?.server;
  const release = data?.release;
  const checks = data?.checks ?? [];

  const infoRow = (label: string, value: React.ReactNode) => (
    <div>
      <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium mt-0.5">{value}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {header}

      {error && (
        <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Overall status badge */}
      <div
        className={`border-2 bg-card px-5 py-4 flex items-center gap-3 ${
          overallStyle ? overallStyle.wrap : 'border-border'
        }`}
      >
        <span
          className={`w-3 h-3 rounded-full ${overallStyle ? overallStyle.dot : 'bg-muted-foreground'}`}
          aria-hidden="true"
        />
        <span
          className={`text-2xl font-display font-bold ${overallStyle ? overallStyle.text : 'text-muted-foreground'}`}
        >
          {overallStyle ? overallStyle.label : EMPTY}
        </span>
        <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {pick('الحالة العامة', 'Overall status', 'État global')}
        </span>
      </div>

      {/* Checks */}
      <div className="border border-border">
        <div className="px-4 py-2 bg-muted/50 border-b border-border flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            {pick(`الفحوصات (${checks.length})`, `Checks (${checks.length})`, `Contrôles (${checks.length})`)}
          </h2>
          <Activity className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </div>
        {checks.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t('common.noData')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {checks.map((check) => (
              <div key={check.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <span
                  className={`mt-0.5 shrink-0 text-xs uppercase tracking-[0.1em] px-2 py-0.5 font-medium border ${
                    checkMeta[check.status] || 'bg-muted text-muted-foreground border-border'
                  }`}
                >
                  {checkLabel[check.status] || check.status}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{check.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{check.detail}</p>
                </div>
                <code className="text-xs text-muted-foreground/70 font-mono">{check.id}</code>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Server info */}
        <div className="border border-border">
          <div className="px-4 py-2 bg-muted/50 border-b border-border flex items-center gap-2">
            <Server className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
              {pick('الخادم', 'Server', 'Serveur')}
            </h2>
          </div>
          <div className="p-5 grid grid-cols-2 gap-4">
            {infoRow(pick('الإصدار', 'Version', 'Version'), server?.version || EMPTY)}
            {infoRow(
              pick('الـcommit', 'Commit', 'Commit'),
              <span className="font-mono text-xs break-all">{server?.commit || EMPTY}</span>,
            )}
            {infoRow(pick('وقت البناء', 'Built at', 'Compilé le'), formatDate(server?.builtAt))}
            {infoRow(pick('البيئة', 'Environment', 'Environnement'), server?.environment || EMPTY)}
            {infoRow(
              pick('مدة التشغيل', 'Uptime', 'Durée de fonctionnement'),
              typeof server?.uptimeSeconds === 'number'
                ? formatUptime(server.uptimeSeconds, pick)
                : EMPTY,
            )}
            {infoRow(pick('إصدار Node', 'Node version', 'Version de Node'), server?.nodeVersion || EMPTY)}
          </div>
        </div>

        {/* Release info */}
        <div className="border border-border">
          <div className="px-4 py-2 bg-muted/50 border-b border-border flex items-center gap-2">
            <Smartphone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
              {pick('الإصدار المنشور', 'Release', 'Version publiée')}
            </h2>
          </div>
          <div className="p-5 grid grid-cols-2 gap-4">
            {infoRow(pick('اسم الإصدار', 'Version name', 'Nom de version'), release?.versionName || EMPTY)}
            {infoRow(
              'versionCode',
              typeof release?.versionCode === 'number' ? release.versionCode : EMPTY,
            )}
            {infoRow(pick('القناة', 'Channel', 'Canal'), release?.releaseChannel || EMPTY)}
            {infoRow(pick('مسار التوزيع', 'Distribution', 'Distribution'), release?.distribution || EMPTY)}
            {infoRow(
              pick('بصمة sha256 مختصرة', 'SHA-256 preview', 'Aperçu SHA-256'),
              <span className="font-mono text-xs break-all">{release?.sha256Preview || EMPTY}</span>,
            )}
            {infoRow(
              pick('مضيف رابط التحميل', 'Download host', 'Hôte de téléchargement'),
              release?.downloadUrlHost || EMPTY,
            )}
            {infoRow(pick('تاريخ النشر', 'Published at', 'Publié le'), formatDate(release?.publishedAt))}
          </div>
        </div>
      </div>
    </div>
  );
}
