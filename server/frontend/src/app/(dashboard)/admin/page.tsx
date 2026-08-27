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
import { useLocale } from '@/components/locale-provider';

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
    revenueBreakdown?: {
      creditPurchasesThisMonth: number;
      creditPurchasesTotal: number;
      batchDeliveriesThisMonth: number;
      batchDeliveriesTotal: number;
      activationsThisMonth: number;
      activationsTotal: number;
    };
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
  byReseller: Array<{ resellerId: string; name: string; city: string; monthActivations: number; totalActivations: number; purchases: number }>;
}

const quickActions = [
  { key: 'quickPick', href: '/admin/quick-pick', icon: Zap },
  { key: 'channels', href: '/admin/channels', icon: Tv },
  { key: 'users', href: '/admin/users', icon: Users },
  { key: 'devices', href: '/admin/devices', icon: Smartphone },
];

const QUICK_ACTION_LABELS: Record<string, [string, string, string]> = {
  quickPick: ['اختيار سريع', 'Sélection rapide', 'Quick pick'],
  channels: ['إدارة القنوات', 'Gérer les chaînes', 'Manage channels'],
  users: ['إدارة المستخدمين', 'Gérer les utilisateurs', 'Manage users'],
  devices: ['إدارة الأجهزة', 'Gérer les appareils', 'Manage devices'],
};

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(value: number, currency = 'DZD', locale = 'ar') {
  const l = locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-FR' : 'en-US';
  const n = new Intl.NumberFormat(l, { maximumFractionDigits: 0 }).format(value || 0);
  return `${n} ${currency}`;
}

function formatDate(timestamp: string, locale: string) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (locale === 'ar') {
    if (days === 0) return 'اليوم';
    if (days === 1) return 'أمس';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  if (locale === 'fr') {
    if (days === 0) return "aujourd'hui";
    if (days === 1) return 'hier';
    return date.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' });
  }
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

export default function AdminDashboard() {
  const { locale } = useLocale();
  const L = (ar: string, fr: string, en: string) => (locale === 'ar' ? ar : locale === 'fr' ? fr : en);
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
  const [debtSummary, setDebtSummary] = useState<{ outstanding: number; unpaidCount: number } | null>(null);
  const [error, setError] = useState('');
  const [partialError, setPartialError] = useState('');

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
    let mainMetricsFailed = false;
    if (statsResult.status !== 'fulfilled') {
      mainMetricsFailed = true;
    } else {
      const data = statsResult.value.data?.data || statsResult.value.data;
      const activityFeed: DashboardStats['activityFeed'] = [];
      for (const item of data.activity || []) {
        activityFeed.push({
          type: item.type || 'event',
          message: item.message || item.description || item.event || String(item),
          timestamp: item.timestamp || item.createdAt || new Date().toISOString(),
        });
      }

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
    }

    if (configResult.status === 'fulfilled' && configResult.value.data?.data) setConfig(configResult.value.data.data);
    if (healthResult.status === 'fulfilled' && healthResult.value.data?.data) setStreamHealth(healthResult.value.data.data);
    if (operationsResult.status === 'fulfilled') setChannelOperations(operationsResult.value);
    if (coverageResult.status === 'fulfilled') setEpgCoverage(coverageResult.value);
    if (qualityResult.status === 'fulfilled') setPlaybackQuality(qualityResult.value);
    if (businessResult.status === 'fulfilled') setBusiness(businessResult.value.data?.data || null);

    setPartialError(
      mainMetricsFailed
        ? L(
            'تعذر تحميل المؤشرات الرئيسية — تعرض الأقسام الأخرى أحدث البيانات المتاحة.',
            'Impossible de charger les indicateurs principaux — les autres sections affichent les dernières données disponibles.',
            'Failed to load main metrics — other sections show the latest available data.',
          )
        : '',
    );
    setLastUpdated(new Date());
  }, [locale]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void loadDashboard(controller.signal)
      .catch((err: unknown) => {
        if (!controller.signal.aborted && !(err instanceof Error && err.name === 'CanceledError'))
          setError(L('تعذر تحميل بيانات لوحة التحكم', 'Impossible de charger le tableau de bord', 'Failed to load dashboard data'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loadDashboard]);

  function refreshDashboard() {
    setRefreshing(true);
    setError('');
    setPartialError('');
    void loadDashboard()
      .catch(() => setError(L('تعذر تحديث بيانات لوحة التحكم', 'Impossible de rafraîchir le tableau de bord', 'Failed to refresh dashboard data')))
      .finally(() => setRefreshing(false));
  }

  useEffect(() => {
    let active = true;
    api
      .get('/admin/reseller-debts')
      .then((res) => {
        if (active) setDebtSummary(res.data?.summary || null);
      })
      .catch(() => {
        /* secondary — ignore */
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="brand-surface flex min-h-[18rem] flex-col items-center justify-center gap-3 rounded-3xl border border-border/70 px-6 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <div>
          <p className="font-medium">{L('جارٍ تجهيز مركز العمليات', 'Préparation du centre d’opérations', 'Preparing the operations center')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{L('يتم تحميل مؤشرات القنوات والمصادر والأجهزة.', 'Chargement des indicateurs de chaînes, sources et appareils.', 'Loading channel, source and device metrics.')}</p>
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div role="alert" className="brand-surface flex flex-col gap-4 rounded-3xl border border-destructive/40 bg-destructive/5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <p className="font-medium text-destructive">{error}</p>
            <p className="mt-1 text-sm text-muted-foreground">{L('تحقق من اتصال الخادم أو أعد المحاولة. لم تُجرَ أي تغييرات على القنوات أو الاشتراكات.', 'Vérifiez la connexion au serveur ou réessayez. Aucune modification n’a été apportée aux chaînes ou abonnements.', 'Check the server connection or retry. No changes were made to channels or subscriptions.')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={refreshDashboard}
          disabled={refreshing}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          {L('إعادة المحاولة', 'Réessayer', 'Retry')}
        </button>
      </div>
    );
  }

  const metrics = [
    {
      label: L('القنوات', 'Chaînes', 'Channels'),
      value: stats?.channels.total ?? 0,
      sub: L(`${stats?.channels.active ?? 0} نشطة`, `${stats?.channels.active ?? 0} actives`, `${stats?.channels.active ?? 0} active`),
      color: 'bg-signal-green',
      href: '/admin/channels',
    },
    {
      label: L('المستخدمون', 'Utilisateurs', 'Users'),
      value: stats?.users.total ?? 0,
      sub: L(`${stats?.users.active ?? 0} نشطون`, `${stats?.users.active ?? 0} actifs`, `${stats?.users.active ?? 0} active`),
      color: 'bg-signal-green',
      href: '/admin/users',
    },
    {
      label: L('الجلسات', 'Sessions', 'Sessions'),
      value: stats?.sessions.active ?? 0,
      sub: L(`${stats?.sessions.total ?? 0} إجمالي`, `${stats?.sessions.total ?? 0} au total`, `${stats?.sessions.total ?? 0} total`),
      color: 'bg-signal-blue',
      href: '/admin/devices',
    },
    {
      label: L('عمليات الربط', 'Appairages', 'Pairings'),
      value: stats?.pairings.today ?? 0,
      sub: L(`${stats?.pairings.pending ?? 0} معلقة`, `${stats?.pairings.pending ?? 0} en attente`, `${stats?.pairings.pending ?? 0} pending`),
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
        text: L(
          `فشل ${channelOperations.epg.lastRefreshErrorCount} من ${channelOperations.epg.sourcesDiscovered} مصدر EPG في آخر تحديث — دليل القنوات لا يتحدث بالكامل.`,
          `${channelOperations.epg.lastRefreshErrorCount} des ${channelOperations.epg.sourcesDiscovered} sources EPG ont échoué lors de la dernière mise à jour — le guide TV n’est pas entièrement actualisé.`,
          `${channelOperations.epg.lastRefreshErrorCount} of ${channelOperations.epg.sourcesDiscovered} EPG sources failed on the last refresh — the TV guide is not fully updating.`,
        ),
        href: '/admin/epg',
      });
    }
  }
  if (channelOperations && channelOperations.channels.failing > 0) {
    alerts.push({
      key: 'dead',
      severity: 'amber',
      text: L(
        `${channelOperations.channels.failing} قناة معطلة في الكتالوج تحتاج تنظيفًا أو بديلًا.`,
        `${channelOperations.channels.failing} chaîne(s) en panne dans le catalogue — nettoyage ou remplacement requis.`,
        `${channelOperations.channels.failing} broken channel(s) in the catalog need cleanup or replacement.`,
      ),
      href: '/admin/channels',
    });
  }
  if (debtSummary && debtSummary.unpaidCount > 0) {
    alerts.push({
      key: 'reseller-debts',
      severity: 'amber',
      text: L(
        `ديون غير مسددة على المحلات: ${debtSummary.unpaidCount} — ${Number(debtSummary.outstanding).toLocaleString()} دج`,
        `Dettes impayées des revendeurs : ${debtSummary.unpaidCount} — ${Number(debtSummary.outstanding).toLocaleString()} DZD`,
        `Unpaid reseller debts: ${debtSummary.unpaidCount} — ${Number(debtSummary.outstanding).toLocaleString()} DZD`,
      ),
      href: '/admin/resellers',
    });
  }

  return (
    <div className="dashboard-shell space-y-8 rounded-[2rem] p-1">
      {partialError && (
        <div role="alert" className="flex items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{partialError}</span>
        </div>
      )}
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
          <div className="mb-3 inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">{L('مركز العمليات', 'Centre d’opérations', 'Operations center')}</div>
          <h1 className="text-3xl font-display font-bold tracking-tight">{L('نظرة عامة', 'Aperçu', 'Overview')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{L('تابع حالة المنصة والنشاط الأخير من مكان واحد.', 'Suivez l’état de la plateforme et l’activité récente au même endroit.', 'Track platform status and recent activity in one place.')}</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="text-xs text-muted-foreground">{L('آخر تحديث', 'Dernière mise à jour', 'Last updated')} {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          <button
            type="button"
            onClick={refreshDashboard}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {L('تحديث البيانات', 'Actualiser', 'Refresh')}
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
              <h2 className="text-sm font-semibold">{L('نظرة الأعمال', 'Aperçu commercial', 'Business overview')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{L('التفعيلات والإيرادات والاشتراكات — من أكواد التفعيل والخطط.', 'Activations, revenus et abonnements — issus des codes d’activation et des forfaits.', 'Activations, revenue and subscriptions — from activation codes and plans.')}</p>
            </div>
            {!business.summary.pricesSet && business.summary.activatedTotal > 0 && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                {L('الإيراد 0 حتى تُضبط الأسعار في صفحة الباقات', 'Revenu à 0 tant que les prix ne sont pas définis dans la page des forfaits', 'Revenue is 0 until prices are set in the plans page')}
              </span>
            )}
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
            {(() => {
              const rb = business.summary.revenueBreakdown;
              const revenueSub = rb
                ? `${fmtMoney(business.summary.revenueTotal, 'DZD', locale)} ${L('إجمالي · مشتريات المحلات', 'total · achats des revendeurs', 'total · reseller purchases')} ${fmtMoney(rb.creditPurchasesTotal + rb.batchDeliveriesTotal, 'DZD', locale)}`
                : `${fmtMoney(business.summary.revenueTotal, 'DZD', locale)} ${L('إجمالي', 'total', 'total')}`;
              const cards = [
                { label: L('تفعيلات هذا الشهر', 'Activations ce mois-ci', 'Activations this month'), value: business.summary.activatedThisMonth, sub: `${business.summary.activatedTotal} ${L('إجمالي', 'au total', 'total')}`, href: '/admin/codes' },
                { label: L('إيراد هذا الشهر', 'Revenu du mois', 'Revenue this month'), value: fmtMoney(business.summary.revenueThisMonth, 'DZD', locale), sub: revenueSub, href: '/admin/resellers' },
                { label: L('اشتراكات نشطة', 'Abonnements actifs', 'Active subscriptions'), value: business.summary.activeSubscriptions, sub: `${business.summary.codesGeneratedThisMonth} ${L('كود وُلّد هذا الشهر', 'codes générés ce mois-ci', 'codes generated this month')}`, href: '/admin/users' },
                { label: L('رصيد أكواد المحلات', 'Crédit des revendeurs', 'Reseller credit'), value: business.summary.creditRemaining, sub: `${business.summary.activeResellers} ${L('محل نشط', 'revendeur actif', 'active resellers')}`, href: '/admin/resellers' },
              ];
              return cards.map((m, i) => (
                <Link
                  key={m.label}
                  href={m.href}
                  className={`bg-card p-4 transition-colors hover:bg-primary/[0.03] ${i > 0 ? 'border-l border-border' : ''}`}
                >
                  <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{m.label}</p>
                  <p className="mt-1.5 text-2xl font-display font-bold tabular-nums">{m.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{m.sub}</p>
                </Link>
              ));
            })()}
          </div>
          {business.recentActivations.length > 0 && (
            <div className="border-t border-border">
              <div className="px-4 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">{L('آخر التفعيلات', 'Dernières activations', 'Recent activations')}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/40 text-right text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">{L('الكود', 'Code', 'Code')}</th>
                      <th className="px-4 py-2 font-medium">{L('الباقة', 'Forfait', 'Plan')}</th>
                      <th className="px-4 py-2 font-medium">{L('المحل', 'Revendeur', 'Reseller')}</th>
                      <th className="px-4 py-2 font-medium">{L('الوقت', 'Heure', 'Time')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {business.recentActivations.slice(0, 8).map((a) => (
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
          {business.byReseller.length > 0 && (
            <div className="border-t border-border">
              <div className="px-4 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">{L('مبيعات المحلات', 'Ventes des revendeurs', 'Reseller sales')}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/40 text-right text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">{L('المحل', 'Revendeur', 'Reseller')}</th>
                      <th className="px-4 py-2 font-medium">{L('تفعيلات الشهر', 'Activations du mois', 'Month activations')}</th>
                      <th className="px-4 py-2 font-medium">{L('إجمالي التفعيلات', 'Activations totales', 'Total activations')}</th>
                      <th className="px-4 py-2 font-medium">{L('قيمة المشتريات', 'Montant des achats', 'Purchase value')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {business.byReseller.slice(0, 8).map((r) => (
                      <tr key={r.resellerId} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-2 font-medium">{r.name} {r.city ? <span className="text-xs text-muted-foreground">— {r.city}</span> : null}</td>
                        <td className="px-4 py-2 tabular-nums">{r.monthActivations}</td>
                        <td className="px-4 py-2 tabular-nums">{r.totalActivations}</td>
                        <td className="px-4 py-2 tabular-nums" dir="ltr">{fmtMoney(r.purchases, 'DZD', locale)}</td>
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
              <h2 className="text-sm font-semibold">{L('حالة مصادر المحتوى', 'État des sources de contenu', 'Content source status')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{L('تابع آخر مزامنة وأي خطأ قبل أن يؤثر في كتالوج القنوات.', 'Suivez la dernière synchronisation et toute erreur avant qu’elle n’affecte le catalogue.', 'Track the last sync and any errors before they affect the channel catalog.')}</p>
            </div>
            <div className="flex gap-2 text-xs">
              <Link href="/admin/m3u-sources" className="rounded-lg border border-border bg-card px-2.5 py-1.5 font-medium hover:bg-muted">{L('مصادر M3U', 'Sources M3U', 'M3U sources')}</Link>
              <Link href="/admin/xtream-sources" className="rounded-lg border border-border bg-card px-2.5 py-1.5 font-medium hover:bg-muted">{L('مصادر Xtream', 'Sources Xtream', 'Xtream sources')}</Link>
            </div>
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-2">
            {([
              { label: L('مصادر M3U', 'Sources M3U', 'M3U sources'), href: '/admin/m3u-sources', sources: channelOperations.sources.m3u },
              { label: L('مصادر Xtream', 'Sources Xtream', 'Xtream sources'), href: '/admin/xtream-sources', sources: channelOperations.sources.xtream },
            ]).map((group) => {
              const syncing = group.sources.filter((source) => source.syncStatus === 'syncing').length;
              const failed = group.sources.filter((source) => source.syncStatus === 'error').length;
              const active = group.sources.filter((source) => source.status === 'Active').length;
              return (
                <Link key={group.href} href={group.href} className="bg-card p-4 transition-colors hover:bg-primary/[0.03]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{group.label}</span>
                    <span className={failed > 0 ? 'text-xs font-medium text-signal-red' : syncing > 0 ? 'text-xs font-medium text-primary' : 'text-xs font-medium text-signal-green'}>
                      {failed > 0 ? L(`${failed} بحاجة إلى مراجعة`, `${failed} à examiner`, `${failed} need review`) : syncing > 0 ? L('تجري المزامنة', 'Synchronisation en cours', 'Syncing') : L('مستقرة', 'Stable', 'Stable')}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{L(`${active} نشط من ${group.sources.length} مصدر`, `${active} actifs sur ${group.sources.length} sources`, `${active} active of ${group.sources.length} sources`)}</p>
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
                {L('سلامة البث', 'Santé du flux', 'Stream health')}
              </h2>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{L('تعمل', 'Actifs', 'Working')}</p>
                <p className="text-xl font-display font-bold tabular-nums text-signal-green">
                  {streamHealth.channels.totalAliveCount ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{L('متوقفة', 'Morts', 'Dead')}</p>
                <p className="text-xl font-display font-bold tabular-nums text-signal-red">
                  {streamHealth.channels.totalDeadCount ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  {L('غير مستجيبة', 'Sans réponse', 'Unresponsive')}
                </p>
                <p className="text-xl font-display font-bold tabular-nums text-muted-foreground">
                  {streamHealth.channels.totalUnresponsiveCount ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  {L('إجمالي مرات التشغيل', 'Lectures totales', 'Total plays')}
                </p>
                <p className="text-xl font-display font-bold tabular-nums text-primary">
                  {streamHealth.channels.totalPlayCount ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  {L('تشغيل عبر Proxy', 'Lectures via proxy', 'Proxy plays')}
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
                {L('عمليات القنوات', 'Opérations sur les chaînes', 'Channel operations')}
              </h2>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-7">
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{L('قنوات الكتالوج', 'Chaînes du catalogue', 'Catalog channels')}</p>
              <p className="mt-1 text-xl font-display font-bold tabular-nums">{channelOperations.channels.total}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{L('هويات القنوات', 'Identités de chaînes', 'Channel identities')}</p>
              <p className="mt-1 text-xl font-display font-bold tabular-nums">{channelOperations.identities.total}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{L('متعددة المصادر', 'Multi-sources', 'Multi-source')}</p>
              <p className="mt-1 text-xl font-display font-bold tabular-nums text-primary">{channelOperations.identities.multiSource}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{L('لها بديل', 'Avec repli', 'With fallback')}</p>
              <p className="mt-1 text-xl font-display font-bold tabular-nums text-primary">{channelOperations.channels.withFallback}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{L('برامج EPG', 'Programmes EPG', 'EPG programs')}</p>
              <p className="mt-1 text-xl font-display font-bold tabular-nums">{channelOperations.epg.totalPrograms}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{L('مصادر EPG', 'Sources EPG', 'EPG sources')}</p>
              <p className="mt-1 text-xl font-display font-bold tabular-nums">{channelOperations.epg.sourcesDiscovered}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{L('أخطاء آخر تحديث', 'Erreurs de la dernière mise à jour', 'Last refresh errors')}</p>
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
              <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">{L('تغطية EPG ومطابقة القنوات', 'Couverture EPG et correspondance des chaînes', 'EPG coverage & channel matching')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{L('القنوات غير المطابقة تحتاج tvg-id صحيحًا أو alias يدويًا قبل اعتماد الدليل.', 'Les chaînes non appariées nécessitent un tvg-id valide ou un alias manuel avant d’adopter le guide.', 'Unmatched channels need a valid tvg-id or manual alias before the guide is adopted.')}</p>
            </div>
            <Link href="/admin/epg" className="text-xs text-primary hover:underline">{L('فتح إدارة EPG', 'Ouvrir la gestion EPG', 'Open EPG management')}</Link>
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">{L('التغطية الكلية', 'Couverture globale', 'Overall coverage')}</p><p className="mt-1 text-2xl font-display font-bold text-primary">{epgCoverage.overallCoveragePercent}%</p></div>
            <div><p className="text-xs text-muted-foreground">{L('مطابقة القنوات', 'Chaînes appariées', 'Matched channels')}</p><p className="mt-1 text-2xl font-display font-bold">{epgCoverage.matchedSystemChannels}/{epgCoverage.totalSystemChannels}</p></div>
            <div><p className="text-xs text-muted-foreground">{L('غير مطابقة', 'Non appariées', 'Unmatched')}</p><p className="mt-1 text-2xl font-display font-bold text-signal-red">{epgCoverage.unmatchedChannelCount}</p></div>
            <div><p className="text-xs text-muted-foreground">{L('مصادر الدليل', 'Sources du guide', 'Guide sources')}</p><p className="mt-1 text-2xl font-display font-bold">{epgCoverage.sources.length}</p></div>
          </div>
          <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2">
            {epgCoverage.sources.slice(0, 6).map((source) => (
              <div key={source.source} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-medium" dir="ltr">{source.source}</span>
                  <span className={source.coveragePercent >= 80 ? 'text-signal-green' : 'text-signal-red'}>{source.coveragePercent}%</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{L(`${source.matchedChannelCount}/${source.coveredChannelCount} مطابقة`, `${source.matchedChannelCount}/${source.coveredChannelCount} appariées`, `${source.matchedChannelCount}/${source.coveredChannelCount} matched`)}</p>
                {source.unmatchedChannels.slice(0, 3).length > 0 && (
                  <p className="mt-2 truncate text-xs text-signal-red">{L('غير مطابقة:', 'Non appariées :', 'Unmatched:')} {source.unmatchedChannels.slice(0, 3).map((channel) => channel.name).join('، ')}</p>
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
              <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">{L('جودة التشغيل', 'Qualité de lecture', 'Playback quality')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{L(`تجميع آخر ${playbackQuality.windowDays} أيام، دون حفظ معرفات المستخدمين أو روابط البث.`, `Agrégat des ${playbackQuality.windowDays} derniers jours, sans stocker d’identifiants utilisateurs ni de liens de flux.`, `Aggregated over the last ${playbackQuality.windowDays} days, without storing user IDs or stream URLs.`)}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">{L('نجاح بدء التشغيل', 'Réussite au démarrage', 'Startup success')}</p><p className="mt-1 text-xl font-display font-bold text-signal-green">{playbackQuality.summary.startupSuccessRate ?? '—'}{playbackQuality.summary.startupSuccessRate === null ? '' : '%'}</p></div>
            <div><p className="text-xs text-muted-foreground">{L('متوسط زمن البدء', 'Délai moyen de démarrage', 'Avg start time')}</p><p className="mt-1 text-xl font-display font-bold">{playbackQuality.summary.avgStartupMs ?? '—'}<span className="text-xs font-normal text-muted-foreground"> {L('مللي ثانية', 'ms', 'ms')}</span></p></div>
            <div><p className="text-xs text-muted-foreground">{L('متوسط rebuffer', 'Rebuffer moyen', 'Avg rebuffer')}</p><p className="mt-1 text-xl font-display font-bold">{playbackQuality.summary.avgRebufferCount}</p></div>
            <div><p className="text-xs text-muted-foreground">{L('نجاح التحويل للبديل', 'Réussite du repli', 'Fallback success')}</p><p className="mt-1 text-xl font-display font-bold text-primary">{playbackQuality.summary.fallbackSuccessRate ?? '—'}{playbackQuality.summary.fallbackSuccessRate === null ? '' : '%'}</p></div>
          </div>
        </Link>
      )}

      {config?.defaultTvCode && (
        <div className="border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {L('رمز قائمة القنوات الافتراضي', 'Code de liste de chaînes par défaut', 'Default channel list code')}
            </p>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1.5">
              <span className="text-xl font-display font-bold tracking-[0.15em] font-mono">
                {config.defaultTvCode}
              </span>
              <span className="text-xs text-muted-foreground">
                {L('تستخدم أجهزة التلفاز الجديدة هذا الرمز قبل ربط المستخدم', 'Les nouveaux téléviseurs utilisent ce code avant l’appairage', 'New TVs use this code before the user pairs')}
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
              {L('فتح قائمة M3U', 'Ouvrir la playlist M3U', 'Open M3U playlist')}
            </a>
            <button
              onClick={() => copyCode(config.defaultTvCode)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card hover:bg-muted transition-colors"
            >
              {codeCopied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-signal-green" aria-hidden="true" />
                  {L('تم النسخ', 'Copié', 'Copied')}
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  {L('نسخ', 'Copier', 'Copy')}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr,300px] gap-6">
        <div className="">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
            {L('آخر النشاطات', 'Activité récente', 'Recent activity')}
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
                        {formatDate(item.timestamp, locale)}
                      </time>
                    </div>
                    <span className="text-sm truncate">{item.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {L('لا توجد نشاطات حديثة. ستظهر هنا عند تسجيل الدخول أو إضافة القنوات أو ربط الأجهزة.', 'Aucune activité récente. Elle apparaîtra ici après connexion, ajout de chaînes ou appairage d’appareils.', 'No recent activity. It will show up here after logins, adding channels, or pairing devices.')}
              </div>
            )}
          </div>
        </div>

        <div className="">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
            {L('إجراءات سريعة', 'Actions rapides', 'Quick actions')}
          </h2>
          <div className="space-y-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.key}
                  href={action.href}
                  className="interactive-lift flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-right text-sm font-medium transition-colors hover:border-primary/40 active:bg-muted"
                >
                  <Icon className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                  <span className="flex-1">{QUICK_ACTION_LABELS[action.key]?.[locale === 'ar' ? 0 : locale === 'fr' ? 1 : 2] ?? action.key}</span>
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
