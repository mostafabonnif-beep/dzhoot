'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Tv,
  Users,
  Smartphone,
  ChevronRight,
  Loader2,
  Copy,
  Check,
  Zap,
  ExternalLink,
  Radio,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import api, { getChannelOperations, getEpgCoverage, getPlaybackQuality, type ChannelOperationsData, type EpgCoverageData, type PlaybackQualityData } from '@/lib/api';

interface DashboardStats {
  channels: { total: number; active: number; inactive: number };
  users: { total: number; active: number };
  sessions: { total: number; active: number };
  pairings: { total: number; pending: number; completed: number; today: number };
  activityFeed: Array<{ type: string; message: string; timestamp: string }>;
}

interface ConfigDefaults {
  defaultTvCode: string;
  defaultServerUrl: string;
}

interface StreamHealthData {
  channels: {
    total: number;
    working: number;
    failing: number;
    untested: number;
    totalDeadCount: number;
    totalAliveCount: number;
    totalUnresponsiveCount: number;
    totalPlayCount: number;
    totalProxyPlayCount: number;
  };
}

interface BusinessData {
  summary: {
    activatedThisMonth: number;
    activatedTotal: number;
    revenueThisMonth: number;
    revenueTotal: number;
    activeSubscriptions: number;
    activeResellers: number;
    creditRemaining: number;
    codesGeneratedThisMonth: number;
    pricesSet: boolean;
  };
  byPlanThisMonth: Array<{ planId: string; planName: string; count: number; price: number; currency: string; revenue: number }>;
  byPlanTotal: Array<{ planId: string; planName: string; count: number; price: number; currency: string; revenue: number }>;
  creditByPlan: Array<{ planId: string; planName: string; quantity: number }>;
  recentActivations: Array<{ code: string; planName: string; price: number; currency: string; resellerName: string | null; activatedAt: string }>;
}

const quickActions = [
  { label: 'اختيار سريع', href: '/admin/quick-pick', icon: Zap },
  { label: 'إدارة القنوات', href: '/admin/channels', icon: Tv },
  { label: 'إدارة المستخدمين', href: '/admin/users', icon: Users },
  { label: 'إدارة الأجهزة', href: '/admin/devices', icon: Smartphone },
];

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(value: number, currency = 'DZD') {
  const n = new Intl.NumberFormat('ar-DZ', { maximumFractionDigits: 0 }).format(value || 0);
  return `${n} ${currency}`;
}

function formatDate(timestamp: string) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'اليوم';
  if (days === 1) return 'أمس';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [config, setConfig] = useState<ConfigDefaults | null>(null);
  const [streamHealth, setStreamHealth] = useState<StreamHealthData | null>(null);
  const [channelOperations, setChannelOperations] = useState<ChannelOperationsData | null>(null);
  const [epgCoverage, setEpgCoverage] = useState<EpgCoverageData | null>(null);
  const [playbackQuality, setPlaybackQuality] = useState<PlaybackQualityData | null>(null);
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState('');

  function copyCode(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }

  const loadDashboard = useCallback(async (signal?: AbortSignal) => {
    const [statsResult, configResult, healthResult, operationsResult, coverageResult, qualityResult, businessResult] = await Promise.allSettled([
      api.get('/admin/stats/detailed', { signal }),
      api.get('/config/defaults', { signal }),
      api.get('/admin/stats/stream-health', { signal }),
      getChannelOperations(signal),
      getEpgCoverage(signal),
      getPlaybackQuality(signal),
      api.get('/admin/business/summary', { signal }),
    ]);

    if (signal?.aborted) return;
    if (statsResult.status !== 'fulfilled') throw statsResult.reason;

    const data = statsResult.value.data?.data || statsResult.value.data;
    const activityFeed: DashboardStats['activityFeed'] = [];
    for (const item of data.activity || []) {
      activityFeed.push({
        type: item.type || 'event',
        message: item.message || item.description || item.event || String(item),
        timestamp: item.timestamp || item.createdAt || new Date().toISOString(),
      });
    }

    if (configResult.status === 'fulfilled' && configResult.value.data?.data) setConfig(configResult.value.data.data);
    if (healthResult.status === 'fulfilled' && healthResult.value.data?.data) setStreamHealth(healthResult.value.data.data);
    if (operationsResult.status === 'fulfilled') setChannelOperations(operationsResult.value);
    if (coverageResult.status === 'fulfilled') setEpgCoverage(coverageResult.value);
    if (qualityResult.status === 'fulfilled') setPlaybackQuality(qualityResult.value);
    if (businessResult.status === 'fulfilled') setBusiness(businessResult.value.data?.data || null);

    setStats({
      channels: { total: data.channels?.total ?? 0, active: data.channels?.active ?? 0, inactive: data.channels?.inactive ?? 0 },
      users: { total: data.users?.total ?? 0, active: data.users?.active ?? 0 },
      sessions: { total: data.sessions?.total ?? 0, active: data.sessions?.active ?? 0 },
      pairings: {
        total: data.pairings?.total ?? 0,
        pending: data.pairings?.pending ?? 0,
        completed: data.pairings?.completed ?? 0,
        today: data.pairings?.todayCount ?? 0,
      },
      activityFeed,
    });
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void loadDashboard(controller.signal)
      .catch((err: unknown) => {
        if (!controller.signal.aborted && !(err instanceof Error && err.name === 'CanceledError')) setError('تعذر تحميل بيانات لوحة التحكم');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loadDashboard]);

  function refreshDashboard() {
    setRefreshing(true);
    setError('');
    void loadDashboard()
      .catch(() => setError('تعذر تحديث بيانات لوحة التحكم'))
      .finally(() => setRefreshing(false));
  }

  if (loading) {
    return (
      <div className="brand-surface flex min-h-[18rem] flex-col items-center justify-center gap-3 rounded-3xl border border-border/70 px-6 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <div>
          <p className="font-medium">جارٍ تجهيز مركز العمليات</p>
          <p className="mt-1 text-sm text-muted-foreground">يتم تحميل مؤشرات القنوات والمصادر والأجهزة.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="brand-surface flex flex-col gap-4 rounded-3xl border border-destructive/40 bg-destructive/5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <p className="font-medium text-destructive">{error}</p>
            <p className="mt-1 text-sm text-muted-foreground">تحقق من اتصال الخادم أو أعد المحاولة. لم تُجرَ أي تغييرات على القنوات أو الاشتراكات.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={refreshDashboard}
          disabled={refreshing}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          إعادة المحاولة
        </button>
      </div>
    );
  }

  const metrics = [
    {
      label: 'القنوات',
      value: stats?.channels.total ?? 0,
      sub: `${stats?.channels.active ?? 0} نشطة`,
      color: 'bg-signal-green',
      href: '/admin/channels',
    },
    {
      label: 'المستخدمون',
      value: stats?.users.total ?? 0,
      sub: `${stats?.users.active ?? 0} نشطون`,
      color: 'bg-signal-green',
      href: '/admin/users',
    },
    {
      label: 'الجلسات',
      value: stats?.sessions.active ?? 0,
      sub: `${stats?.sessions.total ?? 0} إجمالي`,
      color: 'bg-signal-blue',
      href: '/admin/devices',
    },
    {
      label: 'عمليات الربط',
      value: stats?.pairings.today ?? 0,
      sub: `${stats?.pairings.pending ?? 0} معلقة`,
      color: 'bg-primary',
      href: '/admin/devices',
    },
  ];

  // Derive actionable health alerts from the data we already load. These turn
  // silent background failures (e.g. EPG sources failing) into visible signals.
  const alerts: Array<{ key: string; severity: 'red' | 'amber'; text: string; href: string }> = [];
  if (channelOperations && channelOperations.epg.sourcesDiscovered > 0) {
    const failRate = channelOperations.epg.lastRefreshErrorCount / channelOperations.epg.sourcesDiscovered;
    if (channelOperations.epg.lastRefreshErrorCount > 0 && failRate >= 0.3) {
      alerts.push({
        key: 'epg',
        severity: 'red',
        text: `فشل ${channelOperations.epg.lastRefreshErrorCount} من ${channelOperations.epg.sourcesDiscovered} مصدر EPG في آخر تحديث — دليل القنوات لا يتحدث بالكامل.`,
        href: '/admin/epg',
      });
    }
  }
  if (channelOperations && channelOperations.channels.failing > 0) {
    alerts.push({
      key: 'dead',
      severity: 'amber',
      text: `${channelOperations.channels.failing} قناة معطلة في الكتالوج تحتاج تنظيفًا أو بديلًا.`,
      href: '/admin/channels',
    });
  }

  return (
    <div className="dashboard-shell space-y-8 rounded-[2rem] p-1">
      {alerts.length > 0 && (
        <div className="space-y-2" role="status" aria-live="polite">
          {alerts.map((alert) => (
            <Link
              key={alert.key}
              href={alert.href}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-medium transition-colors ${
                alert.severity === 'red'
                  ? 'border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10'
                  : 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10'
              }`}
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">{alert.text}</span>
              <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3 inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">مركز العمليات</div>
          <h1 className="text-3xl font-display font-bold tracking-tight">نظرة عامة</h1>
          <p className="mt-2 text-sm text-muted-foreground">تابع حالة المنصة والنشاط الأخير من مكان واحد.</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="text-xs text-muted-foreground">آخر تحديث {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          <button
            type="button"
            onClick={refreshDashboard}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            تحديث البيانات
          </button>
        </div>
      </div>

      <div className="brand-surface interactive-lift overflow-hidden rounded-3xl border border-border/70">
        <div className="grid grid-cols-2 md:grid-cols-4">
          {metrics.map((metric, i) => (
            <Link
              key={metric.label}
              href={metric.href}
              className={`p-5 transition-all hover:bg-primary/[0.04] hover:-translate-y-0.5 ${i % 2 !== 0 ? 'border-l border-border' : ''} ${
                i >= 2 ? 'border-t border-border md:border-t-0' : ''
              } ${i === 2 ? 'md:border-l' : ''}`}
            >
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                {metric.label}
              </p>
              <p className="text-2xl font-display font-bold mt-1.5 tabular-nums">{metric.value}</p>
              <div className="flex items-center gap-1.5 mt-2">
                <span className={`w-1.5 h-1.5 rounded-full ${metric.color}`} />
                <span className="text-xs text-muted-foreground">{metric.sub}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {business && (
        <section className="brand-surface overflow-hidden rounded-3xl border border-border/70">
          <div className="flex flex-col gap-3 border-b border-border bg-muted/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">نظرة الأعمال</h2>
              <p className="mt-1 text-xs text-muted-foreground">التفعيلات والإيرادات والاشتراكات — من أكواد التفعيل والخطط.</p>
            </div>
            {!business.summary.pricesSet && business.summary.activatedTotal > 0 && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                الإيراد 0 حتى تُضبط الأسعار في صفحة الباقات
              </span>
            )}
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'تفعيلات هذا الشهر', value: business.summary.activatedThisMonth, sub: `${business.summary.activatedTotal} إجمالي`, href: '/admin/codes' },
              { label: 'إيراد هذا الشهر', value: fmtMoney(business.summary.revenueThisMonth), sub: `${fmtMoney(business.summary.revenueTotal)} إجمالي`, href: '/admin/plans' },
              { label: 'اشتراكات نشطة', value: business.summary.activeSubscriptions, sub: `${business.summary.codesGeneratedThisMonth} كود وُلّد هذا الشهر`, href: '/admin/users' },
              { label: 'رصيد أكواد المحلات', value: business.summary.creditRemaining, sub: `${business.summary.activeResellers} محل نشط`, href: '/admin/resellers' },
            ].map((m, i) => (
              <Link
                key={m.label}
                href={m.href}
                className={`bg-card p-4 transition-colors hover:bg-primary/[0.03] ${i > 0 ? 'border-l border-border' : ''}`}
              >
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{m.label}</p>
                <p className="mt-1.5 text-2xl font-display font-bold tabular-nums">{m.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{m.sub}</p>
              </Link>
            ))}
          </div>
          {business.recentActivations.length > 0 && (
            <div className="border-t border-border">
              <div className="px-4 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">آخر التفعيلات</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/40 text-right text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">الكود</th>
                      <th className="px-4 py-2 font-medium">الباقة</th>
                      <th className="px-4 py-2 font-medium">المحل</th>
                      <th className="px-4 py-2 font-medium">الوقت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {business.recentActivations.map((a) => (
                      <tr key={a.code} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-2 font-mono text-xs" dir="ltr">{a.code}</td>
                        <td className="px-4 py-2">{a.planName}</td>
                        <td className="px-4 py-2">{a.resellerName || '—'}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {new Date(a.activatedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {channelOperations && (
        <section className="brand-surface overflow-hidden rounded-3xl border border-border/70">
          <div className="flex flex-col gap-3 border-b border-border bg-muted/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">حالة مصادر المحتوى</h2>
              <p className="mt-1 text-xs text-muted-foreground">تابع آخر مزامنة وأي خطأ قبل أن يؤثر في كتالوج القنوات.</p>
            </div>
            <div className="flex gap-2 text-xs">
              <Link href="/admin/m3u-sources" className="rounded-lg border border-border bg-card px-2.5 py-1.5 font-medium hover:bg-muted">مصادر M3U</Link>
              <Link href="/admin/xtream-sources" className="rounded-lg border border-border bg-card px-2.5 py-1.5 font-medium hover:bg-muted">مصادر Xtream</Link>
            </div>
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-2">
            {([
              { label: 'مصادر M3U', href: '/admin/m3u-sources', sources: channelOperations.sources.m3u },
              { label: 'مصادر Xtream', href: '/admin/xtream-sources', sources: channelOperations.sources.xtream },
            ]).map((group) => {
              const syncing = group.sources.filter((source) => source.syncStatus === 'syncing').length;
              const failed = group.sources.filter((source) => source.syncStatus === 'error').length;
              const active = group.sources.filter((source) => source.status === 'Active').length;
              return (
                <Link key={group.href} href={group.href} className="bg-card p-4 transition-colors hover:bg-primary/[0.03]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{group.label}</span>
                    <span className={failed > 0 ? 'text-xs font-medium text-signal-red' : syncing > 0 ? 'text-xs font-medium text-primary' : 'text-xs font-medium text-signal-green'}>
                      {failed > 0 ? `${failed} بحاجة إلى مراجعة` : syncing > 0 ? 'تجري المزامنة' : 'مستقرة'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{active} نشط من {group.sources.length} مصدر</p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {streamHealth && (
        <Link
          href="/admin/stats"
          className="brand-surface interactive-lift block overflow-hidden rounded-3xl border border-border/70 hover:border-primary/30"
        >
          <div className="px-4 py-2 bg-muted/50 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                سلامة البث
              </h2>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">تعمل</p>
                <p className="text-xl font-display font-bold tabular-nums text-signal-green">
                  {streamHealth.channels.totalAliveCount ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">متوقفة</p>
                <p className="text-xl font-display font-bold tabular-nums text-signal-red">
                  {streamHealth.channels.totalDeadCount ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  غير مستجيبة
                </p>
                <p className="text-xl font-display font-bold tabular-nums text-muted-foreground">
                  {streamHealth.channels.totalUnresponsiveCount ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  إجمالي مرات التشغيل
                </p>
                <p className="text-xl font-display font-bold tabular-nums text-primary">
                  {streamHealth.channels.totalPlayCount ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  تشغيل عبر Proxy
                </p>
                <p className="text-xl font-display font-bold tabular-nums text-muted-foreground">
                  {streamHealth.channels.totalProxyPlayCount ?? 0}
                </p>
              </div>
            </div>
            {streamHealth.channels.total > 0 && (
              <div className="h-2 flex mt-4 overflow-hidden">
                <div
                  className="bg-[hsl(var(--signal-green))]"
                  style={{
                    width: `${(streamHealth.channels.working / streamHealth.channels.total) * 100}%`,
                  }}
                />
                <div
                  className="bg-[hsl(var(--signal-red))]"
                  style={{
                    width: `${(streamHealth.channels.failing / streamHealth.channels.total) * 100}%`,
                  }}
                />
                <div
                  className="bg-muted"
                  style={{
                    width: `${(streamHealth.channels.untested / streamHealth.channels.total) * 100}%`,
                  }}
                />
              </div>
            )}
          </div>
        </Link>
      )}

      {channelOperations && (
        <Link
          href="/admin/stats"
          className="brand-surface interactive-lift block overflow-hidden rounded-3xl border border-border/70 hover:border-primary/30"
        >
          <div className="px-4 py-2 bg-muted/50 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tv className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                عمليات القنوات
              </h2>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-7">
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">قنوات الكتالوج</p>
              <p className="mt-1 text-xl font-display font-bold tabular-nums">{channelOperations.channels.total}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">هويات القنوات</p>
              <p className="mt-1 text-xl font-display font-bold tabular-nums">{channelOperations.identities.total}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">متعددة المصادر</p>
              <p className="mt-1 text-xl font-display font-bold tabular-nums text-primary">{channelOperations.identities.multiSource}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">لها بديل</p>
              <p className="mt-1 text-xl font-display font-bold tabular-nums text-primary">{channelOperations.channels.withFallback}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">برامج EPG</p>
              <p className="mt-1 text-xl font-display font-bold tabular-nums">{channelOperations.epg.totalPrograms}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">مصادر EPG</p>
              <p className="mt-1 text-xl font-display font-bold tabular-nums">{channelOperations.epg.sourcesDiscovered}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">أخطاء آخر تحديث</p>
              <p className={`mt-1 text-xl font-display font-bold tabular-nums ${channelOperations.epg.lastRefreshErrorCount > 0 ? 'text-signal-red' : 'text-signal-green'}`}>
                {channelOperations.epg.lastRefreshErrorCount}
              </p>
            </div>
          </div>
        </Link>
      )}

      {epgCoverage && (
        <section className="brand-surface overflow-hidden rounded-3xl border border-border/70">
          <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
            <div>
              <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">تغطية EPG ومطابقة القنوات</h2>
              <p className="mt-1 text-xs text-muted-foreground">القنوات غير المطابقة تحتاج tvg-id صحيحًا أو alias يدويًا قبل اعتماد الدليل.</p>
            </div>
            <Link href="/admin/epg" className="text-xs text-primary hover:underline">فتح إدارة EPG</Link>
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">التغطية الكلية</p><p className="mt-1 text-2xl font-display font-bold text-primary">{epgCoverage.overallCoveragePercent}%</p></div>
            <div><p className="text-xs text-muted-foreground">مطابقة القنوات</p><p className="mt-1 text-2xl font-display font-bold">{epgCoverage.matchedSystemChannels}/{epgCoverage.totalSystemChannels}</p></div>
            <div><p className="text-xs text-muted-foreground">غير مطابقة</p><p className="mt-1 text-2xl font-display font-bold text-signal-red">{epgCoverage.unmatchedChannelCount}</p></div>
            <div><p className="text-xs text-muted-foreground">مصادر الدليل</p><p className="mt-1 text-2xl font-display font-bold">{epgCoverage.sources.length}</p></div>
          </div>
          <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2">
            {epgCoverage.sources.slice(0, 6).map((source) => (
              <div key={source.source} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-medium" dir="ltr">{source.source}</span>
                  <span className={source.coveragePercent >= 80 ? 'text-signal-green' : 'text-signal-red'}>{source.coveragePercent}%</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{source.matchedChannelCount}/{source.coveredChannelCount} مطابقة</p>
                {source.unmatchedChannels.slice(0, 3).length > 0 && (
                  <p className="mt-2 truncate text-xs text-signal-red">غير مطابقة: {source.unmatchedChannels.slice(0, 3).map((channel) => channel.name).join('، ')}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {playbackQuality && playbackQuality.summary.totalEvents > 0 && (
        <Link href="/admin/stats" className="brand-surface interactive-lift block overflow-hidden rounded-3xl border border-border/70 hover:border-primary/30">
          <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
            <div>
              <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">جودة التشغيل المجهولة</h2>
              <p className="mt-1 text-xs text-muted-foreground">تجميع آخر {playbackQuality.windowDays} أيام، دون حفظ معرفات المستخدمين أو روابط البث.</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">نجاح بدء التشغيل</p><p className="mt-1 text-xl font-display font-bold text-signal-green">{playbackQuality.summary.startupSuccessRate ?? '—'}{playbackQuality.summary.startupSuccessRate === null ? '' : '%'}</p></div>
            <div><p className="text-xs text-muted-foreground">متوسط زمن البدء</p><p className="mt-1 text-xl font-display font-bold">{playbackQuality.summary.avgStartupMs ?? '—'}<span className="text-xs font-normal text-muted-foreground"> مللي ثانية</span></p></div>
            <div><p className="text-xs text-muted-foreground">متوسط rebuffer</p><p className="mt-1 text-xl font-display font-bold">{playbackQuality.summary.avgRebufferCount}</p></div>
            <div><p className="text-xs text-muted-foreground">نجاح التحويل للبديل</p><p className="mt-1 text-xl font-display font-bold text-primary">{playbackQuality.summary.fallbackSuccessRate ?? '—'}{playbackQuality.summary.fallbackSuccessRate === null ? '' : '%'}</p></div>
          </div>
        </Link>
      )}

      {config?.defaultTvCode && (
        <div className="border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
              رمز قائمة القنوات الافتراضي
            </p>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1.5">
              <span className="text-xl font-display font-bold tracking-[0.15em] font-mono">
                {config.defaultTvCode}
              </span>
              <span className="text-xs text-muted-foreground">
                تستخدم أجهزة التلفاز الجديدة هذا الرمز قبل ربط المستخدم
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`/api/v1/tv/playlist/${config.defaultTvCode}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card hover:bg-muted transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              فتح قائمة M3U
            </a>
            <button
              onClick={() => copyCode(config.defaultTvCode)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card hover:bg-muted transition-colors"
            >
              {codeCopied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-signal-green" aria-hidden="true" />
                  تم النسخ
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  نسخ
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr,300px] gap-6">
        <div className="">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
            آخر النشاطات
          </h2>
          <div className="border border-border divide-y divide-border">
            {stats?.activityFeed && stats.activityFeed.length > 0 ? (
              <ul className="divide-y divide-border">
                {stats.activityFeed.slice(0, 8).map((item, i) => (
                  <li
                    key={`${item.type || 'activity'}-${item.timestamp}-${i}`}
                    className="flex items-center gap-4 px-4 py-3"
                  >
                    <div className="shrink-0 text-right w-20">
                      <time
                        dateTime={item.timestamp}
                        className="text-xs tabular-nums text-muted-foreground font-medium"
                      >
                        {formatTime(item.timestamp)}
                      </time>
                      <time
                        dateTime={item.timestamp}
                        className="text-xs text-muted-foreground/60 ml-1.5"
                      >
                        {formatDate(item.timestamp)}
                      </time>
                    </div>
                    <span className="text-sm truncate">{item.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                لا توجد نشاطات حديثة. ستظهر هنا عند تسجيل الدخول أو إضافة القنوات أو ربط الأجهزة.
              </div>
            )}
          </div>
        </div>

        <div className="">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
            إجراءات سريعة
          </h2>
          <div className="space-y-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.label}
                  href={action.href}
                  className="interactive-lift flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-right text-sm font-medium transition-colors hover:border-primary/40 active:bg-muted"
                >
                  <Icon className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                  <span className="flex-1">{action.label}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
