'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, Database, Eye, GitCompare, Loader2, Plus, RefreshCw, RotateCcw, Server, ShieldCheck, Trash2, Wifi, XCircle } from 'lucide-react';
import api from '@/lib/api';

interface XtreamSource {
  _id: string;
  name: string;
  serverUrl: string;
  hasCredentials: boolean;
  status: 'Active' | 'Inactive';
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncAt?: string | null;
  lastError?: string | null;
  directPlayback?: boolean;
  stats?: { channels?: number; movies?: number; series?: number };
  verificationStatus?: 'pending' | 'verified' | 'blocked';
  customerVisible?: boolean;
  lastDiagnosticsAt?: string | null;
  verifiedAt?: string | null;
}

interface SyncDiff {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  blocked?: number;
  duplicate?: number;
}

interface SyncPreview {
  snapshotId?: string;
  diff: SyncDiff;
  channelCount?: number;
}

interface SyncSnapshotSummary {
  _id: string;
  status: 'preview' | 'applied' | 'rolled_back';
  createdAt: string;
  diff: SyncDiff;
}

interface SourceHealth {
  verificationStatus?: string;
  status?: string;
  mappedChannels?: number;
  health?: { checked?: number; alive?: number; dead?: number; unknown?: number; avgLatencyMs?: number | null };
  lastError?: string | null;
}


const emptyForm = { name: '', serverUrl: '', username: '', password: '' };

type ApiError = { response?: { data?: { error?: string } } };

function errorMessage(error: unknown, fallback: string) {
  const apiError = error as ApiError;
  return apiError.response?.data?.error || fallback;
}

function formatDate(value?: string | null) {
  if (!value) return 'لم تتم المزامنة بعد';
  // 'ar-DZ' renders Latin digits with Arabic month names; fall back gracefully.
  try {
    return new Intl.DateTimeFormat('ar-DZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

export default function AdminXtreamSourcesPage() {
  const [sources, setSources] = useState<XtreamSource[]>([]);
  const sourcesRef = useRef<XtreamSource[]>([]);
  sourcesRef.current = sources;
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previews, setPreviews] = useState<Record<string, SyncPreview | undefined>>({});
  const [health, setHealth] = useState<Record<string, SourceHealth | undefined>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadSources() {
    try {
      setError('');
      const response = await api.get('/admin/xtream-sources');
      setSources(response.data?.data || []);
    } catch {
      setError('تعذر تحميل مصادر Xtream.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSources();
  }, []);

  async function createSource(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api.post('/admin/xtream-sources', form);
      setForm(emptyForm);
      setNotice('تمت إضافة المصدر وتشفير بياناته بنجاح.');
      await loadSources();
    } catch (err: unknown) {
      setError(errorMessage(err, 'تعذر إضافة المصدر.'));
    } finally {
      setSaving(false);
    }
  }

  async function testSource(source: XtreamSource) {
    setTestingId(source._id);
    setError('');
    setNotice('');
    try {
      const response = await api.post(`/admin/xtream-sources/${source._id}/test`);
      setNotice(response.data?.data?.userInfo ? 'نجح اختبار الاتصال وبيانات الحساب صالحة.' : 'نجح اختبار الاتصال.');
    } catch (err: unknown) {
      setError(errorMessage(err, 'فشل اختبار الاتصال بالمصدر.'));
    } finally {
      setTestingId(null);
    }
  }

  async function runDiagnostics(source: XtreamSource) {
    setBusyId(source._id);
    setError('');
    setNotice('');
    try {
      const response = await api.post(`/admin/xtream-sources/${source._id}/diagnostics`, { sampleLimit: 3 });
      const result = response.data?.data;
      const alive = result?.live?.alive ?? 0;
      const total = result?.live?.checked ?? 0;
      setNotice(`اكتمل التشخيص: API ${result?.api?.ok ? 'سليم' : 'فاشل'}، التشغيل الحي ${alive}/${total || 0}.`);
      await loadSources();
    } catch (err: unknown) {
      setError(errorMessage(err, 'فشل تشخيص المصدر.'));
    } finally {
      setBusyId(null);
    }
  }

  async function previewSource(source: XtreamSource) {
    setBusyId(source._id);
    setError('');
    try {
      const response = await api.post(`/admin/xtream-sources/${source._id}/preview`);
      const preview = response.data?.data as SyncPreview;
      setPreviews((current) => ({ ...current, [source._id]: preview }));
      setNotice(`معاينة «${source.name}»: +${preview.diff.added} إضافة، ${preview.diff.changed} تغيير، -${preview.diff.removed} حذف.`);
    } catch (err: unknown) {
      setError(errorMessage(err, 'تعذرت معاينة التغييرات.'));
    } finally {
      setBusyId(null);
    }
  }

  async function rollbackSource(source: XtreamSource) {
    setBusyId(source._id);
    setError('');
    try {
      const response = await api.get(`/admin/xtream-sources/${source._id}/snapshots?limit=10`);
      const snapshots = (response.data?.data || []) as SyncSnapshotSummary[];
      const latestApplied = snapshots.find((snapshot) => snapshot.status === 'applied');
      if (!latestApplied) {
        setNotice('لا توجد مزامنة مطبقة قابلة للاسترجاع لهذا المصدر.');
        return;
      }
      if (!window.confirm(`استرجاع آخر مزامنة لمصدر «${source.name}»؟`)) return;
      await api.post(`/admin/xtream-sources/${source._id}/rollback/${latestApplied._id}`);
      setNotice('تم استرجاع آخر لقطة مزامنة بنجاح.');
      await loadSources();
    } catch (err: unknown) {
      setError(errorMessage(err, 'تعذر استرجاع لقطة المزامنة.'));
    } finally {
      setBusyId(null);
    }
  }

  async function loadHealth(source: XtreamSource) {
    setBusyId(source._id);
    setError('');
    try {
      const response = await api.get(`/admin/xtream-sources/${source._id}/health`);
      setHealth((current) => ({ ...current, [source._id]: response.data?.data as SourceHealth }));
    } catch (err: unknown) {
      setError(errorMessage(err, 'تعذر تحميل صحة المصدر.'));
    } finally {
      setBusyId(null);
    }
  }

  async function syncSource(source: XtreamSource) {
    setSyncingId(source._id);
    setError('');
    setNotice('');
    try {
      await api.post(`/admin/xtream-sources/${source._id}/sync`);
      setNotice('بدأت المزامنة في الخلفية — يتم متابعة الحالة تلقائياً...');
      // Poll until the source finishes syncing (max ~3 minutes).
      const startedAt = Date.now();
      const poll = async () => {
        await loadSources();
        const current = sourcesRef.current.find((s) => s._id === source._id);
        const stillSyncing = current?.syncStatus === 'syncing';
        if (stillSyncing && Date.now() - startedAt < 180000) {
          setTimeout(poll, 4000);
        } else {
          setSyncingId(null);
          setNotice(
            current?.syncStatus === 'error'
              ? `فشلت مزامنة «${source.name}»: ${current.lastError || 'غير معروف'}`
              : current?.syncStatus === 'syncing'
                ? 'لا تزال المزامنة جارية — حدّث الصفحة لاحقاً'
                : `اكتملت مزامنة «${source.name}»`,
          );
        }
      };
      setTimeout(poll, 3000);
    } catch (err: unknown) {
      setError(errorMessage(err, 'تعذر بدء المزامنة.'));
      setSyncingId(null);
    }
  }

  async function toggleDirectPlayback(source: XtreamSource) {
    setError('');
    setNotice('');
    try {
      await api.patch(`/admin/xtream-sources/${source._id}`, { directPlayback: !source.directPlayback });
      setNotice(source.directPlayback ? 'تم تعطيل Direct Playback للمصدر.' : 'تم تفعيل Direct Playback للمصدر.');
      await loadSources();
    } catch (err: unknown) {
      setError(errorMessage(err, 'تعذر تغيير وضع تشغيل المصدر.'));
    }
  }

  async function deleteSource(source: XtreamSource) {
    if (!window.confirm(`حذف المصدر «${source.name}»؟`)) return;
    try {
      await api.delete(`/admin/xtream-sources/${source._id}`);
      setNotice('تم حذف المصدر.');
      await loadSources();
    } catch {
      setError('تعذر حذف المصدر.');
    }
  }

  return (
    <div className="dashboard-shell space-y-8 rounded-[2rem] p-1">
      <div>
        <div className="mb-3 inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">
          إدارة المحتوى
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight">مصادر Xtream</h1>
            <p className="mt-2 text-sm text-muted-foreground">أضف المصادر المصرح لك باستخدامها وراقب مزامنة القنوات والأفلام والمسلسلات.</p>
          </div>
          <button onClick={loadSources} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm hover:border-primary/40">
            <RefreshCw className="h-4 w-4" /> تحديث القائمة
          </button>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-2xl border border-signal-green/30 bg-signal-green/10 px-4 py-3 text-sm text-signal-green">{notice}</div>}

      <form onSubmit={createSource} className="brand-surface rounded-3xl border border-border/70 p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary"><Plus className="h-5 w-5" /></div>
          <div><h2 className="font-semibold">إضافة مصدر جديد</h2><p className="text-xs text-muted-foreground">تُشفّر بيانات الدخول في الخادم ولا تظهر في الواجهة.</p></div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {([
            ['name', 'اسم المصدر', 'مثال: مزود القنوات الرئيسي'],
            ['serverUrl', 'رابط الخادم', 'https://provider.example.com'],
            ['username', 'اسم مستخدم Xtream', 'اسم المستخدم'],
            ['password', 'كلمة مرور Xtream', 'كلمة المرور'],
          ] as const).map(([key, label, placeholder]) => (
            <label key={key} className="space-y-1.5 text-sm">
              <span className="font-medium">{label}</span>
              <input required value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} placeholder={placeholder} type={key === 'password' ? 'password' : 'text'} className="h-11 w-full rounded-xl border border-border bg-background px-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </label>
          ))}
        </div>
        <button disabled={saving} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} إضافة المصدر
        </button>
      </form>

      <section className="space-y-4">
        <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">المصادر المسجلة</h2><span className="text-sm text-muted-foreground">{sources.length} مصدر</span></div>
        {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : sources.length === 0 ? <div className="rounded-3xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">لا توجد مصادر Xtream بعد.</div> : <div className="grid gap-4 lg:grid-cols-2">{sources.map((source) => (
          <article key={source._id} className="brand-surface interactive-lift rounded-3xl border border-border/70 p-5">
            <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><div className="rounded-xl bg-primary/10 p-2 text-primary"><Server className="h-5 w-5" /></div><div><h3 className="font-semibold">{source.name}</h3><p className="mt-1 break-all text-xs text-muted-foreground">{source.serverUrl}</p></div></div><div className="flex flex-col items-end gap-1"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${source.status === 'Active' ? 'bg-signal-green/10 text-signal-green' : 'bg-muted text-muted-foreground'}`}>{source.status === 'Active' ? 'نشط' : 'غير نشط'}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${source.verificationStatus === 'verified' ? 'bg-signal-green/10 text-signal-green' : source.verificationStatus === 'blocked' ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-700'}`}>{source.verificationStatus === 'verified' ? 'موثّق للتشغيل' : source.verificationStatus === 'blocked' ? 'محجوب' : 'بحاجة إلى تشخيص'}</span></div></div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-muted/50 p-3"><Database className="mx-auto mb-1 h-4 w-4 text-primary" /><strong className="block text-lg">{source.stats?.channels ?? 0}</strong><span className="text-[11px] text-muted-foreground">قنوات</span></div><div className="rounded-xl bg-muted/50 p-3"><strong className="block text-lg">{source.stats?.movies ?? 0}</strong><span className="text-[11px] text-muted-foreground">أفلام</span></div><div className="rounded-xl bg-muted/50 p-3"><strong className="block text-lg">{source.stats?.series ?? 0}</strong><span className="text-[11px] text-muted-foreground">مسلسلات</span></div></div>
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">{source.syncStatus === 'syncing' ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : source.syncStatus === 'error' ? <XCircle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-signal-green" />}<span>{source.syncStatus === 'syncing' ? 'جارٍ تنفيذ المزامنة…' : source.syncStatus === 'error' ? `فشلت المزامنة: ${source.lastError || 'خطأ غير معروف'}` : `آخر مزامنة: ${formatDate(source.lastSyncAt)}`}</span></div>
            <div className="mt-4 flex items-center justify-between rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs"><span><strong>التشغيل المباشر</strong><span className="ms-2 text-muted-foreground">{source.directPlayback ? "مفعل" : "متوقف"}</span></span><button onClick={() => toggleDirectPlayback(source)} className="rounded-lg border border-border px-3 py-1.5 font-medium hover:border-primary/40">{source.directPlayback ? "تعطيل" : "تفعيل"}</button></div><div className="mt-5 flex flex-wrap gap-2"><button onClick={() => testSource(source)} disabled={testingId === source._id || busyId === source._id} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:border-primary/40 disabled:opacity-50"><Wifi className="h-4 w-4" />{testingId === source._id ? 'جارٍ الاختبار…' : 'اختبار الاتصال'}</button><button onClick={() => runDiagnostics(source)} disabled={busyId === source._id || source.syncStatus === 'syncing'} className="inline-flex items-center gap-2 rounded-xl border border-primary/40 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"><ShieldCheck className="h-4 w-4" />تشخيص حي</button><button onClick={() => previewSource(source)} disabled={busyId === source._id || source.syncStatus === 'syncing'} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:border-primary/40 disabled:opacity-50"><Eye className="h-4 w-4" />معاينة التغييرات</button><button onClick={() => syncSource(source)} disabled={syncingId === source._id || source.syncStatus === 'syncing' || busyId === source._id} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${syncingId === source._id || source.syncStatus === 'syncing' ? 'animate-spin' : ''}`} />مزامنة الآن</button><button onClick={() => rollbackSource(source)} disabled={busyId === source._id || source.syncStatus === 'syncing'} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:border-primary/40 disabled:opacity-50"><RotateCcw className="h-4 w-4" />استرجاع</button><button onClick={() => loadHealth(source)} disabled={busyId === source._id} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:border-primary/40 disabled:opacity-50"><Activity className="h-4 w-4" />الصحة</button><button onClick={() => deleteSource(source)} className="ms-auto inline-flex items-center gap-2 rounded-xl border border-destructive/30 px-3 py-2 text-xs text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" />حذف</button></div>
            {previews[source._id] && <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs"><div className="flex items-center gap-2 font-medium text-primary"><GitCompare className="h-4 w-4" />معاينة قبل التطبيق</div><p className="mt-1 text-muted-foreground">+{previews[source._id]?.diff.added ?? 0} إضافة · {previews[source._id]?.diff.changed ?? 0} تغيير · -{previews[source._id]?.diff.removed ?? 0} حذف · {previews[source._id]?.diff.unchanged ?? 0} دون تغيير</p></div>}
            {health[source._id] && <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3 text-xs"><div className="flex items-center gap-2 font-medium"><Activity className="h-4 w-4 text-primary" />ملخص صحة المصدر</div><div className="mt-2 grid grid-cols-3 gap-2 text-center"><span><strong className="block text-base">{health[source._id]?.health?.alive ?? 0}</strong>حي</span><span><strong className="block text-base">{health[source._id]?.health?.dead ?? 0}</strong>متوقف</span><span><strong className="block text-base">{health[source._id]?.mappedChannels ?? 0}</strong>مسارات احتياطية</span></div></div>}
          </article>
        ))}</div>}
      </section>
    </div>
  );
}
