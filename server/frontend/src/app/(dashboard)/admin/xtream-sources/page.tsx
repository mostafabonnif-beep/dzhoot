'use client';

import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Database, Loader2, Plus, RefreshCw, Server, Trash2, Wifi, XCircle } from 'lucide-react';
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
}

const emptyForm = { name: '', serverUrl: '', username: '', password: '' };

type ApiError = { response?: { data?: { error?: string } } };

function errorMessage(error: unknown, fallback: string) {
  const apiError = error as ApiError;
  return apiError.response?.data?.error || fallback;
}

function formatDate(value?: string | null) {
  if (!value) return 'لم تتم المزامنة بعد';
  return new Date(value).toLocaleString('ar-DZ');
}

export default function AdminXtreamSourcesPage() {
  const [sources, setSources] = useState<XtreamSource[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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

  async function syncSource(source: XtreamSource) {
    setSyncingId(source._id);
    setError('');
    setNotice('');
    try {
      await api.post(`/admin/xtream-sources/${source._id}/sync`);
      setNotice('بدأت المزامنة في الخلفية. ستتحدث الحالة تلقائيًا عند إعادة تحميل الصفحة.');
      await loadSources();
    } catch (err: unknown) {
      setError(errorMessage(err, 'تعذر بدء المزامنة.'));
    } finally {
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
            <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><div className="rounded-xl bg-primary/10 p-2 text-primary"><Server className="h-5 w-5" /></div><div><h3 className="font-semibold">{source.name}</h3><p className="mt-1 break-all text-xs text-muted-foreground">{source.serverUrl}</p></div></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${source.status === 'Active' ? 'bg-signal-green/10 text-signal-green' : 'bg-muted text-muted-foreground'}`}>{source.status === 'Active' ? 'نشط' : 'غير نشط'}</span></div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-muted/50 p-3"><Database className="mx-auto mb-1 h-4 w-4 text-primary" /><strong className="block text-lg">{source.stats?.channels ?? 0}</strong><span className="text-[11px] text-muted-foreground">قنوات</span></div><div className="rounded-xl bg-muted/50 p-3"><strong className="block text-lg">{source.stats?.movies ?? 0}</strong><span className="text-[11px] text-muted-foreground">أفلام</span></div><div className="rounded-xl bg-muted/50 p-3"><strong className="block text-lg">{source.stats?.series ?? 0}</strong><span className="text-[11px] text-muted-foreground">مسلسلات</span></div></div>
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">{source.syncStatus === 'syncing' ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : source.syncStatus === 'error' ? <XCircle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-signal-green" />}<span>{source.syncStatus === 'syncing' ? 'جارٍ تنفيذ المزامنة…' : source.syncStatus === 'error' ? `فشلت المزامنة: ${source.lastError || 'خطأ غير معروف'}` : `آخر مزامنة: ${formatDate(source.lastSyncAt)}`}</span></div>
            <div className="mt-4 flex items-center justify-between rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs"><span><strong>Direct Playback</strong><span className="mr-2 text-muted-foreground">{source.directPlayback ? "مفعل" : "متوقف"}</span></span><button onClick={() => toggleDirectPlayback(source)} className="rounded-lg border border-border px-3 py-1.5 font-medium hover:border-primary/40">{source.directPlayback ? "تعطيل" : "تفعيل"}</button></div><div className="mt-5 flex flex-wrap gap-2"><button onClick={() => testSource(source)} disabled={testingId === source._id} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:border-primary/40 disabled:opacity-50"><Wifi className="h-4 w-4" />{testingId === source._id ? 'جارٍ الاختبار…' : 'اختبار الاتصال'}</button><button onClick={() => syncSource(source)} disabled={syncingId === source._id || source.syncStatus === 'syncing'} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${syncingId === source._id || source.syncStatus === 'syncing' ? 'animate-spin' : ''}`} />مزامنة الآن</button><button onClick={() => deleteSource(source)} className="mr-auto inline-flex items-center gap-2 rounded-xl border border-destructive/30 px-3 py-2 text-xs text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" />حذف</button></div>
          </article>
        ))}</div>}
      </section>
    </div>
  );
}
