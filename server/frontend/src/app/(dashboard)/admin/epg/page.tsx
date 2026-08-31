'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Calendar,
  RefreshCw,
  Loader2,
  Clock,
  Tv,
  Globe,
  Power,
  Play,
  AlertTriangle,
  Check,
} from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import Pagination from '@/components/ui/pagination';

interface EpgStats {
  totalPrograms: number;
  channelsWithEpg: number;
  totalSystemChannels: number;
  lastRefreshedAt: string | null;
  nextRefreshAt: string | null;
  sourcesDiscovered: number;
  refreshInProgress: boolean;
  lastRefreshDurationMs?: number;
  lastRefreshProgramCount?: number;
  lastRefreshErrorCount?: number;
  lastRefreshErrorSources?: string[];
}

interface EpgSource {
  url: string;
  source: string;
  coveredChannels: number;
  disabled: boolean;
  lastOkAt?: string | null;
  lastFailedAt?: string | null;
  lastError?: string | null;
  lastTestedAt?: string | null;
  lastTestResult?: { ok: boolean; programCount?: number; error?: string } | null;
}

function formatRelativeTime(dateStr: string | null, locale: string) {
  if (!dateStr) return locale === 'ar' ? 'لم يحدث بعد' : locale === 'fr' ? 'Jamais' : 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);

  if (diffMin < 1) return locale === 'ar' ? 'الآن' : locale === 'fr' ? 'à l’instant' : 'just now';
  if (diffMin < 60)
    return locale === 'ar'
      ? `منذ ${diffMin} د`
      : locale === 'fr'
        ? `il y a ${diffMin} min`
        : `${diffMin}m ago`;
  if (diffHr < 24)
    return locale === 'ar'
      ? `منذ ${diffHr} س`
      : locale === 'fr'
        ? `il y a ${diffHr} h`
        : `${diffHr}h ago`;
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFutureTime(dateStr: string | null, locale: string) {
  if (!dateStr)
    return locale === 'ar' ? 'غير مجدول' : locale === 'fr' ? 'Non planifié' : 'Not scheduled';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);

  if (diffMin < 1) return locale === 'ar' ? 'قريبًا' : locale === 'fr' ? 'Bientôt' : 'Soon';
  if (diffMin < 60)
    return locale === 'ar'
      ? `خلال ${diffMin} د`
      : locale === 'fr'
        ? `dans ${diffMin} min`
        : `in ${diffMin}m`;
  if (diffHr < 24)
    return locale === 'ar'
      ? `خلال ${diffHr} س و${diffMin % 60} د`
      : locale === 'fr'
        ? `dans ${diffHr} h et ${diffMin % 60} min`
        : `in ${diffHr}h ${diffMin % 60}m`;
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EpgPage() {
  const { locale } = useLocale();
  const { toast } = useToast();
  const [stats, setStats] = useState<EpgStats | null>(null);
  const [sources, setSources] = useState<EpgSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [testingUrl, setTestingUrl] = useState<string | null>(null);
  const [togglingUrl, setTogglingUrl] = useState<string | null>(null);
  const [disableSource, setDisableSource] = useState<EpgSource | null>(null);
  const [error, setError] = useState('');
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unmatched channels (manual tvg-id matching)
  const [unmatched, setUnmatched] = useState<
    Array<{ _id: string; channelId: string; channelName: string; tvgId: string; channelGroup: string }>
  >([]);
  const [unmatchedTotal, setUnmatchedTotal] = useState(0);
  const [unmatchedPage, setUnmatchedPage] = useState(1);
  const [unmatchedLoading, setUnmatchedLoading] = useState(false);
  const [unmatchedSearch, setUnmatchedSearch] = useState('');
  const [unmatchedDebounced, setUnmatchedDebounced] = useState('');
  const [savingTvgId, setSavingTvgId] = useState<string | null>(null);
  const [tvgDrafts, setTvgDrafts] = useState<Record<string, string>>({});

  const L = (ar: string, fr: string, en: string) => (locale === 'ar' ? ar : locale === 'fr' ? fr : en);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/epg/status');
      if (res.data?.success) {
        setStats(res.data.data);
      }
    } catch {
      setError(L('تعذر تحميل إحصائيات دليل البرامج', 'Impossible de charger les statistiques EPG', 'Failed to load EPG stats'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const res = await api.get('/epg/sources');
      if (res.data?.success) {
        setSources(res.data.data || []);
      }
    } catch {
      // Sources endpoint might fail if no channels exist yet
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      await Promise.all([fetchStats(), fetchSources()]);
      setLoading(false);
    }
    load();
  }, [fetchStats, fetchSources]);

  // Poll stats while refresh is in progress
  useEffect(() => {
    if (!stats?.refreshInProgress && !refreshing) return;
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [stats?.refreshInProgress, refreshing, fetchStats]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  // Debounce unmatched-channel search.
  useEffect(() => {
    const timer = setTimeout(() => setUnmatchedDebounced(unmatchedSearch), 350);
    return () => clearTimeout(timer);
  }, [unmatchedSearch]);

  const fetchUnmatched = useCallback(async () => {
    setUnmatchedLoading(true);
    try {
      const res = await api.get('/epg/unmatched-channels', {
        params: { page: unmatchedPage, pageSize: 50, search: unmatchedDebounced || undefined },
      });
      const body = res.data;
      setUnmatched(Array.isArray(body) ? body : body.data || []);
      setUnmatchedTotal(body.totalCount ?? (Array.isArray(body) ? body.length : 0));
    } catch {
      // Non-critical section — keep the page usable if it fails.
    } finally {
      setUnmatchedLoading(false);
    }
  }, [unmatchedPage, unmatchedDebounced]);

  useEffect(() => {
    fetchUnmatched();
  }, [fetchUnmatched]);

  async function handleSetTvgId(channelId: string) {
    const tvgId = (tvgDrafts[channelId] || '').trim();
    if (!tvgId) {
      toast(L('أدخل tvg-id أولاً', 'Entrez d’abord un tvg-id', 'Enter a tvg-id first'), 'error');
      return;
    }
    setSavingTvgId(channelId);
    try {
      await api.patch(`/epg/channels/${channelId}/tvg-id`, { tvgId });
      toast(
        L(`تم تعيين tvg-id «${tvgId}»`, `tvg-id «${tvgId}» défini`, `tvg-id "${tvgId}" set`),
        'success',
      );
      const next = { ...tvgDrafts };
      delete next[channelId];
      setTvgDrafts(next);
      await fetchUnmatched();
    } catch {
      toast(L('فشل تعيين tvg-id', 'Échec de la définition du tvg-id', 'Failed to set tvg-id'), 'error');
    } finally {
      setSavingTvgId(null);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setError('');
    try {
      await api.post('/epg/refresh');
      // Poll for completion
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(async () => {
        await fetchStats();
        await fetchSources();
        setRefreshing(false);
      }, 2000);
    } catch {
      setError(L('تعذر بدء تحديث دليل البرامج', 'Impossible de lancer la mise à jour EPG', 'Failed to start EPG refresh'));
      setRefreshing(false);
    }
  }

  async function handleTestSource(url: string) {
    setTestingUrl(url);
    try {
      const res = await api.post(`/epg/sources/${encodeURIComponent(url)}/test`);
      const data = res.data;
      if (data.ok) {
        toast(
          L(
            `المصدر يعمل — ${data.programCount ?? 0} برنامج`,
            `Source OK — ${data.programCount ?? 0} programmes`,
            `Source OK — ${data.programCount ?? 0} programs`,
          ),
          'success',
        );
      } else {
        toast(
          L('فشل المصدر', 'Échec de la source', 'Source failed') +
            (data.error ? `: ${String(data.error).slice(0, 120)}` : ''),
          'error',
        );
      }
    } catch {
      toast(L('تعذر اختبار المصدر', 'Impossible de tester la source', 'Failed to test source'), 'error');
    } finally {
      setTestingUrl(null);
      await fetchSources();
    }
  }

  async function handleToggleSource(source: EpgSource) {
    setTogglingUrl(source.url);
    try {
      if (source.disabled) {
        await api.post(`/epg/sources/${encodeURIComponent(source.url)}/enable`);
        toast(L('تم تفعيل المصدر', 'Source activée', 'Source enabled'), 'success');
      } else {
        setDisableSource(source);
      }
    } catch {
      toast(L('تعذر تغيير حالة المصدر', 'Impossible de modifier la source', 'Failed to update source'), 'error');
    } finally {
      setTogglingUrl(null);
      await fetchSources();
    }
  }

  async function confirmDisableSource() {
    const source = disableSource;
    if (!source) return;
    setDisableSource(null);
    setTogglingUrl(source.url);
    try {
      await api.post(`/epg/sources/${encodeURIComponent(source.url)}/disable`);
      toast(L('تم تعطيل المصدر', 'Source désactivée', 'Source disabled'), 'success');
    } catch {
      toast(L('تعذر تغيير حالة المصدر', 'Impossible de modifier la source', 'Failed to update source'), 'error');
    } finally {
      setTogglingUrl(null);
      await fetchSources();
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const coveragePercent =
    stats && stats.totalSystemChannels > 0
      ? Math.round((stats.channelsWithEpg / stats.totalSystemChannels) * 100)
      : 0;

  const isRefreshing = refreshing || stats?.refreshInProgress;
  const failingSources = sources.filter(
    (s) => !s.disabled && s.lastFailedAt && (!s.lastOkAt || new Date(s.lastFailedAt) > new Date(s.lastOkAt)),
  );

  const metrics = [
    {
      label: L('إجمالي البرامج', 'Programmes totaux', 'Total programs'),
      value: stats?.totalPrograms.toLocaleString() ?? '0',
      sub: L('في قاعدة البيانات', 'en base de données', 'in the database'),
      color: 'bg-signal-blue',
      icon: Calendar,
    },
    {
      label: L('تغطية دليل البرامج', 'Couverture EPG', 'EPG coverage'),
      value: `${coveragePercent}%`,
      sub: `${stats?.channelsWithEpg ?? 0} ${L('من أصل', 'sur', 'of')} ${stats?.totalSystemChannels ?? 0} ${L('قناة', 'chaînes', 'channels')}`,
      color:
        coveragePercent > 50
          ? 'bg-signal-green'
          : coveragePercent > 0
            ? 'bg-signal-amber'
            : 'bg-signal-red',
      icon: Tv,
    },
    {
      label: L('المصادر', 'Sources', 'Sources'),
      value: stats?.sourcesDiscovered ?? 0,
      sub: L('مكتشفة تلقائيًا', 'détectées automatiquement', 'auto-discovered'),
      color: 'bg-primary',
      icon: Globe,
    },
    {
      label: L('آخر تحديث', 'Dernière mise à jour', 'Last update'),
      value: formatRelativeTime(stats?.lastRefreshedAt ?? null, locale),
      sub: `${L('التالي', 'Prochaine', 'Next')}: ${formatFutureTime(stats?.nextRefreshAt ?? null, locale)}`,
      color: stats?.lastRefreshedAt ? 'bg-signal-green' : 'bg-signal-red',
      icon: Clock,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Surface failing sources so an operator sees partial-ingest problems
          without reading container logs. */}
      {stats && (stats.lastRefreshErrorCount ?? 0) > 0 && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm" role="alert">
          <p className="font-medium text-destructive">
            {L(
              `فشل ${stats.lastRefreshErrorCount} من ${stats.sourcesDiscovered} مصدر في آخر تحديث.`,
              `${stats.lastRefreshErrorCount} sources sur ${stats.sourcesDiscovered} ont échoué lors de la dernière mise à jour.`,
              `${stats.lastRefreshErrorCount} of ${stats.sourcesDiscovered} sources failed in the last refresh.`,
            )}
          </p>
          {(stats.lastRefreshErrorSources ?? []).length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
              {(stats.lastRefreshErrorSources ?? []).slice(0, 8).join(' · ')}
              {(stats.lastRefreshErrorSources ?? []).length > 8 ? ' …' : ''}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between ">
        <div>
          <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">
            {L('دليل البرامج الإلكتروني', 'Guide des programmes', 'Electronic Program Guide')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {L('إدارة دليل البرامج الإلكتروني تلقائيًا', 'Gestion automatique du guide des programmes', 'Automatically manage the electronic program guide')}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={!!isRefreshing}
          aria-label={L('تحديث بيانات دليل البرامج', 'Actualiser le guide', 'Refresh EPG data')}
          className="flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-[0.1em] font-medium border border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? L('جارٍ التحديث...', 'Actualisation…', 'Updating…') : L('تحديث الآن', 'Actualiser', 'Update now')}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Status Banner */}
      {isRefreshing && (
        <div className="border border-signal-blue/30 bg-signal-blue/5 px-4 py-3 flex items-center gap-3 ">
          <Loader2 className="h-4 w-4 animate-spin text-signal-blue" />
          <p className="text-sm">
            {L('جارٍ تحديث دليل البرامج وجلب البيانات من المصادر المكتشفة...', 'Mise à jour du guide en cours…', 'Updating the guide from discovered sources…')}
          </p>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="border border-border ">
        <div className="grid grid-cols-2 md:grid-cols-4">
          {metrics.map((metric, i) => {
            const Icon = metric.icon;
            return (
              <div
                key={metric.label}
                className={`p-4 ${i % 2 !== 0 ? 'border-l border-border' : ''} ${
                  i >= 2 ? 'border-t border-border md:border-t-0' : ''
                } ${i === 2 ? 'md:border-l' : ''}`}
              >
                <div className="relative inline-flex items-center gap-1.5">
                  <Icon className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                  <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                    {metric.label}
                  </p>
                </div>
                <p className="text-2xl font-display font-bold mt-1.5 tabular-nums">
                  {metric.value}
                </p>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${metric.color}`} aria-hidden="true" />
                  <span className="text-xs text-muted-foreground">{metric.sub}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Discovered Sources */}
      <div className="border border-border ">
        <div className="border-b border-border px-4 py-2.5 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em]">
            {L('مصادر دليل البرامج المكتشفة', 'Sources du guide détectées', 'Discovered EPG sources')}
          </h2>
          <div className="flex items-center gap-3">
            {failingSources.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3" />
                {L(
                  `${failingSources.length} مصدر متعطل حاليًا`,
                  `${failingSources.length} sources en échec`,
                  `${failingSources.length} sources currently failing`,
                )}
              </span>
            )}
            <button
              onClick={fetchSources}
              disabled={sourcesLoading}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {sourcesLoading
                ? L('جارٍ التحميل...', 'Chargement…', 'Loading...')
                : L('إعادة التحميل', 'Recharger', 'Reload')}
            </button>
          </div>
        </div>

        {sources.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>{L('لم يتم اكتشاف مصادر دليل البرامج بعد.', 'Aucune source EPG détectée.', 'No EPG sources discovered yet.')}</p>
            <p className="text-xs mt-1">
              {L('استورد القنوات أولًا، ثم سيتم اكتشاف مصادر دليل البرامج تلقائيًا.', 'Importez d’abord des chaînes : les sources seront découvertes automatiquement.', 'Import channels first — EPG sources are then discovered automatically.')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sources.map((source, i) => {
              const failed =
                !source.disabled &&
                source.lastFailedAt &&
                (!source.lastOkAt || new Date(source.lastFailedAt) > new Date(source.lastOkAt));
              const ok = !source.disabled && !failed;
              const sourceLabel = source.source.replace(/^custom:/, '').replace(/^m3u:/, 'M3U');
              return (
                <div
                  key={source.url || i}
                  className={`px-4 py-3 flex items-center justify-between gap-3 ${
                    source.disabled ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs uppercase tracking-wider font-bold px-1.5 py-0.5 border ${
                        source.disabled
                          ? 'border-muted text-muted-foreground bg-muted/40'
                          : failed
                            ? 'border-destructive/50 text-destructive bg-destructive/5'
                            : source.source === 'iptv-epg.org'
                              ? 'border-signal-blue/40 text-signal-blue bg-signal-blue/5'
                              : source.source === 'pluto-tv' || source.source === 'samsung-tv-plus'
                                ? 'border-signal-green/40 text-signal-green bg-signal-green/5'
                                : 'border-signal-amber/40 text-signal-amber bg-signal-amber/5'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          source.disabled ? 'bg-muted-foreground' : failed ? 'bg-destructive' : 'bg-signal-green'
                        }`}
                        aria-hidden="true"
                      />
                      {sourceLabel}
                    </span>
                    <div className="min-w-0">
                      <span className="text-xs font-mono text-muted-foreground truncate block" dir="ltr">
                        {source.url}
                      </span>
                      {source.disabled ? (
                        <span className="text-[11px] text-muted-foreground">
                          {L('معطل — مستبعد من التحديثات', 'Désactivée — exclue des mises à jour', 'Disabled — excluded from refreshes')}
                        </span>
                      ) : failed ? (
                        <span className="text-[11px] text-destructive truncate block">
                          {L('فشل آخر تحديث', 'Échec de la dernière mise à jour', 'Last refresh failed')}
                          {source.lastError ? `: ${String(source.lastError).slice(0, 100)}` : ''}
                        </span>
                      ) : ok && source.lastOkAt ? (
                        <span className="text-[11px] text-muted-foreground">
                          {L('آخر نجاح', 'Dernier succès', 'Last success')}: {formatRelativeTime(source.lastOkAt, locale)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {L('لم يُختبر بعد', 'Jamais testée', 'Not tested yet')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Tv className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs tabular-nums">{source.coveredChannels}</span>
                      <span className="text-xs text-muted-foreground">
                        {L('قناة', 'chaînes', 'channels')}
                      </span>
                    </div>
                    <button
                      onClick={() => handleTestSource(source.url)}
                      disabled={testingUrl === source.url}
                      title={L('اختبار هذا المصدر', 'Tester cette source', 'Test this source')}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-50 transition-colors"
                    >
                      {testingUrl === source.url ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      {L('اختبار', 'Tester', 'Test')}
                    </button>
                    <button
                      onClick={() => handleToggleSource(source)}
                      disabled={togglingUrl === source.url}
                      title={
                        source.disabled
                          ? L('تفعيل المصدر', 'Activer la source', 'Enable source')
                          : L('تعطيل المصدر', 'Désactiver la source', 'Disable source')
                      }
                      className={`inline-flex items-center gap-1 text-xs px-2 py-1 border transition-colors disabled:opacity-50 ${
                        source.disabled
                          ? 'border-signal-green/40 text-signal-green hover:bg-signal-green/5'
                          : 'border-destructive/40 text-destructive hover:bg-destructive/5'
                      }`}
                    >
                      {togglingUrl === source.url ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Power className="h-3 w-3" />
                      )}
                      {source.disabled ? L('تفعيل', 'Activer', 'Enable') : L('تعطيل', 'Désactiver', 'Disable')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Unmatched channels — manual tvg-id matching */}
      <div className="border border-border ">
        <div className="border-b border-border px-4 py-2.5 flex items-center justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em]">
            {L('القنوات غير المغطاة', 'Chaînes sans couverture EPG', 'Unmatched channels')}
            <span className="ms-2 font-normal text-muted-foreground">({unmatchedTotal})</span>
          </h2>
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              value={unmatchedSearch}
              onChange={(e) => {
                setUnmatchedSearch(e.target.value);
                setUnmatchedPage(1);
              }}
              placeholder={L('ابحث باسم القناة أو معرّفها...', 'Rechercher une chaîne…', 'Search by name or id…')}
              className="w-full h-9 ps-3 pe-3 border border-border bg-background text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:border-primary"
            />
          </div>
        </div>

        {unmatchedLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : unmatched.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {L(
              'كل القنوات مغطاة بدليل البرامج 🎉',
              'Toutes les chaînes sont couvertes 🎉',
              'All channels are covered by the guide 🎉',
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {unmatched.map((ch) => (
              <div key={ch._id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{ch.channelName}</p>
                  <p className="text-xs text-muted-foreground truncate" dir="ltr">
                    {ch.channelId}
                    {ch.channelGroup ? ` · ${ch.channelGroup}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {L('tvg-id الحالي', 'tvg-id actuel', 'current tvg-id')}:
                  </span>
                  <code className="text-xs font-mono bg-muted px-1.5 py-0.5" dir="ltr">
                    {ch.tvgId || '—'}
                  </code>
                  <input
                    type="text"
                    dir="ltr"
                    value={tvgDrafts[ch._id] ?? ''}
                    onChange={(e) => setTvgDrafts((prev) => ({ ...prev, [ch._id]: e.target.value }))}
                    placeholder={L('معرّف جديد...', 'Nouvel identifiant…', 'New id…')}
                    className="w-44 h-8 px-2 text-xs font-mono border border-border bg-background focus-visible:outline-none focus-visible:border-primary"
                  />
                  <button
                    onClick={() => handleSetTvgId(ch._id)}
                    disabled={savingTvgId === ch._id}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-50 transition-colors"
                  >
                    {savingTvgId === ch._id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    {L('حفظ', 'Enregistrer', 'Save')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {unmatchedTotal > 50 && (
          <div className="border-t border-border px-4 py-3">
            <Pagination page={unmatchedPage} pageSize={50} totalCount={unmatchedTotal} onPageChange={setUnmatchedPage} />
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="border border-border ">
        <div className="border-b border-border px-4 py-2.5">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em]">
            {L('كيف يعمل دليل البرامج؟', 'Comment fonctionne le guide ?', 'How does the guide work?')}
          </h2>
        </div>
        <div className="p-4 space-y-2 text-sm text-muted-foreground">
          <p>
            {L('يتم اكتشاف بيانات دليل البرامج', 'Les données du guide sont', 'Guide data is')}{' '}
            <strong className="text-foreground">
              {L('واستقدامها تلقائيًا', 'découvertes et récupérées automatiquement', 'auto-discovered and fetched')}
            </strong>{' '}
            {L('بناءً على القنوات الموجودة في نظامك:', 'à partir des chaînes de votre système :', 'based on the channels in your system:')}
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              {L('تتم مطابقة القنوات من', 'Les chaînes', 'Channels from')}{' '}
              <strong className="text-foreground">iptv-org</strong>{' '}
              {L('مع قاعدة أدلة البرامج الخاصة بها', 'sont associées à leur guide', 'are matched to their guide database')}
            </li>
            <li>
              <strong className="text-foreground">Pluto TV</strong> {L('و', 'et', 'and')}{' '}
              <strong className="text-foreground">Samsung TV Plus</strong>{' '}
              {L('يتم جلب دليل البرامج من', 'récupèrent leur guide depuis', 'fetch their guide from')} i.mjh.nz
            </li>
            <li>
              {L('يتم تحديث البيانات تلقائيًا كل', 'Les données sont actualisées automatiquement toutes les', 'Data is refreshed automatically every')}{' '}
              <strong className="text-foreground">{L('6 ساعات', '6 heures', '6 hours')}</strong>
            </li>
            <li>
              {L('تُنظف البرامج القديمة تلقائيًا بعد 48 ساعة', 'Les programmes obsolètes sont purgés après 48 h', 'Old programs are pruned automatically after 48h')}
            </li>
          </ul>
          <p className="pt-1">
            {L('تصل تطبيقات IPTV إلى دليل البرامج عبر', 'Les applications IPTV accèdent au guide via', 'IPTV apps reach the guide via')}{' '}
            <code className="text-xs bg-muted px-1.5 py-0.5 font-mono">/api/v1/tv/epg/:code</code>{' '}
            {L('باستخدام رمز قائمة القنوات، ويضيف رأس قائمة M3U رابط دليل البرامج تلقائيًا.', 'avec le code de liste de chaînes ; l’en-tête M3U ajoute le lien du guide automatiquement.', 'using the channel-list code; the M3U header adds the guide link automatically.')}
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={!!disableSource}
        title={L('تعطيل مصدر دليل البرامج', 'Désactiver la source EPG', 'Disable EPG source')}
        message={L(
          'سيتم استبعاد هذا المصدر من تحديثات دليل البرامج القادمة، وستبقى برامجه الحالية لكن لن تتجدد. هل تريد المتابعة؟',
          'Cette source sera exclue des prochaines mises à jour EPG. Ses programmes resteront mais ne seront plus actualisés. Continuer ?',
          'This source will be excluded from future EPG refreshes. Its existing programs remain but will not be updated. Continue?',
        )}
        variant="destructive"
        loading={togglingUrl !== null}
        onConfirm={confirmDisableSource}
        onCancel={() => setDisableSource(null)}
      />
    </div>
  );
}
