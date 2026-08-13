'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Calendar, RefreshCw, Loader2, Clock, Tv, Globe } from 'lucide-react';
import api from '@/lib/api';

interface EpgStats {
  totalPrograms: number;
  channelsWithEpg: number;
  totalSystemChannels: number;
  lastRefreshedAt: string | null;
  nextRefreshAt: string | null;
  sourcesDiscovered: number;
  refreshInProgress: boolean;
}

interface EpgSource {
  url: string;
  source: string;
  coveredChannels: number;
}

function formatRelativeTime(dateStr: string | null) {
  if (!dateStr) return 'لم يحدث بعد';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);

  if (diffMin < 1) return 'الآن';
  if (diffMin < 60) return `منذ ${diffMin} د`;
  if (diffHr < 24) return `منذ ${diffHr} س`;
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFutureTime(dateStr: string | null) {
  if (!dateStr) return 'غير مجدول';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);

  if (diffMin < 1) return 'قريبًا';
  if (diffMin < 60) return `خلال ${diffMin} د`;
  if (diffHr < 24) return `خلال ${diffHr} س و${diffMin % 60} د`;
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EpgPage() {
  const [stats, setStats] = useState<EpgStats | null>(null);
  const [sources, setSources] = useState<EpgSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [error, setError] = useState('');
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/epg/status');
      if (res.data?.success) {
        setStats(res.data.data);
      }
    } catch {
      setError('تعذر تحميل إحصائيات دليل البرامج');
    }
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
      setError('تعذر بدء تحديث دليل البرامج');
      setRefreshing(false);
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

  const metrics = [
    {
      label: 'إجمالي البرامج',
      value: stats?.totalPrograms.toLocaleString() ?? '0',
      sub: 'في قاعدة البيانات',
      color: 'bg-signal-blue',
      icon: Calendar,
    },
    {
      label: 'تغطية دليل البرامج',
      value: `${coveragePercent}%`,
      sub: `${stats?.channelsWithEpg ?? 0} من أصل ${stats?.totalSystemChannels ?? 0} قناة`,
      color:
        coveragePercent > 50
          ? 'bg-signal-green'
          : coveragePercent > 0
            ? 'bg-signal-amber'
            : 'bg-signal-red',
      icon: Tv,
    },
    {
      label: 'المصادر',
      value: stats?.sourcesDiscovered ?? 0,
      sub: 'مكتشفة تلقائيًا',
      color: 'bg-primary',
      icon: Globe,
    },
    {
      label: 'آخر تحديث',
      value: formatRelativeTime(stats?.lastRefreshedAt ?? null),
      sub: `التالي: ${formatFutureTime(stats?.nextRefreshAt ?? null)}`,
      color: stats?.lastRefreshedAt ? 'bg-signal-green' : 'bg-signal-red',
      icon: Clock,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between ">
        <div>
          <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">دليل البرامج الإلكتروني</h1>
          <p className="text-sm text-muted-foreground mt-1">
            إدارة دليل البرامج الإلكتروني تلقائيًا
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={!!isRefreshing}
          aria-label="تحديث بيانات دليل البرامج"
          className="flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-[0.1em] font-medium border border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'جارٍ التحديث...' : 'تحديث الآن'}
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
            جارٍ تحديث دليل البرامج وجلب البيانات من المصادر المكتشفة...
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

      {/* How it works */}
      <div className="border border-border ">
        <div className="border-b border-border px-4 py-2.5">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em]">كيف يعمل دليل البرامج؟</h2>
        </div>
        <div className="p-4 space-y-2 text-sm text-muted-foreground">
          <p>
            يتم اكتشاف بيانات دليل البرامج {' '}
            <strong className="text-foreground">واستقدامها تلقائيًا</strong> بناءً على القنوات الموجودة في نظامك:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              تتم مطابقة القنوات من <strong className="text-foreground">iptv-org</strong> مع قاعدة أدلة البرامج الخاصة بها
            </li>
            <li>
              <strong className="text-foreground">Pluto TV</strong> و{' '}
              <strong className="text-foreground">Samsung TV Plus</strong> ويتم جلب دليل البرامج من
              i.mjh.nz
            </li>
            <li>
              يتم تحديث البيانات تلقائيًا كل {' '}
              <strong className="text-foreground">6 ساعات</strong>
            </li>
            <li>تُنظف البرامج القديمة تلقائيًا بعد 48 ساعة</li>
          </ul>
          <p className="pt-1">
            تصل تطبيقات IPTV إلى دليل البرامج عبر{' '}
            <code className="text-xs bg-muted px-1.5 py-0.5 font-mono">/api/v1/tv/epg/:code</code>{' '}
            باستخدام رمز قائمة القنوات، ويضيف رأس قائمة M3U رابط دليل البرامج تلقائيًا.
          </p>
        </div>
      </div>

      {/* Discovered Sources */}
      <div className="border border-border ">
        <div className="border-b border-border px-4 py-2.5 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em]">مصادر دليل البرامج المكتشفة</h2>
          <button
            onClick={fetchSources}
            disabled={sourcesLoading}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {sourcesLoading ? 'Loading...' : 'Reload'}
          </button>
        </div>

        {sources.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>لم يتم اكتشاف مصادر دليل البرامج بعد.</p>
            <p className="text-xs mt-1">
              استورد القنوات أولًا، ثم سيتم اكتشاف مصادر دليل البرامج تلقائيًا.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sources.map((source, i) => (
              <div key={i} className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`text-xs uppercase tracking-wider font-bold px-1.5 py-0.5 border ${
                      source.source === 'iptv-org'
                        ? 'border-signal-blue/40 text-signal-blue bg-signal-blue/5'
                        : source.source === 'pluto-tv'
                          ? 'border-signal-green/40 text-signal-green bg-signal-green/5'
                          : 'border-signal-amber/40 text-signal-amber bg-signal-amber/5'
                    }`}
                  >
                    {source.source}
                    <span className="sr-only"> source</span>
                  </span>
                  <span className="text-xs font-mono text-muted-foreground truncate">
                    {source.url}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-4">
                  <Tv className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs tabular-nums">{source.coveredChannels}</span>
                  <span className="text-xs text-muted-foreground">قنوات</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
