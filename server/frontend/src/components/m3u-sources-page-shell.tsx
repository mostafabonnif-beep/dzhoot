'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eye, Link2, Loader2, Play, Plus, RefreshCw, RotateCcw, Trash2, XCircle } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

interface SyncDiff {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  blocked: number;
  duplicate: number;
}

interface SyncPreview {
  snapshotId: string;
  channelCount: number;
  diff: SyncDiff;
}

interface SyncSnapshotSummary {
  _id: string;
  status: 'preview' | 'applied' | 'rolled_back';
  createdAt: string;
  diff: SyncDiff;
}

interface M3USource {
  _id: string;
  name: string;
  hasEpgUrl: boolean;
  status: 'Active' | 'Inactive';
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncAt?: string | null;
  lastError?: string | null;
  directPlayback?: boolean;
  stats?: { channels: number; blocked: number; duplicates: number };
}

export default function M3USourcesPageShell() {
  const { toast } = useToast();
  const [sources, setSources] = useState<M3USource[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Live mirror of `sources` for async polling callbacks (avoids stale closures).
  const sourcesRef = useRef<M3USource[]>([]);
  sourcesRef.current = sources;
  const [form, setForm] = useState({ name: '', playlistUrl: '', epgUrl: '' });
  const [previews, setPreviews] = useState<Record<string, SyncPreview | undefined>>({});
  const [busySourceId, setBusySourceId] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/admin/m3u-sources');
      setSources(response.data.data || []);
    } catch {
      toast('تعذر تحميل مصادر M3U', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  async function addSource(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.playlistUrl.trim()) {
      toast('اسم المصدر ورابط M3U مطلوبان', 'error');
      return;
    }

    setSaving(true);
    try {
      await api.post('/admin/m3u-sources', {
        name: form.name.trim(),
        playlistUrl: form.playlistUrl.trim(),
        epgUrl: form.epgUrl.trim() || undefined,
      });
      setForm({ name: '', playlistUrl: '', epgUrl: '' });
      toast('تمت إضافة مصدر M3U بنجاح', 'success');
      await loadSources();
    } catch {
      toast('تعذرت إضافة المصدر', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function testSource(source: M3USource) {
    try {
      const response = await api.post(`/admin/m3u-sources/${source._id}/test`);
      const result = response.data.data;
      toast(
        result?.ok ? `الاتصال ناجح: ${result.channelCount} قناة` : result?.error || 'فشل اختبار المصدر',
        result?.ok ? 'success' : 'error',
      );
    } catch {
      toast('تعذر اختبار مصدر M3U', 'error');
    }
  }

  async function previewSource(source: M3USource) {
    setBusySourceId(source._id);
    try {
      const response = await api.post(`/admin/m3u-sources/${source._id}/preview`);
      const preview = response.data.data as SyncPreview;
      setPreviews((current) => ({ ...current, [source._id]: preview }));
      toast(
        `Preview: +${preview.diff.added} إضافة، ${preview.diff.changed} تغيير، -${preview.diff.removed} حذف`,
        'info',
      );
    } catch {
      toast('تعذر إنشاء معاينة المزامنة', 'error');
    } finally {
      setBusySourceId(null);
    }
  }

  async function rollbackSource(source: M3USource) {
    setBusySourceId(source._id);
    try {
      const response = await api.get(`/admin/m3u-sources/${source._id}/snapshots?limit=10`);
      const snapshots = (response.data.data || []) as SyncSnapshotSummary[];
      const latestApplied = snapshots.find((snapshot) => snapshot.status === 'applied');
      if (!latestApplied) {
        toast('لا توجد مزامنة مطبقة قابلة للاسترجاع', 'info');
        return;
      }
      if (!window.confirm(`استرجاع آخر مزامنة لمصدر «${source.name}»؟`)) return;
      await api.post(`/admin/m3u-sources/${source._id}/rollback/${latestApplied._id}`);
      toast('تم استرجاع القنوات إلى snapshot السابق', 'success');
      await loadSources();
    } catch {
      toast('تعذر استرجاع snapshot المزامنة', 'error');
    } finally {
      setBusySourceId(null);
    }
  }

  async function syncSource(source: M3USource) {
    try {
      await api.post(`/admin/m3u-sources/${source._id}/sync`);
      toast('بدأت مزامنة مصدر M3U في الخلفية', 'info');
      // Poll until the source finishes syncing (max ~3 minutes), so the UI
      // reflects the real result without a manual reload.
      const startedAt = Date.now();
      const poll = async () => {
        await loadSources();
        const current = sourcesRef.current.find((s) => s._id === source._id);
        const stillSyncing = current?.syncStatus === 'syncing';
        if (stillSyncing && Date.now() - startedAt < 180000) {
          setTimeout(poll, 4000);
        } else {
          toast(
            current?.syncStatus === 'error'
              ? `فشلت مزامنة «${source.name}»: ${current.lastError || 'غير معروف'}`
              : current?.syncStatus === 'syncing'
                ? 'لا تزال المزامنة جارية — حدّث الصفحة لاحقاً'
                : `اكتملت مزامنة «${source.name}»`,
            current?.syncStatus === 'error' ? 'error' : 'success',
          );
        }
      };
      setTimeout(poll, 3000);
    } catch {
      toast('تعذر بدء المزامنة', 'error');
    }
  }

  async function toggleDirectPlayback(source: M3USource) {
    try {
      await api.patch(`/admin/m3u-sources/${source._id}`, {
        directPlayback: !source.directPlayback,
      });
      toast(source.directPlayback ? 'تم تعطيل Direct Playback للمصدر' : 'تم تفعيل Direct Playback للمصدر', 'success');
      await loadSources();
    } catch {
      toast('تعذر تغيير وضع Direct Playback', 'error');
    }
  }

  async function toggleSource(source: M3USource) {
    try {
      await api.patch(`/admin/m3u-sources/${source._id}`, {
        status: source.status === 'Active' ? 'Inactive' : 'Active',
      });
      toast(source.status === 'Active' ? 'تم إيقاف المصدر' : 'تم تفعيل المصدر', 'success');
      await loadSources();
    } catch {
      toast('تعذر تحديث حالة المصدر', 'error');
    }
  }

  async function deleteSource(source: M3USource) {
    if (!window.confirm(`هل تريد حذف المصدر «${source.name}»؟ سيتم إخفاء قنواته.`)) return;
    try {
      await api.delete(`/admin/m3u-sources/${source._id}`);
      toast('تم حذف المصدر', 'success');
      await loadSources();
    } catch {
      toast('تعذر حذف المصدر', 'error');
    }
  }

  return (
    <div className="space-y-6 p-6" dir="rtl">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Link2 className="h-6 w-6 text-primary" />
          مصادر M3U التلقائية
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          أضف روابط M3U القانونية ليتم تنزيلها وتحليلها وتحديث القنوات تلقائياً.
        </p>
      </div>

      <form onSubmit={addSource} className="grid gap-4 rounded-lg border bg-card p-5 md:grid-cols-4">
        <input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="اسم المصدر"
          className="h-10 rounded-md border bg-background px-3 text-sm"
        />
        <input
          value={form.playlistUrl}
          onChange={(event) => setForm({ ...form, playlistUrl: event.target.value })}
          placeholder="رابط M3U أو M3U8"
          type="url"
          dir="ltr"
          className="h-10 rounded-md border bg-background px-3 text-sm"
        />
        <input
          value={form.epgUrl}
          onChange={(event) => setForm({ ...form, epgUrl: event.target.value })}
          placeholder="رابط XMLTV اختياري"
          type="url"
          dir="ltr"
          className="h-10 rounded-md border bg-background px-3 text-sm"
        />
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          إضافة مصدر
        </button>
      </form>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : sources.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          لا توجد مصادر M3U مضافة بعد.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sources.map((source) => (
            <div key={source._id} className="rounded-lg border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{source.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                    {source.hasEpgUrl ? 'M3U + XMLTV' : 'M3U فقط'}
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${source.status === 'Active' ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                  {source.status === 'Active' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {source.status === 'Active' ? 'نشط' : 'متوقف'}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md bg-muted p-2"><strong className="block text-base">{source.stats?.channels ?? 0}</strong>قنوات</div>
                <div className="rounded-md bg-muted p-2"><strong className="block text-base">{source.stats?.duplicates ?? 0}</strong>مكرر</div>
                <div className="rounded-md bg-muted p-2"><strong className="block text-base">{source.stats?.blocked ?? 0}</strong>محظور</div>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                الحالة: {source.syncStatus === 'syncing' ? 'جارٍ التحديث…' : source.syncStatus === 'error' ? `خطأ: ${source.lastError || 'غير معروف'}` : source.lastSyncAt ? `آخر تحديث: ${new Date(source.lastSyncAt).toLocaleString('ar-DZ')}` : 'لم تتم المزامنة بعد'}
              </p>

              <div className="mt-4 flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <span><strong>التشغيل المباشر</strong><span className="ms-2 text-muted-foreground">{source.directPlayback ? 'مفعل' : 'متوقف'}</span></span>
                <button onClick={() => toggleDirectPlayback(source)} className="rounded-md border px-3 py-1.5 font-medium hover:bg-muted">
                  {source.directPlayback ? 'تعطيل' : 'تفعيل'}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => testSource(source)} className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs hover:bg-muted"><Play className="h-3.5 w-3.5" /> اختبار</button>
                <button onClick={() => previewSource(source)} disabled={busySourceId === source._id || source.syncStatus === 'syncing'} className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs hover:bg-muted disabled:opacity-50"><Eye className="h-3.5 w-3.5" /> معاينة</button>
                <button onClick={() => syncSource(source)} disabled={source.syncStatus === 'syncing' || busySourceId === source._id} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${source.syncStatus === 'syncing' ? 'animate-spin' : ''}`} /> مزامنة الآن</button>
                <button onClick={() => rollbackSource(source)} disabled={busySourceId === source._id || source.syncStatus === 'syncing'} className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs hover:bg-muted disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" /> استرجاع</button>
                <button onClick={() => toggleSource(source)} className="rounded-md border px-3 py-2 text-xs hover:bg-muted">{source.status === 'Active' ? 'إيقاف' : 'تفعيل'}</button>
                <button onClick={() => deleteSource(source)} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /> حذف</button>
              </div>
              {previews[source._id] && (
                <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs">
                  <p className="font-medium text-primary">معاينة جاهزة قبل التطبيق</p>
                  <p className="mt-1 text-muted-foreground">
                    +{previews[source._id]?.diff.added} إضافة · {previews[source._id]?.diff.changed} تغيير · -{previews[source._id]?.diff.removed} حذف · {previews[source._id]?.diff.unchanged} دون تغيير
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
