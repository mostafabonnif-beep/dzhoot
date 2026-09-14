'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Crown,
  Download,
  Gauge,
  Loader2,
  RefreshCw,
  TrendingUp,
  User,
  Users,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '@/lib/api';

const REFRESH_INTERVAL_MS = 15000;

type TierKey = 'free' | 'paid' | 'admin' | 'unknown';

interface ResourceNow {
  concurrentTotal: number;
  concurrentFree: number;
  concurrentPaid: number;
  concurrentAdmin: number;
  concurrentUnknown: number;
  egressLast60sMb: number;
  egressMbps: number;
  egressTodayGb: number;
  activeSources: number;
}

interface ResourcePeak {
  concurrencyToday: number;
  mbpsToday: number;
}

interface TierUsage {
  concurrent: number;
  egressTodayGb: number;
}

interface SourceUsage {
  name?: string;
  source?: string;
  concurrent?: number;
  egressTodayGb?: number;
}

interface TopChannel {
  name: string;
  concurrent: number;
}

interface SeriesPoint {
  ts: string;
  egressGb: number;
}

interface HistoryRow {
  day: string;
  peakConcurrency: number;
  peakMbps: number;
  egressGb: number;
  freeConcurrent?: number;
  paidConcurrent?: number;
}

interface ResourceData {
  now: ResourceNow;
  peak: ResourcePeak;
  byTier: Record<TierKey, TierUsage>;
  bySource: SourceUsage[];
  byPath: Record<string, { egressTodayGb?: number }>;
  topChannels: TopChannel[];
  redisAvailable: boolean;
  series: SeriesPoint[];
  history: HistoryRow[];
}

type RawResources = Partial<{
  now: Partial<ResourceNow>;
  peak: Partial<ResourcePeak>;
  byTier: Partial<Record<TierKey, Partial<TierUsage>>>;
  bySource: SourceUsage[];
  byPath: Record<string, { egressTodayGb?: number }>;
  topChannels: TopChannel[];
  redisAvailable: boolean;
  series: SeriesPoint[];
  history: HistoryRow[];
}>;

function normalizeResources(raw: RawResources): ResourceData {
  const tier = (key: TierKey): TierUsage => ({
    concurrent: raw.byTier?.[key]?.concurrent ?? 0,
    egressTodayGb: raw.byTier?.[key]?.egressTodayGb ?? 0,
  });
  return {
    now: {
      concurrentTotal: raw.now?.concurrentTotal ?? 0,
      concurrentFree: raw.now?.concurrentFree ?? 0,
      concurrentPaid: raw.now?.concurrentPaid ?? 0,
      concurrentAdmin: raw.now?.concurrentAdmin ?? 0,
      concurrentUnknown: raw.now?.concurrentUnknown ?? 0,
      egressLast60sMb: raw.now?.egressLast60sMb ?? 0,
      egressMbps: raw.now?.egressMbps ?? 0,
      egressTodayGb: raw.now?.egressTodayGb ?? 0,
      activeSources: raw.now?.activeSources ?? 0,
    },
    peak: {
      concurrencyToday: raw.peak?.concurrencyToday ?? 0,
      mbpsToday: raw.peak?.mbpsToday ?? 0,
    },
    byTier: {
      free: tier('free'),
      paid: tier('paid'),
      admin: tier('admin'),
      unknown: tier('unknown'),
    },
    bySource: Array.isArray(raw.bySource) ? raw.bySource : [],
    byPath: raw.byPath || {},
    topChannels: Array.isArray(raw.topChannels) ? raw.topChannels : [],
    redisAvailable: raw.redisAvailable !== false,
    series: Array.isArray(raw.series) ? raw.series : [],
    history: Array.isArray(raw.history) ? raw.history : [],
  };
}

// GB/Mbps keep one decimal, counts stay integers.
function formatDecimal(n: number): string {
  return n.toFixed(1);
}

function hourLabel(ts: string): string {
  return new Date(ts).toLocaleTimeString('ar-DZ', { hour: '2-digit' });
}

function StatCard({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  sub?: string;
}) {
  return (
    <div className="border border-border p-4 flex items-center gap-3">
      <div className="h-10 w-10 flex items-center justify-center bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-display font-bold tabular-nums">{value}</p>
        <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">{sub}</p>}
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
      <p className="font-display font-bold tabular-nums">{formatDecimal(payload[0].value)}</p>
    </div>
  );
}

export default function ResourcesPage() {
  const [data, setData] = useState<ResourceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (initial = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (initial) setLoading(true);
    try {
      const res = await api.get('/admin/stats/resources', { signal: controller.signal });
      if (controller.signal.aborted) return;
      setData(normalizeResources(res.data?.data ?? res.data ?? {}));
      setError('');
    } catch {
      if (controller.signal.aborted) return;
      setError('تعذر تحميل بيانات الموارد');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      // Skip polling while the tab is hidden (also keeps tests deterministic).
      if (typeof document !== 'undefined' && document.hidden) return;
      load();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
        <button
          onClick={() => load(true)}
          className="flex items-center gap-2 border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <RefreshCw className="h-4 w-4" />
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (!data) return null;

  const chartData = data.series.map((p) => ({ ...p, hour: hourLabel(p.ts) }));
  const recentHistory = data.history.slice(-7);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">
            الموارد والاستهلاك
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            مراقبة حية للمشاهدة المتزامنة واستهلاك النطاق الترددي
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            aria-pressed={autoRefresh}
            className={`flex items-center gap-2 border px-3 py-2 text-sm font-medium transition-colors ${
              autoRefresh
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <Activity className="h-4 w-4" />
            تحديث تلقائي: {autoRefresh ? 'مفعّل' : 'متوقف'}
          </button>
          <button
            onClick={() => load(true)}
            className="flex items-center gap-2 border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" />
            تحديث
          </button>
        </div>
      </div>

      {data.redisAvailable === false && (
        <div
          role="alert"
          className="border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Redis غير متاح — الأرقام المعروضة جزئية
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="المشاهدون الآن" value={data.now.concurrentTotal} icon={Users} />
        <StatCard
          label="مجاني"
          value={data.now.concurrentFree}
          icon={User}
          sub={`اليوم: ${formatDecimal(data.byTier.free.egressTodayGb)} GB`}
        />
        <StatCard
          label="مدفوع"
          value={data.now.concurrentPaid}
          icon={Crown}
          sub={`اليوم: ${formatDecimal(data.byTier.paid.egressTodayGb)} GB`}
        />
        <StatCard label="Mbps الآن" value={formatDecimal(data.now.egressMbps)} icon={Gauge} />
        <StatCard
          label="استهلاك اليوم (GB)"
          value={formatDecimal(data.now.egressTodayGb)}
          icon={Download}
        />
        <StatCard
          label="ذروة اليوم (مشاهدون)"
          value={data.peak.concurrencyToday}
          icon={TrendingUp}
        />
      </div>

      {/* Hourly egress chart */}
      <ChartCard title="استهلاك آخر 24 ساعة (GB/ساعة)">
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">لا توجد بيانات لهذه الفترة</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="hour"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="egressGb"
                stroke="hsl(var(--chart-1))"
                fill="hsl(var(--chart-1))"
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Top channels */}
        <ChartCard title="أكثر القنوات مشاهدة الآن">
          {data.topChannels.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              لا توجد قنوات نشطة الآن
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                      اسم القناة
                    </th>
                    <th className="pb-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                      مشاهدون
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.topChannels.map((ch) => (
                    <tr key={ch.name}>
                      <td className="py-2 font-medium truncate max-w-[200px]">{ch.name}</td>
                      <td className="py-2 text-right font-display font-bold tabular-nums text-primary">
                        {ch.concurrent}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>

        {/* Daily history (last 7 rows) */}
        <ChartCard title="سجل الأيام الأخيرة">
          {recentHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">لا توجد بيانات سابقة</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                      اليوم
                    </th>
                    <th className="pb-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                      ذروة مشاهدين
                    </th>
                    <th className="pb-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                      ذروة Mbps
                    </th>
                    <th className="pb-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                      استهلاك GB
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentHistory.map((row) => (
                    <tr key={row.day}>
                      <td className="py-2 font-medium tabular-nums" dir="ltr">
                        {row.day}
                      </td>
                      <td className="py-2 text-right font-display font-bold tabular-nums">
                        {row.peakConcurrency}
                      </td>
                      <td className="py-2 text-right font-display tabular-nums">
                        {formatDecimal(row.peakMbps)}
                      </td>
                      <td className="py-2 text-right font-display tabular-nums">
                        {formatDecimal(row.egressGb)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Per-source usage — omitted entirely when the backend returns none */}
      {data.bySource.length > 0 && (
        <ChartCard title="الاستهلاك حسب المصدر">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                    المصدر
                  </th>
                  <th className="pb-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                    مشاهدون
                  </th>
                  <th className="pb-2 text-right text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                    استهلاك اليوم (GB)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.bySource.map((src, i) => (
                  <tr key={src.name || src.source || i}>
                    <td className="py-2 font-medium truncate max-w-[200px]">
                      {src.name || src.source || '—'}
                    </td>
                    <td className="py-2 text-right font-display font-bold tabular-nums">
                      {src.concurrent ?? 0}
                    </td>
                    <td className="py-2 text-right font-display tabular-nums">
                      {formatDecimal(src.egressTodayGb ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      )}
    </div>
  );
}
