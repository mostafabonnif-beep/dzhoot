'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Clock, Play, Loader2, CheckCircle, XCircle, AlertTriangle, Timer, Pause } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import Pagination from '@/components/ui/pagination';
import DataTable, { type DataTableColumn } from '@/components/ui/data-table';
import { useLocale } from '@/components/locale-provider';

interface TaskInfo {
  name: string;
  displayName: string;
  description: string;
  intervalMs: number;
  enabled?: boolean;
  lastRun: RunEntry | null;
  nextRunAt: string | null;
  isRunning: boolean;
}

interface RunEntry {
  _id: string;
  taskName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  trigger: 'scheduled' | 'manual';
  triggeredBy?: { username?: string } | null;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  result?: Record<string, unknown>;
  error?: string;
  subtasks?: {
    name: string;
    status: string;
    durationMs?: number;
    error?: string;
  }[];
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'text-signal-green bg-signal-green/10 border-signal-green/30',
  failed: 'text-signal-red bg-signal-red/10 border-signal-red/30',
  running: 'text-primary bg-primary/10 border-primary/30',
  pending: 'text-muted-foreground bg-muted border-border',
};

const TRIGGER_STYLES: Record<string, string> = {
  scheduled: 'text-muted-foreground bg-muted border-border',
  manual: 'text-primary bg-primary/10 border-primary/30',
};

function formatDuration(ms?: number | null, locale?: string): string {
  if (!ms) return '-';
  if (ms < 1000) return locale === 'ar' ? `${ms} ملي ث` : `${ms}ms`;
  if (ms < 60000)
    return locale === 'ar' ? `${(ms / 1000).toFixed(1)} ث` : `${(ms / 1000).toFixed(1)}s`;
  return locale === 'ar' ? `${(ms / 60000).toFixed(1)} د` : `${(ms / 60000).toFixed(1)}m`;
}

function formatInterval(ms: number): string {
  const hours = ms / 3600000;
  if (hours < 1) return `${(ms / 60000).toFixed(0)} دقيقة`;
  if (hours === 1) return 'ساعة واحدة';
  return `${hours} ساعة`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) {
    const absDiff = Math.abs(diff);
    if (absDiff < 60000) return 'بعد أقل من دقيقة';
    if (absDiff < 3600000) return `بعد ${Math.round(absDiff / 60000)} دقيقة`;
    return `بعد ${(absDiff / 3600000).toFixed(1)} ساعة`;
  }
  if (diff < 60000) return 'منذ أقل من دقيقة';
  if (diff < 3600000) return `منذ ${Math.round(diff / 60000)} دقيقة`;
  if (diff < 86400000) return `منذ ${(diff / 3600000).toFixed(1)} ساعة`;
  return `منذ ${Math.floor(diff / 86400000)} يوم`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] font-medium border ${STATUS_STYLES[status] || STATUS_STYLES.pending}`}
    >
      {status === 'running' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {status === 'completed' && <CheckCircle className="h-2.5 w-2.5" />}
      {status === 'failed' && <XCircle className="h-2.5 w-2.5" />}
      {{ completed: 'مكتمل', failed: 'فشل', running: 'قيد التشغيل', pending: 'معلّق' }[status] || status}
    </span>
  );
}

const PAGE_SIZE = 15;

export default function SchedulerPage() {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [totalRuns, setTotalRuns] = useState(0);
  const [runsPage, setRunsPage] = useState(1);
  const [taskFilter, setTaskFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [triggeringTask, setTriggeringTask] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [loadingRunDetails, setLoadingRunDetails] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();
  const { locale } = useLocale();

  const fetchTasks = useCallback(async () => {
    try {
      const res = await api.get('/scheduler/tasks');
      setTasks(res.data.data || []);
      setError('');
    } catch {
      setError('فشل تحميل بيانات المهام');
    }
  }, []);

  const fetchRuns = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: String(runsPage),
        pageSize: String(PAGE_SIZE),
      });
      if (taskFilter) params.set('taskName', taskFilter);
      const res = await api.get(`/scheduler/runs?${params}`);
      setRuns(res.data.data || []);
      setTotalRuns(res.data.totalCount || 0);
      setError('');
    } catch {
      setError('فشل تحميل بيانات المهام');
    }
  }, [runsPage, taskFilter]);

  // Initial load
  useEffect(() => {
    Promise.all([fetchTasks(), fetchRuns()]).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch runs when page/filter changes
  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Poll when any task is running
  useEffect(() => {
    const anyRunning = tasks.some((t) => t.isRunning);
    if (anyRunning && !pollRef.current) {
      pollRef.current = setInterval(() => {
        fetchTasks();
        fetchRuns();
      }, 5000);
    } else if (!anyRunning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [tasks, fetchTasks, fetchRuns]);

  async function toggleRunDetails(run: RunEntry) {
    if (expandedRun === run._id) {
      setExpandedRun(null);
      return;
    }
    setExpandedRun(run._id);
    setLoadingRunDetails(run._id);
    try {
      const response = await api.get(`/scheduler/runs/${run._id}`);
      const details = response.data?.data as RunEntry | undefined;
      if (details) setRuns((current) => current.map((item) => (item._id === run._id ? { ...item, ...details } : item)));
    } catch {
      toast('تعذر تحميل تفاصيل التشغيل', 'error');
    } finally {
      setLoadingRunDetails(null);
    }
  }

  async function triggerTask(taskName: string) {
    setTriggeringTask(taskName);
    try {
      await api.post(`/scheduler/trigger/${taskName}`);
      toast(`تم تشغيل المهمة '${taskName}'`, 'success');
      // Refresh immediately
      await fetchTasks();
      await fetchRuns();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'فشل تشغيل المهمة';
      toast(msg, 'error');
    } finally {
      setTriggeringTask(null);
    }
  }

  const [togglingTask, setTogglingTask] = useState<string | null>(null);

  async function toggleTask(task: TaskInfo) {
    setTogglingTask(task.name);
    try {
      if (task.enabled === false) {
        await api.post(`/scheduler/tasks/${task.name}/resume`);
        toast(`تم استئناف المهمة '${task.displayName}'`, 'success');
      } else {
        const ok = window.confirm(
          locale === 'ar'
            ? `سيتم إيقاف التشغيل التلقائي للمهمة «${task.displayName}». يمكنك تشغيلها يدوياً في أي وقت. متابعة؟`
            : locale === 'fr'
              ? `L’exécution automatique de «${task.displayName}» sera suspendue. Vous pourrez toujours la lancer manuellement. Continuer ?`
              : `Automatic runs of "${task.displayName}" will be paused. You can still run it manually. Continue?`,
        );
        if (!ok) return;
        await api.post(`/scheduler/tasks/${task.name}/pause`);
        toast(`تم إيقاف المهمة '${task.displayName}'`, 'success');
      }
      await fetchTasks();
      await fetchRuns();
    } catch {
      toast('فشل تغيير حالة المهمة', 'error');
    } finally {
      setTogglingTask(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ms-2 text-sm text-muted-foreground">جارٍ تحميل المهام…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-display font-bold uppercase tracking-[0.08em]">المهام المجدولة</h1>
        <p className="text-sm text-muted-foreground mt-1">
          المهام الخلفية، سجل التشغيل، والتشغيل اليدوي
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Task cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tasks.map((task) => (
          <div key={task.name} className="border border-border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-medium truncate">{task.displayName}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
              </div>
              {task.isRunning ? (
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-[0.1em] font-medium text-primary bg-primary/10 border border-primary/30">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  قيد التشغيل
                </span>
              ) : (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => triggerTask(task.name)}
                    disabled={triggeringTask === task.name || task.isRunning}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.1em] font-medium border border-border bg-card hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {triggeringTask === task.name ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    شغّل الآن
                  </button>
                  <button
                    onClick={() => toggleTask(task)}
                    disabled={togglingTask === task.name}
                    title={
                      task.enabled === false
                        ? locale === 'ar'
                          ? 'استئناف التشغيل التلقائي'
                          : locale === 'fr'
                            ? 'Reprendre'
                            : 'Resume'
                        : locale === 'ar'
                          ? 'إيقاف التشغيل التلقائي'
                          : locale === 'fr'
                            ? 'Suspendre'
                            : 'Pause'
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.1em] font-medium border transition-colors disabled:opacity-40 ${
                      task.enabled === false
                        ? 'border-signal-green/40 text-signal-green hover:bg-signal-green/5'
                        : 'border-signal-amber/40 text-signal-amber hover:bg-signal-amber/5'
                    }`}
                  >
                    {togglingTask === task.name ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : task.enabled === false ? (
                      <Play className="h-3 w-3" />
                    ) : (
                      <Pause className="h-3 w-3" />
                    )}
                    {task.enabled === false
                      ? locale === 'ar'
                        ? 'استئناف'
                        : locale === 'fr'
                          ? 'Reprendre'
                          : 'Resume'
                      : locale === 'ar'
                        ? 'إيقاف'
                        : locale === 'fr'
                          ? 'Suspendre'
                          : 'Pause'}
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground uppercase tracking-[0.1em]">الجدولة</span>
                <p className="font-medium mt-0.5 flex items-center gap-1.5">
                  <Timer className="h-3 w-3 text-muted-foreground" />
                  كل {formatInterval(task.intervalMs)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground uppercase tracking-[0.1em]">التشغيل القادم</span>
                <p className="font-medium mt-0.5">
                  {task.enabled === false ? (
                    <span className="inline-flex items-center gap-1 text-signal-amber">
                      <Pause className="h-3 w-3" />
                      {locale === 'ar' ? 'موقوفة' : locale === 'fr' ? 'Suspendue' : 'Paused'}
                    </span>
                  ) : task.nextRunAt ? (
                    formatRelativeTime(task.nextRunAt)
                  ) : (
                    'معلّق'
                  )}
                </p>
              </div>
            </div>

            {task.lastRun && (
              <div className="border-t border-border pt-2 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground uppercase tracking-[0.1em]">آخر تشغيل</span>
                  <StatusBadge status={task.lastRun.status} />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {formatRelativeTime(task.lastRun.startedAt)}
                  </span>
                  <span className="text-muted-foreground">
                    {formatDuration(task.lastRun.durationMs, locale)}
                  </span>
                </div>
                {task.lastRun.error && (
                  <p className="text-xs text-signal-red truncate" title={task.lastRun.error}>
                    <AlertTriangle className="inline h-3 w-3 mr-1" />
                    {task.lastRun.error}
                  </p>
                )}
              </div>
            )}

            {!task.lastRun && (
              <div className="border-t border-border pt-2">
                <p className="text-xs text-muted-foreground">لم يتم التشغيل بعد</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Run history */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-display font-bold uppercase tracking-[0.08em]">
            سجل التشغيل
          </h2>
          <div className="flex items-center gap-2">
            <select
              value={taskFilter}
              onChange={(e) => {
                setTaskFilter(e.target.value);
                setRunsPage(1);
              }}
              className="text-xs border border-border bg-card px-2 py-1.5 focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">كل المهام</option>
              {tasks.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DataTable<RunEntry>
          data={runs}
          gridTemplate="1fr 140px 100px 80px 80px 1fr"
          ariaLabel="جدول سجل التشغيل"
          emptyMessage="لا توجد عمليات تشغيل."
          rowKey={(run) => run._id}
          breakpoint="always"
          onRowClick={toggleRunDetails}
          renderExpandedRow={(run) => {
            if (expandedRun !== run._id) return null;
            return (
              <div className="space-y-2 bg-muted/30 px-4 pb-3 text-xs">
                {loadingRunDetails === run._id ? <div className="flex items-center gap-2 py-3 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />جارٍ تحميل تفاصيل التشغيل…</div> : <><div className="flex flex-wrap gap-4 border border-border bg-background px-3 py-2"><span>بدأ: {new Date(run.startedAt).toLocaleString()}</span><span>اكتمل: {run.completedAt ? new Date(run.completedAt).toLocaleString() : 'لم يكتمل بعد'}</span><span>النتيجة: {run.result ? 'متوفرة' : 'غير متوفرة'}</span></div>{run.error && <div className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">{run.error}</div>}{run.subtasks?.length ? <div className="border border-border divide-y divide-border">{run.subtasks.map((sub, i) => <div key={i} className="grid grid-cols-[1fr,80px,80px,1fr] gap-2 px-3 py-1.5"><span className="font-medium truncate">{sub.name}</span><StatusBadge status={sub.status} /><span className="text-muted-foreground">{formatDuration(sub.durationMs, locale)}</span><span className="text-signal-red truncate">{sub.error || ''}</span></div>)}</div> : <p className="text-muted-foreground">لا توجد مهام فرعية مسجلة لهذا التشغيل.</p>}</>}
              </div>
            );
          }}
          columns={
            [
              {
                key: 'task',
                headerClassName:
                  'text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium',
                header: 'المهمة',
                cell: (run) => (
                  <span className="text-sm font-medium truncate">
                    {tasks.find((t) => t.name === run.taskName)?.displayName || run.taskName}
                  </span>
                ),
              },
              {
                key: 'time',
                headerClassName:
                  'text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium',
                header: 'الوقت',
                cell: (run) => (
                  <span className="text-xs text-muted-foreground">
                    {new Date(run.startedAt).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                ),
              },
              {
                key: 'trigger',
                headerClassName:
                  'text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium',
                header: 'المُشغّل',
                cell: (run) => (
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] font-medium border w-fit ${TRIGGER_STYLES[run.trigger] || TRIGGER_STYLES.scheduled}`}
                  >
                    {run.trigger === 'manual' && <Clock className="h-2.5 w-2.5" />}
                    {run.trigger === 'manual' ? 'يدوي' : 'مجدول'}
                  </span>
                ),
              },
              {
                key: 'status',
                headerClassName:
                  'text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium',
                header: 'الحالة',
                cell: (run) => <StatusBadge status={run.status} />,
              },
              {
                key: 'duration',
                headerClassName:
                  'text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium',
                header: 'المدة',
                cell: (run) => (
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(run.durationMs, locale)}
                  </span>
                ),
              },
              {
                key: 'error',
                headerClassName:
                  'text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hidden sm:block',
                header: (
                  <span className="hidden sm:inline">
                    {locale === 'ar' ? 'الخطأ' : locale === 'fr' ? 'Erreur' : 'Error'}
                  </span>
                ),
                cell: (run) => (
                  <span className="hidden sm:inline text-xs text-signal-red truncate">
                    {run.error || ''}
                  </span>
                ),
              },
            ] satisfies DataTableColumn<RunEntry>[]
          }
        />

        <Pagination
          page={runsPage}
          pageSize={PAGE_SIZE}
          totalCount={totalRuns}
          onPageChange={setRunsPage}
        />
      </div>
    </div>
  );
}
