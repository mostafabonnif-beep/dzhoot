'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Loader2,
  Users,
  Tv,
  Smartphone,
  Activity,
  TrendingUp,
  Radio,
  Clock,
  UserPlus,
  Monitor,
  Package,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
} from 'recharts';
import api from '@/lib/api';
import { useLocale, type Locale } from '@/components/locale-provider';

interface RecentUser {
  username: string;
  email: string;
  role: string;
  createdAt: string;
  lastLogin?: string;
}

interface ActiveSession {
  username: string;
  email: string;
  lastActivity: string;
  ipAddress?: string;
  location?: string;
}

interface RecentPairing {
  deviceName: string;
  deviceModel: string;
  status: string;
  username?: string;
  createdAt: string;
}

interface StreamMetricChannel {
  _id: string;
  channelId?: string;
  channelName?: string;
  channelGroup?: string;
  metrics: {
    deadCount?: number;
    aliveCount?: number;
    unresponsiveCount?: number;
    playCount?: number;
    lastDeadAt?: string;
    lastAliveAt?: string;
    lastPlayedAt?: string;
    lastUnresponsiveAt?: string;
  };
}

interface StreamHealthData {
  channels: {
    total: number;
    working: number;
    failing: number;
    untested: number;
    avgResponseTime: number | null;
    totalDeadCount?: number;
    totalAliveCount?: number;
    totalUnresponsiveCount?: number;
    totalPlayCount?: number;
    totalProxyPlayCount?: number;
  };
  metrics?: {
    mostFailing: StreamMetricChannel[];
    mostPopular: StreamMetricChannel[];
    removalCandidates: StreamMetricChannel[];
    unresponsiveStreams: StreamMetricChannel[];
  };
  external: Array<{
    _id: string;
    total: number;
    alive: number;
    dead: number;
    unknown: number;
    avgResponseTime: number | null;
  }>;
}

interface SchedulerTask {
  taskName: string;
  lastStatus: string;
  lastStartedAt: string;
  lastDurationMs: number | null;
  lastError?: string;
  totalRuns: number;
  completed: number;
  failed: number;
  avgDuration: number | null;
}

interface DetailedStats {
  channels: {
    total: number;
    active: number;
    inactive: number;
    byGroup: Array<{ _id: string; count: number }> | Record<string, number>;
  };
  users: { total: number; active: number; recent: RecentUser[] };
  sessions: {
    total: number;
    active: number;
    activeSessions: ActiveSession[];
    byLocation?: Array<{ _id: string; count: number }>;
  };
  pairings: {
    total: number;
    pending: number;
    completed: number;
    today: number;
    recent: RecentPairing[];
  };
  appVersions: { total: number; latest: string | null };
}

interface TrendPoint {
  date: string;
  count: number;
}

type TimeRange = '7d' | '30d' | '90d';

const CHART_COLORS = [
  'hsl(38, 75%, 38%)',
  'hsl(142, 60%, 34%)',
  'hsl(220, 60%, 50%)',
  'hsl(280, 50%, 50%)',
  'hsl(0, 55%, 48%)',
  'hsl(180, 50%, 40%)',
  'hsl(60, 55%, 42%)',
  'hsl(330, 50%, 45%)',
  'hsl(200, 60%, 45%)',
  'hsl(100, 45%, 40%)',
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(ts: string | null | undefined, locale: Locale): string {
  if (!ts) return '—';
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (isNaN(sec)) return '—';
  if (sec < 60)
    return locale === 'ar' ? 'الآن' : locale === 'fr' ? "à l'instant" : 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60)
    return locale === 'ar'
      ? `منذ ${min} دقيقة`
      : locale === 'fr'
        ? `il y a ${min} min`
        : `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24)
    return locale === 'ar'
      ? `منذ ${hrs} ساعة`
      : locale === 'fr'
        ? `il y a ${hrs} h`
        : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return locale === 'ar'
    ? `منذ ${days} يوم`
    : locale === 'fr'
      ? `il y a ${days} j`
      : `${days}d ago`;
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatSourceName(id: string): string {
  return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const TASK_STATUS_LABELS: Record<string, (l: Locale) => string> = {
  completed: (l) => (l === 'ar' ? 'مكتمل' : l === 'fr' ? 'Terminé' : 'Completed'),
  failed: (l) => (l === 'ar' ? 'فشل' : l === 'fr' ? 'Échoué' : 'Failed'),
  running: (l) => (l === 'ar' ? 'قيد التشغيل' : l === 'fr' ? 'En cours' : 'Running'),
  pending: (l) => (l === 'ar' ? 'معلق' : l === 'fr' ? 'En attente' : 'Pending'),
};

const PAIRING_STATUS_LABELS: Record<string, (l: Locale) => string> = {
  completed: (l) => (l === 'ar' ? 'مكتملة' : l === 'fr' ? 'Terminé' : 'Completed'),
  pending: (l) => (l === 'ar' ? 'معلقة' : l === 'fr' ? 'En attente' : 'Pending'),
  expired: (l) => (l === 'ar' ? 'منتهية' : l === 'fr' ? 'Expiré' : 'Expired'),
};

function normalizeByGroup(
  byGroup: Array<{ _id: string; count: number }> | Record<string, number>,
  locale: Locale,
): Array<{ name: string; value: number }> {
  const uncategorized =
    locale === 'ar' ? 'غير مصنف' : locale === 'fr' ? 'Non catégorisé' : 'Uncategorized';
  if (Array.isArray(byGroup)) {
    return byGroup.map((g) => ({
      name: g._id || uncategorized,
      value: g.count,
    }));
  }
  return Object.entries(byGroup).map(([name, value]) => ({
    name: name || uncategorized,
    value,
  }));
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
}) {
  return (
    <div className="border border-border p-4 flex items-center gap-3">
      <div className="h-10 w-10 flex items-center justify-center bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-display font-bold tabular-nums">{value}</p>
        <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border">
      <div className="px-4 py-2 bg-muted/50 border-b border-border">
        <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
          {title}
        </h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-border bg-background px-3 py-2 text-sm shadow-sm">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-display font-bold tabular-nums">{payload[0].value}</p>
    </div>
  );
}

function TrendChart({
  title,
  data,
  color,
  range,
  onRangeChange,
}: {
  title: string;
  data: TrendPoint[];
  color: string;
  range: TimeRange;
  onRangeChange: (r: TimeRange) => void;
}) {
  const { locale } = useLocale();
  const ranges: TimeRange[] = ['7d', '30d', '90d'];
  const formatted = data.map((d) => ({ ...d, label: formatDate(d.date) }));

  return (
    <div className="border border-border">
      <div className="px-4 py-2 bg-muted/50 border-b border-border flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
          {title}
        </h2>
        <div className="flex gap-1">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              className={`px-2 py-0.5 text-xs uppercase tracking-[0.1em] transition-colors ${
                range === r
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {locale === 'ar'
              ? 'لا توجد بيانات لهذه الفترة'
              : locale === 'fr'
                ? 'Aucune donnée pour cette période'
                : 'No data for this period'}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={formatted}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="count"
                stroke={color}
                fill={color}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default function StatsPage() {
  const { locale } = useLocale();
  const [stats, setStats] = useState<DetailedStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [userTrend, setUserTrend] = useState<TrendPoint[]>([]);
  const [sessionTrend, setSessionTrend] = useState<TrendPoint[]>([]);
  const [pairingTrend, setPairingTrend] = useState<TrendPoint[]>([]);

  const [streamHealth, setStreamHealth] = useState<StreamHealthData | null>(null);
  const [schedulerTasks, setSchedulerTasks] = useState<SchedulerTask[]>([]);

  const [userRange, setUserRange] = useState<TimeRange>('30d');
  const [sessionRange, setSessionRange] = useState<TimeRange>('30d');
  const [pairingRange, setPairingRange] = useState<TimeRange>('30d');

  useEffect(() => {
    const controller = new AbortController();
    async function fetchAll() {
      try {
        const [detailedRes, healthRes, schedulerRes] = await Promise.all([
          api.get('/admin/stats/detailed', { signal: controller.signal }),
          api.get('/admin/stats/stream-health', { signal: controller.signal }).catch(() => null),
          api.get('/admin/stats/scheduler', { signal: controller.signal }).catch(() => null),
        ]);
        if (controller.signal.aborted) return;

        const d = detailedRes.data?.data || detailedRes.data;
        setStats({
          channels: {
            total: d.channels?.total ?? 0,
            active: d.channels?.active ?? 0,
            inactive: d.channels?.inactive ?? 0,
            byGroup: d.channels?.byGroup || [],
          },
          users: {
            total: d.users?.total ?? 0,
            active: d.users?.active ?? 0,
            recent: d.users?.recent || [],
          },
          sessions: {
            total: d.sessions?.total ?? 0,
            active: d.sessions?.active ?? 0,
            activeSessions: d.sessions?.activeSessions || [],
            byLocation: d.sessions?.byLocation || [],
          },
          pairings: {
            total: d.pairings?.total ?? 0,
            pending: d.pairings?.pending ?? 0,
            completed: d.pairings?.completed ?? 0,
            today: d.pairings?.todayCount ?? d.pairings?.today ?? 0,
            recent: d.pairings?.recent || [],
          },
          appVersions: {
            total: d.app?.totalVersions ?? d.appVersions?.total ?? 0,
            // latestVersion is the full version DOC, not a string — normalize to
            // versionName (or apkFileName) so it can be rendered safely.
            latest: (() => {
              const raw = d.app?.latestVersion ?? d.appVersions?.latest ?? null;
              if (!raw) return null;
              if (typeof raw === 'string') return raw;
              return raw.versionName || raw.apkFileName || String(raw._id || '');
            })(),
          },
        });

        if (healthRes) setStreamHealth(healthRes.data?.data || null);
        if (schedulerRes) setSchedulerTasks(schedulerRes.data?.data || []);
      } catch {
        if (controller.signal.aborted) return;
        setError('تعذر تحميل الإحصائيات');
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
    return () => controller.abort();
  }, []);

  const fetchTrend = useCallback(
    async (
      type: string,
      range: TimeRange,
      setter: (d: TrendPoint[]) => void,
      signal?: AbortSignal,
    ) => {
      try {
        const res = await api.get(`/admin/stats/trends/${type}?range=${range}`, { signal });
        if (signal?.aborted) return;
        setter(res.data?.data || []);
      } catch (err: unknown) {
        if (signal?.aborted) return;
        if (
          err instanceof Error &&
          (err.name === 'AbortError' || (err as { code?: string }).code === 'ERR_CANCELED')
        )
          return;
        setter([]);
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchTrend('users', userRange, setUserTrend, controller.signal);
    return () => controller.abort();
  }, [userRange, fetchTrend]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTrend('sessions', sessionRange, setSessionTrend, controller.signal);
    return () => controller.abort();
  }, [sessionRange, fetchTrend]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTrend('pairings', pairingRange, setPairingTrend, controller.signal);
    return () => controller.abort();
  }, [pairingRange, fetchTrend]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        {error}
      </div>
    );
  }

  const channelGroups = normalizeByGroup(stats?.channels.byGroup || [], locale);
  const locationData = (stats?.sessions.byLocation || []).map((l) => ({
    name: l._id || (locale === 'ar' ? 'غير معروف' : locale === 'fr' ? 'Inconnu' : 'Unknown'),
    value: l.count,
  }));
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">
          {locale === 'ar' ? 'الإحصائيات' : locale === 'fr' ? 'Statistiques' : 'Statistics'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {locale === 'ar'
            ? 'مؤشرات النظام واتجاهاته'
            : locale === 'fr'
              ? 'Métriques système et tendances'
              : 'System metrics and trends'}
        </p>
      </div>


      {/* Overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={
            locale === 'ar' ? 'إجمالي القنوات' : locale === 'fr' ? 'Total des chaînes' : 'Total Channels'
          }
          value={stats?.channels.total ?? 0}
          icon={Tv}
        />
        <StatCard
          label={
            locale === 'ar'
              ? 'إجمالي المستخدمين'
              : locale === 'fr'
                ? 'Total des utilisateurs'
                : 'Total Users'
          }
          value={stats?.users.total ?? 0}
          icon={Users}
        />
        <StatCard
          label={
            locale === 'ar' ? 'الجلسات النشطة' : locale === 'fr' ? 'Sessions actives' : 'Active Sessions'
          }
          value={stats?.sessions.active ?? 0}
          icon={Activity}
        />
        <StatCard
          label={
            locale === 'ar'
              ? 'عمليات الربط اليوم'
              : locale === 'fr'
                ? 'Appairages du jour'
                : "Today's Pairings"
          }
          value={stats?.pairings.today ?? 0}
          icon={Smartphone}
        />
        <StatCard
          label={
            locale === 'ar'
              ? 'إصدارات التطبيق'
              : locale === 'fr'
                ? 'Versions de l’application'
                : 'App releases'
          }
          value={stats?.appVersions.total ?? 0}
          icon={Package}
        />
      </div>

      {/* App version strip (data was fetched but never rendered before) */}
      {stats?.appVersions.latest && (
        <div className="border border-border px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {locale === 'ar'
              ? 'أحدث إصدار منشور:'
              : locale === 'fr'
                ? 'Dernière version publiée :'
                : 'Latest published release:'}
          </span>
          <code className="text-xs font-mono bg-muted px-2 py-1 border border-border" dir="ltr">
            {String(stats.appVersions.latest)}
          </code>
          <a
            href="/admin/versions"
            className="text-xs text-primary hover:underline"
          >
            {locale === 'ar'
              ? 'فتح صفحة الإصدارات ←'
              : locale === 'fr'
                ? 'Ouvrir les versions ←'
                : 'Open releases →'}
          </a>
        </div>
      )}

      {/* Charts row: Pie + Bar */}
      <div className="grid md:grid-cols-2 gap-6">
        <ChartCard
          title={
            locale === 'ar'
              ? 'القنوات حسب المجموعة'
              : locale === 'fr'
                ? 'Chaînes par groupe'
                : 'Channels by Group'
          }
        >
          {channelGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {locale === 'ar'
                ? 'لا توجد بيانات قنوات'
                : locale === 'fr'
                  ? 'Aucune donnée de chaîne'
                  : 'No channel data'}
            </p>
          ) : (
            <div className="flex flex-col items-center">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={channelGroups}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    dataKey="value"
                    nameKey="name"
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                  >
                    {channelGroups.map((_entry, index) => (
                      <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
                {channelGroups.slice(0, 8).map((g, i) => (
                  <div key={g.name} className="flex items-center gap-1.5 text-xs">
                    <span
                      className="inline-block h-2.5 w-2.5"
                      style={{
                        backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                    <span className="text-muted-foreground truncate max-w-[120px]">{g.name}</span>
                    <span className="font-display font-bold tabular-nums">{g.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard
          title={
            locale === 'ar'
              ? 'الجلسات حسب الموقع'
              : locale === 'fr'
                ? 'Sessions par emplacement'
                : 'Sessions by Location'
          }
        >
          {locationData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {locale === 'ar'
                ? 'لا توجد بيانات مواقع'
                : locale === 'fr'
                  ? 'Aucune donnée de localisation'
                  : 'No location data'}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={locationData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{
                    fontSize: 11,
                    fill: 'hsl(var(--muted-foreground))',
                  }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{
                    fontSize: 11,
                    fill: 'hsl(var(--muted-foreground))',
                  }}
                  tickLine={false}
                  axisLine={false}
                  width={100}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" fill="hsl(220, 60%, 50%)" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Trend charts */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            {locale === 'ar'
              ? 'الاتجاهات بمرور الوقت'
              : locale === 'fr'
                ? 'Tendances au fil du temps'
                : 'Trends Over Time'}
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          <TrendChart
            title={
              locale === 'ar'
                ? 'تسجيلات المستخدمين'
                : locale === 'fr'
                  ? 'Inscriptions utilisateurs'
                  : 'User Registrations'
            }
            data={userTrend}
            color="hsl(38, 75%, 38%)"
            range={userRange}
            onRangeChange={setUserRange}
          />
          <TrendChart
            title={locale === 'ar' ? 'الجلسات' : locale === 'fr' ? 'Sessions' : 'Sessions'}
            data={sessionTrend}
            color="hsl(220, 60%, 50%)"
            range={sessionRange}
            onRangeChange={setSessionRange}
          />
          <TrendChart
            title={
              locale === 'ar' ? 'ربط الأجهزة' : locale === 'fr' ? 'Appairages' : 'Pairings'
            }
            data={pairingTrend}
            color="hsl(142, 60%, 34%)"
            range={pairingRange}
            onRangeChange={setPairingRange}
          />
        </div>
      </div>

      {/* Summary table */}
      <div className="grid sm:grid-cols-2 gap-6">
        <div className="border border-border">
          <div className="px-4 py-2 bg-muted/50 border-b border-border">
            <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
              {locale === 'ar' ? 'القنوات' : locale === 'fr' ? 'Chaînes' : 'Channels'}
            </h2>
          </div>
          <dl className="divide-y divide-border">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'نشطة' : locale === 'fr' ? 'Actives' : 'Active'}
              </dt>
              <dd className="text-sm font-display font-bold tabular-nums">
                {stats?.channels.active}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'غير نشطة' : locale === 'fr' ? 'Inactives' : 'Inactive'}
              </dt>
              <dd className="text-sm font-display font-bold tabular-nums">
                {stats?.channels.inactive}
              </dd>
            </div>
          </dl>
        </div>

        <div className="border border-border">
          <div className="px-4 py-2 bg-muted/50 border-b border-border">
            <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
              {locale === 'ar' ? 'ربط الأجهزة' : locale === 'fr' ? 'Appairages' : 'Pairings'}
            </h2>
          </div>
          <dl className="divide-y divide-border">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'الإجمالي' : locale === 'fr' ? 'Total' : 'Total'}
              </dt>
              <dd className="text-sm font-display font-bold tabular-nums">
                {stats?.pairings.total}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'مكتملة' : locale === 'fr' ? 'Complétées' : 'Completed'}
              </dt>
              <dd className="text-sm font-display font-bold tabular-nums">
                {stats?.pairings.completed}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'معلقة' : locale === 'fr' ? 'En attente' : 'Pending'}
              </dt>
              <dd className="text-sm font-display font-bold tabular-nums">
                {stats?.pairings.pending}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* سلامة البث */}
      {streamHealth && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Radio className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
              {locale === 'ar' ? 'سلامة البث' : locale === 'fr' ? 'Santé des flux' : 'Stream Health'}
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Local channels */}
            <div className="border border-border">
              <div className="px-4 py-2 bg-muted/50 border-b border-border">
                <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                  {locale === 'ar'
                    ? 'القنوات المحلية'
                    : locale === 'fr'
                      ? 'Chaînes locales'
                      : 'Local Channels'}
                </h3>
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {locale === 'ar' ? 'تعمل' : locale === 'fr' ? 'Fonctionnelles' : 'Working'}
                  </span>
                  <span className="font-display font-bold tabular-nums text-[hsl(var(--signal-green))]">
                    {streamHealth.channels.working}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {locale === 'ar' ? 'متوقفة' : locale === 'fr' ? 'En panne' : 'Down'}
                  </span>
                  <span className="font-display font-bold tabular-nums text-[hsl(var(--signal-red))]">
                    {streamHealth.channels.failing}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {locale === 'ar' ? 'غير مختبرة' : locale === 'fr' ? 'Non testées' : 'Untested'}
                  </span>
                  <span className="font-display font-bold tabular-nums">
                    {streamHealth.channels.untested}
                  </span>
                </div>
                {streamHealth.channels.avgResponseTime != null && (
                  <div className="flex items-center justify-between text-sm pt-1 border-t border-border">
                    <span className="text-muted-foreground">
                      {locale === 'ar'
                        ? 'متوسط الاستجابة'
                        : locale === 'fr'
                          ? 'Temps de réponse moyen'
                          : 'Avg Response Time'}
                    </span>
                    <span className="font-display font-bold tabular-nums">
                      {formatMs(streamHealth.channels.avgResponseTime)}
                    </span>
                  </div>
                )}
                {streamHealth.channels.total > 0 && (
                  <div className="h-2 flex mt-2 overflow-hidden">
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
            </div>

            {/* External sources */}
            {streamHealth.external.map((src) => (
              <div key={src._id} className="border border-border">
                <div className="px-4 py-2 bg-muted/50 border-b border-border">
                  <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                    {formatSourceName(src._id)}
                  </h3>
                </div>
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {locale === 'ar' ? 'متاح' : locale === 'fr' ? 'Actif' : 'Alive'}
                    </span>
                    <span className="font-display font-bold tabular-nums text-[hsl(var(--signal-green))]">
                      {src.alive}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {locale === 'ar' ? 'متوقف' : locale === 'fr' ? 'Inactif' : 'Dead'}
                    </span>
                    <span className="font-display font-bold tabular-nums text-[hsl(var(--signal-red))]">
                      {src.dead}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {locale === 'ar' ? 'غير معروف' : locale === 'fr' ? 'Inconnu' : 'Unknown'}
                    </span>
                    <span className="font-display font-bold tabular-nums">{src.unknown}</span>
                  </div>
                  {src.avgResponseTime != null && (
                    <div className="flex items-center justify-between text-sm pt-1 border-t border-border">
                      <span className="text-muted-foreground">
                        {locale === 'ar'
                          ? 'متوسط الاستجابة'
                          : locale === 'fr'
                            ? 'Temps de réponse moyen'
                            : 'Avg Response Time'}
                      </span>
                      <span className="font-display font-bold tabular-nums">
                        {formatMs(src.avgResponseTime)}
                      </span>
                    </div>
                  )}
                  {src.total > 0 && (
                    <div className="h-2 flex mt-2 overflow-hidden">
                      <div
                        className="bg-[hsl(var(--signal-green))]"
                        style={{ width: `${(src.alive / src.total) * 100}%` }}
                      />
                      <div
                        className="bg-[hsl(var(--signal-red))]"
                        style={{ width: `${(src.dead / src.total) * 100}%` }}
                      />
                      <div
                        className="bg-muted"
                        style={{ width: `${(src.unknown / src.total) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stream Metrics Analytics */}
      {streamHealth?.metrics && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
              {locale === 'ar'
                ? 'مقاييس البث'
                : locale === 'fr'
                  ? 'Métriques des flux'
                  : 'Stream Metrics'}
            </h2>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              label={
                locale === 'ar' ? 'إجمالي المتاحة' : locale === 'fr' ? 'Total actifs' : 'Total Alive'
              }
              value={streamHealth.channels.totalAliveCount ?? 0}
              icon={Radio}
            />
            <StatCard
              label={
                locale === 'ar'
                  ? 'إجمالي المتوقفة'
                  : locale === 'fr'
                    ? 'Total inactifs'
                    : 'Total Dead'
              }
              value={streamHealth.channels.totalDeadCount ?? 0}
              icon={Radio}
            />
            <StatCard
              label={
                locale === 'ar'
                  ? 'إجمالي غير المستجيبة'
                  : locale === 'fr'
                    ? 'Total sans réponse'
                    : 'Total Unresponsive'
              }
              value={streamHealth.channels.totalUnresponsiveCount ?? 0}
              icon={Radio}
            />
            <StatCard
              label={
                locale === 'ar'
                  ? 'إجمالي التشغيلات'
                  : locale === 'fr'
                    ? 'Total des lectures'
                    : 'Total Plays'
              }
              value={streamHealth.channels.totalPlayCount ?? 0}
              icon={Radio}
            />
            <StatCard
              label={
                locale === 'ar'
                  ? 'التشغيلات عبر الوكيل'
                  : locale === 'fr'
                    ? 'Lectures via proxy'
                    : 'Proxy Plays'
              }
              value={streamHealth.channels.totalProxyPlayCount ?? 0}
              icon={Radio}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* القنوات الأكثر توقفًا */}
            <ChartCard
              title={
                locale === 'ar'
                  ? 'القنوات الأكثر توقفًا'
                  : locale === 'fr'
                    ? 'Flux les plus en panne'
                    : 'Most Failing Streams'
              }
            >
              {streamHealth.metrics.mostFailing.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {locale === 'ar'
                    ? 'لا توجد قنوات متوقفة'
                    : locale === 'fr'
                      ? 'Aucune chaîne en panne'
                      : 'No down channels'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="pb-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                          {locale === 'ar' ? 'القناة' : locale === 'fr' ? 'Chaîne' : 'Channel'}
                        </th>
                        <th className="pb-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hidden sm:table-cell">
                          {locale === 'ar' ? 'المجموعة' : locale === 'fr' ? 'Groupe' : 'Group'}
                        </th>
                        <th className="pb-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                          {locale === 'ar' ? 'متوقفة' : locale === 'fr' ? 'En panne' : 'Down'}
                        </th>
                        <th className="pb-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hidden sm:table-cell">
                          {locale === 'ar'
                            ? 'آخر توقف'
                            : locale === 'fr'
                              ? 'Dernier arrêt'
                              : 'Last Dead'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {streamHealth.metrics.mostFailing.map((ch) => (
                        <tr key={ch._id}>
                          <td className="py-2 font-medium truncate max-w-[160px]">
                            {ch.channelName ||
                              (locale === 'ar' ? 'غير معروف' : locale === 'fr' ? 'Inconnu' : 'Unknown')}
                          </td>
                          <td className="py-2 text-muted-foreground truncate max-w-[100px] hidden sm:table-cell">
                            {ch.channelGroup || '—'}
                          </td>
                          <td className="py-2 text-right font-display font-bold tabular-nums text-[hsl(var(--signal-red))]">
                            {ch.metrics.deadCount ?? 0}
                          </td>
                          <td className="py-2 text-right text-muted-foreground hidden sm:table-cell">
                            {ch.metrics.lastDeadAt ? timeAgo(ch.metrics.lastDeadAt, locale) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ChartCard>

            {/* Most Popular */}
            <ChartCard
              title={
                locale === 'ar'
                  ? 'القنوات الأكثر تشغيلًا'
                  : locale === 'fr'
                    ? 'Chaînes les plus lues'
                    : 'Most Played Channels'
              }
            >
              {streamHealth.metrics.mostPopular.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {locale === 'ar'
                    ? 'لا توجد بيانات تشغيل'
                    : locale === 'fr'
                      ? 'Aucune donnée de lecture'
                      : 'No play data'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="pb-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                          {locale === 'ar' ? 'القناة' : locale === 'fr' ? 'Chaîne' : 'Channel'}
                        </th>
                        <th className="pb-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hidden sm:table-cell">
                          {locale === 'ar' ? 'المجموعة' : locale === 'fr' ? 'Groupe' : 'Group'}
                        </th>
                        <th className="pb-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                          {locale === 'ar' ? 'مرات التشغيل' : locale === 'fr' ? 'Lectures' : 'Plays'}
                        </th>
                        <th className="pb-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hidden sm:table-cell">
                          {locale === 'ar'
                            ? 'آخر تشغيل'
                            : locale === 'fr'
                              ? 'Dernière lecture'
                              : 'Last Played'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {streamHealth.metrics.mostPopular.map((ch) => (
                        <tr key={ch._id}>
                          <td className="py-2 font-medium truncate max-w-[160px]">
                            {ch.channelName ||
                              (locale === 'ar' ? 'غير معروف' : locale === 'fr' ? 'Inconnu' : 'Unknown')}
                          </td>
                          <td className="py-2 text-muted-foreground truncate max-w-[100px] hidden sm:table-cell">
                            {ch.channelGroup || '—'}
                          </td>
                          <td className="py-2 text-right font-display font-bold tabular-nums text-primary">
                            {ch.metrics.playCount ?? 0}
                          </td>
                          <td className="py-2 text-right text-muted-foreground hidden sm:table-cell">
                            {ch.metrics.lastPlayedAt
                              ? timeAgo(ch.metrics.lastPlayedAt, locale)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ChartCard>

            {/* Removal Candidates */}
            <ChartCard
              title={
                locale === 'ar'
                  ? 'مرشحو الإزالة'
                  : locale === 'fr'
                    ? 'Candidats à la suppression'
                    : 'Removal Candidates'
              }
            >
              {streamHealth.metrics.removalCandidates.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {locale === 'ar'
                    ? 'لا يوجد مرشحون للإزالة'
                    : locale === 'fr'
                      ? 'Aucun candidat à la suppression'
                      : 'No removal candidates'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="pb-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                          {locale === 'ar' ? 'القناة' : locale === 'fr' ? 'Chaîne' : 'Channel'}
                        </th>
                        <th className="pb-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hidden sm:table-cell">
                          {locale === 'ar' ? 'المجموعة' : locale === 'fr' ? 'Groupe' : 'Group'}
                        </th>
                        <th className="pb-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                          {locale === 'ar' ? 'متوقفة' : locale === 'fr' ? 'En panne' : 'Down'}
                        </th>
                        <th className="pb-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                          {locale === 'ar' ? 'مرات التشغيل' : locale === 'fr' ? 'Lectures' : 'Plays'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {streamHealth.metrics.removalCandidates.map((ch) => (
                        <tr key={ch._id}>
                          <td className="py-2 font-medium truncate max-w-[160px]">
                            {ch.channelName ||
                              (locale === 'ar' ? 'غير معروف' : locale === 'fr' ? 'Inconnu' : 'Unknown')}
                          </td>
                          <td className="py-2 text-muted-foreground truncate max-w-[100px] hidden sm:table-cell">
                            {ch.channelGroup || '—'}
                          </td>
                          <td className="py-2 text-right font-display font-bold tabular-nums text-[hsl(var(--signal-red))]">
                            {ch.metrics.deadCount ?? 0}
                          </td>
                          <td className="py-2 text-right font-display tabular-nums text-muted-foreground">
                            {ch.metrics.playCount ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ChartCard>

            {/* Unresponsive Streams */}
            <ChartCard
              title={
                locale === 'ar'
                  ? 'بث غير مستجيب'
                  : locale === 'fr'
                    ? 'Flux sans réponse'
                    : 'Unresponsive Streams'
              }
            >
              {streamHealth.metrics.unresponsiveStreams.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {locale === 'ar'
                    ? 'لا توجد بثوث غير مستجيبة'
                    : locale === 'fr'
                      ? 'Aucun flux sans réponse'
                      : 'No unresponsive streams'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="pb-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                          {locale === 'ar' ? 'القناة' : locale === 'fr' ? 'Chaîne' : 'Channel'}
                        </th>
                        <th className="pb-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hidden sm:table-cell">
                          {locale === 'ar' ? 'المجموعة' : locale === 'fr' ? 'Groupe' : 'Group'}
                        </th>
                        <th className="pb-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                          {locale === 'ar' ? 'العدد' : locale === 'fr' ? 'Nombre' : 'Count'}
                        </th>
                        <th className="pb-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hidden sm:table-cell">
                          {locale === 'ar' ? 'آخر مرة' : locale === 'fr' ? 'Dernière' : 'Last'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {streamHealth.metrics.unresponsiveStreams.map((ch) => (
                        <tr key={ch._id}>
                          <td className="py-2 font-medium truncate max-w-[160px]">
                            {ch.channelName ||
                              (locale === 'ar' ? 'غير معروف' : locale === 'fr' ? 'Inconnu' : 'Unknown')}
                          </td>
                          <td className="py-2 text-muted-foreground truncate max-w-[100px] hidden sm:table-cell">
                            {ch.channelGroup || '—'}
                          </td>
                          <td className="py-2 text-right font-display font-bold tabular-nums">
                            {ch.metrics.unresponsiveCount ?? 0}
                          </td>
                          <td className="py-2 text-right text-muted-foreground hidden sm:table-cell">
                            {ch.metrics.lastUnresponsiveAt
                              ? timeAgo(ch.metrics.lastUnresponsiveAt, locale)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ChartCard>
          </div>
        </div>
      )}

      {/* Scheduler Task History */}
      {schedulerTasks.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
              {locale === 'ar'
                ? 'المهام المجدولة'
                : locale === 'fr'
                  ? 'Tâches planifiées'
                  : 'Scheduler Tasks'}
            </h2>
          </div>
          <div className="border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-4 py-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                    {locale === 'ar' ? 'المهمة' : locale === 'fr' ? 'Tâche' : 'Task'}
                  </th>
                  <th className="px-4 py-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                    {locale === 'ar'
                      ? 'آخر حالة'
                      : locale === 'fr'
                        ? 'Dernier statut'
                        : 'Last Status'}
                  </th>
                  <th className="px-4 py-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hidden sm:table-cell">
                    {locale === 'ar'
                      ? 'آخر تشغيل'
                      : locale === 'fr'
                        ? 'Dernière exécution'
                        : 'Last Run'}
                  </th>
                  <th className="px-4 py-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hidden md:table-cell">
                    {locale === 'ar' ? 'المدة' : locale === 'fr' ? 'Durée' : 'Duration'}
                  </th>
                  <th className="px-4 py-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hidden lg:table-cell">
                    {locale === 'ar'
                      ? 'نسبة النجاح'
                      : locale === 'fr'
                        ? 'Taux de réussite'
                        : 'Success Rate'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {schedulerTasks.map((task) => {
                  const rate =
                    task.totalRuns > 0
                      ? Math.round((task.completed / task.totalRuns) * 100)
                      : null;
                  return (
                    <tr key={task.taskName}>
                      <td className="px-4 py-2.5 font-medium truncate max-w-[200px]">
                        {task.taskName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-block px-1.5 py-0.5 text-xs uppercase tracking-[0.1em] ${
                            task.lastStatus === 'completed'
                              ? 'bg-[hsl(var(--signal-green))]/15 text-[hsl(var(--signal-green))]'
                              : task.lastStatus === 'failed'
                                ? 'bg-[hsl(var(--signal-red))]/15 text-[hsl(var(--signal-red))]'
                                : task.lastStatus === 'running'
                                  ? 'bg-primary/15 text-primary'
                                  : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {TASK_STATUS_LABELS[task.lastStatus]?.(locale) ?? task.lastStatus}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                        {task.lastStartedAt ? timeAgo(task.lastStartedAt, locale) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-display tabular-nums hidden md:table-cell">
                        {formatMs(task.lastDurationMs)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-display tabular-nums hidden lg:table-cell">
                        {rate != null ? `${rate}%` : '—'}
                        {task.totalRuns > 0 && (
                          <span className="text-muted-foreground text-xs ml-1">
                            ({task.completed}/{task.totalRuns})
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Users / الجلسات النشطة / Recent Pairings */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Users */}
        <ChartCard
          title={
            locale === 'ar'
              ? 'أحدث المستخدمين'
              : locale === 'fr'
                ? 'Utilisateurs récents'
                : 'Recent Users'
          }
        >
          {(stats?.users.recent?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {locale === 'ar'
                ? 'لا يوجد مستخدمون جدد'
                : locale === 'fr'
                  ? 'Aucun utilisateur récent'
                  : 'No recent users'}
            </p>
          ) : (
            <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
              {stats?.users.recent.slice(0, 8).map((u, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="h-7 w-7 flex items-center justify-center bg-primary/10 text-primary shrink-0">
                    <UserPlus className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{u.username}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {timeAgo(u.createdAt, locale)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ChartCard>

        {/* الجلسات النشطة */}
        <ChartCard
          title={
            locale === 'ar' ? 'الجلسات النشطة' : locale === 'fr' ? 'Sessions actives' : 'Active Sessions'
          }
        >
          {(stats?.sessions.activeSessions?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {locale === 'ar'
                ? 'لا توجد جلسات نشطة'
                : locale === 'fr'
                  ? 'Aucune session active'
                  : 'No active sessions'}
            </p>
          ) : (
            <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
              {stats?.sessions.activeSessions.slice(0, 8).map((s, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="h-7 w-7 flex items-center justify-center bg-[hsl(var(--signal-green))]/10 text-[hsl(var(--signal-green))] shrink-0">
                    <Monitor className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{s.username}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {s.location && s.location !== 'غير معروف'
                        ? s.location
                        : s.ipAddress ||
                          (locale === 'ar' ? 'غير معروف' : locale === 'fr' ? 'Inconnu' : 'Unknown')}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {timeAgo(s.lastActivity, locale)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ChartCard>

        {/* Recent Pairings */}
        <ChartCard
          title={
            locale === 'ar'
              ? 'أحدث عمليات الربط'
              : locale === 'fr'
                ? 'Appairages récents'
                : 'Recent Pairings'
          }
        >
          {(stats?.pairings.recent?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {locale === 'ar'
                ? 'لا توجد عمليات ربط حديثة'
                : locale === 'fr'
                  ? 'Aucun appairage récent'
                  : 'No recent pairings'}
            </p>
          ) : (
            <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
              {stats?.pairings.recent.slice(0, 8).map((p, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="h-7 w-7 flex items-center justify-center bg-primary/10 text-primary shrink-0">
                    <Smartphone className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {p.deviceName ||
                        p.deviceModel ||
                        (locale === 'ar'
                          ? 'جهاز غير معروف'
                          : locale === 'fr'
                            ? 'Appareil inconnu'
                            : 'Unknown device')}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {p.username ||
                        (locale === 'ar' ? 'غير مقترن' : locale === 'fr' ? 'Non appairé' : 'Unpaired')}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-1.5 py-0.5 uppercase tracking-[0.1em] shrink-0 ${
                      p.status === 'completed'
                        ? 'bg-[hsl(var(--signal-green))]/15 text-[hsl(var(--signal-green))]'
                        : p.status === 'pending'
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {PAIRING_STATUS_LABELS[p.status]?.(locale) ?? p.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
