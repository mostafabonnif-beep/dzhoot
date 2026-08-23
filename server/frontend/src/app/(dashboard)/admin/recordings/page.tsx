'use client';

import { useCallback, useEffect, useState } from 'react';
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

const STATUS_LABEL: Record<Recording['status'], string> = {
  recording: 'يُسجَّل الآن',
  ready: 'جاهز',
  failed: 'فشل',
};

export default function RecordingsPage() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [stats, setStats] = useState<{ active: number; total: number; totalSizeBytes: number } | null>(null);
  const [loading, setLoading] = useState(true);
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
      setRecordings(data.data || []);
      setStats(data.stats || null);
    } catch (e: any) {
      setMessage({ type: 'err', text: e?.response?.data?.error || 'فشل تحميل التسجيلات' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const hasActive = () => recordings.some((r) => r.status === 'recording');
    const t = setInterval(() => {
      if (hasActive()) load();
    }, 15000);
    return () => clearInterval(t);
  }, [load, recordings]);

  const doSearch = useCallback(async () => {
    const q = search.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const { data } = await api.get(`/admin/channels?pageSize=8&page=1&search=${encodeURIComponent(q)}`);
      setResults((data.data || []).map((c: any) => ({ _id: c._id, channelId: c.channelId, channelName: c.channelName, channelGroup: c.channelGroup })));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [search]);

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
      load();
    } catch (e: any) {
      setMessage({ type: 'err', text: e?.response?.data?.error || 'فشل بدء التسجيل' });
    } finally {
      setStarting(false);
    }
  };

  const stop = async (id: string) => {
    setBusyId(id);
    try {
      await api.post(`/admin/recordings/${id}/stop`);
      load();
    } catch (e: any) {
      setMessage({ type: 'err', text: e?.response?.data?.error || 'فشل إيقاف التسجيل' });
    } finally {
      setBusyId(null);
    }
  };

  const del = async (r: Recording) => {
    if (!window.confirm(`حذف تسجيل "${r.channelName}"؟`)) return;
    setBusyId(r._id);
    try {
      await api.delete(`/admin/recordings/${r._id}`);
      load();
    } catch (e: any) {
      setMessage({ type: 'err', text: e?.response?.data?.error || 'فشل الحذف' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">التسجيلات</h1>
        <p className="text-sm text-muted-foreground">
          سجّل البث المباشر وحمّله بعد انتهائه — كل تسجيل يحصل على رابط ثابت (مثل يوتيوب لايف)
        </p>
      </div>

      {/* Start recording */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Video className="h-4 w-4 text-primary" /> تسجيل قناة جديدة
        </h2>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelected(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              placeholder="ابحث عن قناة بالاسم… ثم اخترها"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            {searching && <Loader2 className="absolute left-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <button
            onClick={doSearch}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            بحث
          </button>
        </div>
        {results.length > 0 && (
          <ul className="mt-3 max-h-52 overflow-auto rounded-md border border-border">
            {results.map((c) => (
              <li key={c._id}>
                <button
                  onClick={() => {
                    setSelected(c);
                    setResults([]);
                    setSearch(c.channelName);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted"
                >
                  <span>{c.channelName}</span>
                  <span className="text-xs text-muted-foreground">{c.channelGroup || '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <div className="mt-3 flex items-center justify-between rounded-md bg-muted px-3 py-2">
            <span className="text-sm">{selected.channelName}</span>
            <button
              onClick={start}
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

      {/* Stats + list */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>الإجمالي: {stats?.total ?? 0}</span>
          <span className="text-primary">قيد التسجيل: {stats?.active ?? 0}</span>
          <span>الحجم: {fmtSize(stats?.totalSizeBytes)}</span>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
          <RefreshCw className="h-3.5 w-3.5" /> تحديث
        </button>
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
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">جارٍ التحميل…</td></tr>
            ) : recordings.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">لا توجد تسجيلات بعد</td></tr>
            ) : (
              recordings.map((r) => (
                <tr key={r._id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.channelName}</div>
                    <div className="text-xs text-muted-foreground">{r.channelGroup || r.channelId}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${
                        r.status === 'recording' ? 'bg-red-500/10 text-red-600' : r.status === 'ready' ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {r.status === 'recording' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />}
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">{fmtDate(r.startedAt)}</td>
                  <td className="px-3 py-2">{r.status === 'recording' ? '…' : fmtDuration(r.durationSec)}</td>
                  <td className="px-3 py-2">{fmtSize(r.sizeBytes)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {r.status === 'recording' && (
                        <button
                          onClick={() => stop(r._id)}
                          disabled={busyId === r._id}
                          title="إيقاف وإنهاء"
                          className="rounded p-1.5 text-red-600 hover:bg-red-500/10"
                        >
                          {busyId === r._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                        </button>
                      )}
                      {r.status === 'ready' && (
                        <>
                          <a
                            href={`/api/v1/admin/recordings/${r._id}/watch`}
                            target="_blank"
                            rel="noreferrer"
                            title="مشاهدة"
                            className="rounded p-1.5 hover:bg-muted"
                          >
                            <Eye className="h-4 w-4" />
                          </a>
                          <a
                            href={`/api/v1/admin/recordings/${r._id}/download`}
                            title="تحميل MP4"
                            className="rounded p-1.5 text-primary hover:bg-primary/10"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        </>
                      )}
                      <button
                        onClick={() => del(r)}
                        disabled={busyId === r._id}
                        title="حذف"
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

      {recordings.some((r) => r.status === 'recording') && (
        <p className="text-center text-xs text-muted-foreground">
          يجري التحديث تلقائيًا أثناء التسجيل النشط…
        </p>
      )}
    </div>
  );
}
