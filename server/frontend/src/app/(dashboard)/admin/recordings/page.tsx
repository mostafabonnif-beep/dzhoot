'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Eye, Loader2, Play, RefreshCw, Square, Trash2, Video } from 'lucide-react';
import api from '@/lib/api';

interface Recording {
  _id: string;
  channelId: string;
  channelName: string;
  channelGroup?: string;
  slug: string;
  status: 'recording' | 'ready' | 'failed';
  startedAt: string;
  endedAt?: string | null;
  durationSec?: number;
  sizeBytes?: number;
  fileName?: string;
  error?: string;
}

interface ChannelOption {
  _id: string;
  channelId: string;
  channelName: string;
  channelGroup?: string;
}

type RecordingStatusFilter = 'all' | Recording['status'];

function fmtDuration(sec?: number) {
  if (!sec && sec !== 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtSize(bytes?: number) {
  if (!bytes) return '—';
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
}

function getErrorMessage(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === 'object' &&
    'response' in error &&
    error.response &&
    typeof error.response === 'object' &&
    'data' in error.response &&
    error.response.data &&
    typeof error.response.data === 'object' &&
    'error' in error.response.data &&
    typeof error.response.data.error === 'string'
  ) {
    return error.response.data.error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

const STATUS_LABEL: Record<Recording['status'], string> = {
  recording: 'يُسجَّل الآن',
  ready: 'جاهز',
  failed: 'فشل',
};

const FILTER_LABEL: Record<RecordingStatusFilter, string> = {
  all: 'الكل',
  recording: 'قيد التسجيل',
  ready: 'الجاهزة',
  failed: 'الفاشلة',
};

export default function RecordingsPage() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [stats, setStats] = useState<{ active: number; total: number; totalSizeBytes: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<RecordingStatusFilter>('all');
  const [recordingsQuery, setRecordingsQuery] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<ChannelOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ChannelOption | null>(null);
  const [starting, setStarting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/recordings');
      setRecordings(Array.isArray(data.data) ? data.data : []);
      setStats(data.stats || null);
    } catch (error: unknown) {
      setMessage({ type: 'err', text: getErrorMessage(error, 'فشل تحميل التسجيلات') });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hasActiveRecordings = recordings.some((recording) => recording.status === 'recording');

  useEffect(() => {
    if (!hasActiveRecordings) return undefined;
    const timer = setInterval(() => {
      void load();
    }, 15000);
    return () => clearInterval(timer);
  }, [hasActiveRecordings, load]);

  const doSearch = useCallback(async () => {
    const q = search.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const { data } = await api.get(`/admin/channels?pageSize=8&page=1&search=${encodeURIComponent(q)}`);
      setResults(
        (Array.isArray(data.data) ? data.data : []).map((channel: { _id: string; channelId: string; channelName: string; channelGroup?: string }) => ({
          _id: channel._id,
          channelId: channel.channelId,
          channelName: channel.channelName,
          channelGroup: channel.channelGroup,
        })),
      );
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [search]);

  const statusCounts = useMemo(() => {
    return recordings.reduce(
      (acc, recording) => {
        acc.all += 1;
        acc[recording.status] += 1;
        return acc;
      },
      { all: 0, recording: 0, ready: 0, failed: 0 } as Record<RecordingStatusFilter, number>,
    );
  }, [recordings]);

  const filteredRecordings = useMemo(() => {
    const query = recordingsQuery.trim().toLowerCase();
    return recordings
      .filter((recording) => statusFilter === 'all' || recording.status === statusFilter)
      .filter((recording) => {
        if (!query) return true;
        return [recording.channelName, recording.channelGroup, recording.channelId, STATUS_LABEL[recording.status]]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const order = { recording: 0, failed: 1, ready: 2 } as const;
        const byStatus = order[a.status] - order[b.status];
        if (byStatus !== 0) return byStatus;
        return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
      });
  }, [recordings, statusFilter, recordingsQuery]);

  const start = async () => {
    if (!selected) return;
    setStarting(true);
    setMessage(null);
    try {
      await api.post('/admin/recordings', { channelId: selected.channelId });
      setMessage({ type: 'ok', text: `بدأ تسجيل: ${selected.channelName}` });
      setSelected(null);
      setSearch('');
      setResults([]);
      await load();
    } catch (error: unknown) {
      setMessage({ type: 'err', text: getErrorMessage(error, 'فشل بدء التسجيل') });
    } finally {
      setStarting(false);
    }
  };

  const stop = async (id: string) => {
    setBusyId(id);
    setMessage(null);
    try {
      await api.post(`/admin/recordings/${id}/stop`);
      setMessage({ type: 'ok', text: 'تم إيقاف التسجيل بنجاح' });
      await load();
    } catch (error: unknown) {
      setMessage({ type: 'err', text: getErrorMessage(error, 'فشل إيقاف التسجيل') });
    } finally {
      setBusyId(null);
    }
  };

  const del = async (recording: Recording) => {
    if (!window.confirm(`حذف تسجيل "${recording.channelName}"؟`)) return;
    setBusyId(recording._id);
    setMessage(null);
    try {
      await api.delete(`/admin/recordings/${recording._id}`);
      setMessage({ type: 'ok', text: `تم حذف تسجيل: ${recording.channelName}` });
      await load();
    } catch (error: unknown) {
      setMessage({ type: 'err', text: getErrorMessage(error, 'فشل الحذف') });
    } finally {
      setBusyId(null);
    }
  };

  const operationalTone =
    statusCounts.failed > 0
      ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'
      : statusCounts.recording > 0
        ? 'border-signal-blue/30 bg-signal-blue/5 text-signal-blue'
        : 'border-signal-green/30 bg-signal-green/5 text-signal-green';
  const operationalLabel =
    statusCounts.failed > 0
      ? 'تحتاج متابعة تشغيلية'
      : statusCounts.recording > 0
        ? 'التسجيلات قيد التشغيل'
        : 'جاهز ومستقر';
  const operationalMessage =
    statusCounts.failed > 0
      ? 'هناك تسجيلات فاشلة تحتاج مراجعة المصدر أو الجدولة قبل الاعتماد التجاري.'
      : statusCounts.recording > 0
        ? 'التسجيلات النشطة تعمل الآن. راقب الإيقاف والحجم والنتائج النهائية.'
        : 'لا توجد أخطاء حالية، ويمكن الاعتماد على الصفحة لمتابعة الجاهزية والتحميل.';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">التسجيلات</h1>
        <p className="text-sm text-muted-foreground">
          سجّل البث المباشر وحمّله بعد انتهائه — كل تسجيل يحصل على رابط ثابت للمشاهدة والتحميل.
        </p>
      </div>

      <section className={`rounded-lg border px-4 py-3 ${operationalTone}`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em]">ملخص تشغيلي</p>
            <p className="mt-2 text-lg font-bold">{operationalLabel}</p>
            <p className="mt-1 text-sm opacity-90">{operationalMessage}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div>
              <div className="text-xs opacity-70">قيد التسجيل</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{statusCounts.recording}</div>
            </div>
            <div>
              <div className="text-xs opacity-70">جاهزة للتحميل</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{statusCounts.ready}</div>
            </div>
            <div>
              <div className="text-xs opacity-70">فاشلة</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{statusCounts.failed}</div>
            </div>
            <div>
              <div className="text-xs opacity-70">الحجم الحالي</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{fmtSize(stats?.totalSizeBytes)}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">إجمالي التسجيلات</div>
          <div className="mt-2 text-2xl font-semibold">{stats?.total ?? recordings.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">التسجيلات النشطة</div>
          <div className="mt-2 text-2xl font-semibold text-primary">{stats?.active ?? recordings.filter((recording) => recording.status === 'recording').length}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">إجمالي الحجم</div>
          <div className="mt-2 text-2xl font-semibold">{fmtSize(stats?.totalSizeBytes)}</div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Video className="h-4 w-4 text-primary" /> تسجيل قناة جديدة
        </h2>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelected(null);
              }}
              onKeyDown={(event) => event.key === 'Enter' && void doSearch()}
              placeholder="ابحث عن قناة بالاسم… ثم اخترها"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            {searching && <Loader2 className="absolute left-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <button
            onClick={() => void doSearch()}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            بحث
          </button>
        </div>
        {results.length > 0 && (
          <ul className="mt-3 max-h-52 overflow-auto rounded-md border border-border">
            {results.map((channel) => (
              <li key={channel._id}>
                <button
                  onClick={() => {
                    setSelected(channel);
                    setResults([]);
                    setSearch(channel.channelName);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted"
                >
                  <span>{channel.channelName}</span>
                  <span className="text-xs text-muted-foreground">{channel.channelGroup || '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <div className="mt-3 flex items-center justify-between rounded-md bg-muted px-3 py-2">
            <span className="text-sm">{selected.channelName}</span>
            <button
              onClick={() => void start()}
              disabled={starting}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              بدء التسجيل
            </button>
          </div>
        )}
      </div>

      {message && (
        <div className={`rounded-md px-3 py-2 text-sm ${message.type === 'ok' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
          {message.text}
        </div>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(FILTER_LABEL) as RecordingStatusFilter[]).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                statusFilter === filter
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted'
              }`}
            >
              <span>{FILTER_LABEL[filter]}</span>
              <span className={`ms-2 rounded-full px-1.5 py-0.5 text-xs ${statusFilter === filter ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                {statusCounts[filter]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <input
            value={recordingsQuery}
            onChange={(event) => setRecordingsQuery(event.target.value)}
            placeholder="ابحث داخل التسجيلات…"
            aria-label="ابحث داخل التسجيلات"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" /> تحديث
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-right text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">القناة</th>
              <th className="px-3 py-2">الحالة</th>
              <th className="px-3 py-2">البداية</th>
              <th className="px-3 py-2">المدة</th>
              <th className="px-3 py-2">الحجم</th>
              <th className="px-3 py-2">الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">جارٍ التحميل…</td>
              </tr>
            ) : filteredRecordings.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {recordings.length === 0
                    ? 'لا توجد تسجيلات بعد'
                    : recordingsQuery.trim()
                      ? 'لا توجد تسجيلات مطابقة للبحث الحالي'
                      : 'لا توجد تسجيلات ضمن هذا الفلتر'}
                </td>
              </tr>
            ) : (
              filteredRecordings.map((recording) => (
                <tr key={recording._id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium">{recording.channelName}</div>
                    <div className="text-xs text-muted-foreground">{recording.channelGroup || recording.channelId}</div>
                    {recording.error && (
                      <div className="mt-1 text-xs text-red-600">{recording.error}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${
                        recording.status === 'recording'
                          ? 'bg-red-500/10 text-red-600'
                          : recording.status === 'ready'
                            ? 'bg-green-500/10 text-green-600'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {recording.status === 'recording' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />}
                      {STATUS_LABEL[recording.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top">{fmtDate(recording.startedAt)}</td>
                  <td className="px-3 py-2 align-top">{recording.status === 'recording' ? '…' : fmtDuration(recording.durationSec)}</td>
                  <td className="px-3 py-2 align-top">{fmtSize(recording.sizeBytes)}</td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-1">
                      {recording.status === 'recording' && (
                        <button
                          onClick={() => void stop(recording._id)}
                          disabled={busyId === recording._id}
                          title="إيقاف وإنهاء"
                          aria-label="إيقاف وإنهاء"
                          className="rounded p-1.5 text-red-600 hover:bg-red-500/10"
                        >
                          {busyId === recording._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                        </button>
                      )}
                      {recording.status === 'ready' && (
                        <>
                          <a
                            href={`/api/v1/admin/recordings/${recording._id}/watch`}
                            target="_blank"
                            rel="noreferrer"
                            title="مشاهدة"
                            aria-label="مشاهدة"
                            className="rounded p-1.5 hover:bg-muted"
                          >
                            <Eye className="h-4 w-4" />
                          </a>
                          <a
                            href={`/api/v1/admin/recordings/${recording._id}/download`}
                            title="تحميل MP4"
                            aria-label="تحميل MP4"
                            className="rounded p-1.5 text-primary hover:bg-primary/10"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        </>
                      )}
                      <button
                        onClick={() => void del(recording)}
                        disabled={busyId === recording._id}
                        title="حذف"
                        aria-label="حذف"
                        className="rounded p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasActiveRecordings && (
        <p className="text-center text-xs text-muted-foreground">
          يجري التحديث تلقائيًا كل 15 ثانية أثناء التسجيل النشط.
        </p>
      )}
    </div>
  );
}
