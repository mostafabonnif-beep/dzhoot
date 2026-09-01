'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, Database, Eye, GitCompare, Loader2, Plus, RefreshCw, RotateCcw, Server, ShieldCheck, Trash2, Wifi, XCircle } from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';

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
  stabilityReport?: {
    at?: string | null;
    beforeCount?: number;
    afterCount?: number;
    added?: number;
    matched?: number;
    listUnchanged?: boolean;
  } | null;
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

interface FailoverMap {
  _id: string;
  channelRef: string;
  backupStreamId: string;
  backupChannelName: string;
  enabled?: boolean;
  matchedBy?: string;
  channelId?: { channelName?: string; channelGroup?: string };
}


const emptyForm = { name: '', serverUrl: '', username: '', password: '' };

type ApiError = { response?: { data?: { error?: string } } };

function errorMessage(error: unknown, fallback: string) {
  const apiError = error as ApiError;
  return apiError.response?.data?.error || fallback;
}

function formatDate(value?: string | null, locale: string = 'ar') {
  if (!value)
    return locale === 'ar'
      ? 'لم تتم المزامنة بعد'
      : locale === 'fr'
        ? 'Pas encore synchronisé'
        : 'Not synced yet';
  const l = locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-FR' : 'en-GB';
  try {
    return new Intl.DateTimeFormat(l, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

export default function AdminXtreamSourcesPage() {
  const { locale } = useLocale();
  const L = (ar: string, fr: string, en: string) => (locale === 'ar' ? ar : locale === 'fr' ? fr : en);
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
  const [failoverMaps, setFailoverMaps] = useState<Record<string, FailoverMap[]>>({});
  const [failoverOpen, setFailoverOpen] = useState<string | null>(null);
  const [failoverForm, setFailoverForm] = useState({ channelRef: '', backupStreamId: '', backupChannelName: '' });

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

  async function importCatalog(source: XtreamSource) {
    setBusyId(source._id);
    setError('');
    setNotice('');
    try {
      await api.post(`/admin/xtream-sources/${source._id}/import-catalog`);
      setNotice(`بدأ استيراد كتالوج «${source.name}» دون تفعيل التشغيل غير الموثق.`);
      await loadSources();
    } catch (err: unknown) {
      setError(errorMessage(err, 'تعذر بدء استيراد الكتالوج.'));
    } finally {
      setBusyId(null);
    }
  }

  async function loadFailoverMaps(source: XtreamSource) {
    setFailoverOpen(source._id);
    setBusyId(source._id);
    try {
      const response = await api.get(`/admin/xtream-sources/${source._id}/failover-maps`);
      setFailoverMaps((current) => ({ ...current, [source._id]: response.data?.data || [] }));
    } catch (err: unknown) {
      setError(errorMessage(err, 'تعذر تحميل مسارات failover.'));
    } finally {
      setBusyId(null);
    }
  }

  async function addFailoverMap(source: XtreamSource) {
    if (!failoverForm.channelRef.trim() || !failoverForm.backupStreamId.trim() || !failoverForm.backupChannelName.trim()) {
      setError('مرجع القناة ومعرّف البث الاحتياطي واسمه مطلوبة لإضافة المسار.');
      return;
    }
    setBusyId(source._id);
    setError('');
    try {
      await api.post(`/admin/xtream-sources/${source._id}/failover-maps`, failoverForm);
      setFailoverForm({ channelRef: '', backupStreamId: '', backupChannelName: '' });
      setNotice('تم حفظ مسار failover اليدوي.');
      await loadFailoverMaps(source);
    } catch (err: unknown) {
      setError(errorMessage(err, 'تعذر حفظ مسار failover.'));
    } finally {
      setBusyId(null);
    }
  }

  async function autoMatchFailover(source: XtreamSource) {
    setBusyId(source._id);
    setError('');
    try {
      const response = await api.post(`/admin/xtream-sources/${source._id}/failover-maps/auto-match`, { limit: 500 });
      const result = response.data?.data;
      setNotice(`اكتملت المطابقة الآلية: ${result?.created ?? 0} مسار جديد، ${result?.skipped ?? 0} تم تخطيه.`);
      await loadFailoverMaps(source);
    } catch (err: unknown) {
      setError(errorMessage(err, 'تعذرت المطابقة الآلية لمسارات failover.'));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteFailoverMap(source: XtreamSource, map: FailoverMap) {
    if (!window.confirm(`حذف المسار الاحتياطي للقناة «${map.channelId?.channelName || map.channelRef}»؟`)) return;
    setBusyId(source._id);
    try {
      await api.delete(`/admin/xtream-sources/${source._id}/failover-maps/${map._id}`);
      setNotice('تم حذف مسار failover.');
      await loadFailoverMaps(source);
    } catch (err: unknown) {
      setError(errorMessage(err, 'تعذر حذف مسار failover.'));
    } finally {
      setBusyId(null);
    }
  }

  async function runWatchdog() {
    setBusyId('watchdog');
    setError('');
    try {
      const response = await api.post('/admin/xtream-sources/watchdog/run');
      const result = response.data?.data;
      setNotice(`اكتمل فحص Watchdog: ${result?.checked ?? result?.processed ?? 0} مصدر تمت معالجته.`);
      await loadSources();
    } catch (err: unknown) {
      setError(errorMessage(err, 'تعذر تشغيل Watchdog.'));
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
            <h1 className="text-3xl font-display font-bold tracking-tight">{L('مصادر Xtream', 'Sources Xtream', 'Xtream sources')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{L('أضف المصادر المصرح لك باستخدامها وراقب مزامنة القنوات والأفلام والمسلسلات.', 'Ajoutez vos sources autorisées et suivez la synchronisation des chaînes, films et séries.', 'Add your authorized sources and monitor channel, movie, and series sync.')}</p>
          </div>
          <div className="flex flex-wrap gap-2"><button onClick={runWatchdog} disabled={busyId === 'watchdog'} className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-4 py-2 text-sm text-primary hover:bg-primary/10 disabled:opacity-50"><Activity className="h-4 w-4" />{busyId === 'watchdog' ? 'جارٍ فحص المصادر…' : 'تشغيل Watchdog'}</button><button onClick={loadSources} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm hover:border-primary/40"><RefreshCw className="h-4 w-4" /> تحديث القائمة</button></div>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-2xl border border-signal-green/30 bg-signal-green/10 px-4 py-3 text-sm text-signal-green">{notice}</div>}

      <form onSubmit={createSource} className="brand-surface rounded-3xl border border-border/70 p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary"><Plus className="h-5 w-5" /></div>
          <div><h2 className="font-semibold">{L('إضافة مصدر جديد', 'Ajouter une nouvelle source', 'Add a new source')}</h2><p className="text-xs text-muted-foreground">{L('تُشفّر بيانات الدخول في الخادم ولا تظهر في الواجهة.', 'Les identifiants sont chiffrés côté serveur et ne sont jamais affichés.', 'Credentials are encrypted server-side and never shown.')}</p></div>
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
        <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">{L('المصادر المسجلة', 'Sources enregistrées', 'Registered sources')}</h2><span className="text-sm text-muted-foreground">{sources.length} {L('مصدر', 'source', 'sources')}</span></div>
        {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : sources.length === 0 ? <div className="rounded-3xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">{L('لا توجد مصادر Xtream بعد.', 'Aucune source Xtream pour le moment.', 'No Xtream sources yet.')}</div> : <div className="grid gap-4 lg:grid-cols-2">{sources.map((source) => (
          <article key={source._id} className="brand-surface interactive-lift rounded-3xl border border-border/70 p-5">
            <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><div className="rounded-xl bg-primary/10 p-2 text-primary"><Server className="h-5 w-5" /></div><div><h3 className="font-semibold">{source.name}</h3><p className="mt-1 break-all text-xs text-muted-foreground">{source.serverUrl}</p></div></div><div className="flex flex-col items-end gap-1"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${source.status === 'Active' ? 'bg-signal-green/10 text-signal-green' : 'bg-muted text-muted-foreground'}`}>{source.status === 'Active' ? 'نشط' : 'غير نشط'}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${source.verificationStatus === 'verified' ? 'bg-signal-green/10 text-signal-green' : source.verificationStatus === 'blocked' ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-700'}`}>{source.verificationStatus === 'verified' ? 'موثّق للتشغيل' : source.verificationStatus === 'blocked' ? 'محجوب' : 'بحاجة إلى تشخيص'}</span></div></div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-muted/50 p-3"><Database className="mx-auto mb-1 h-4 w-4 text-primary" /><strong className="block text-lg">{source.stats?.channels ?? 0}</strong><span className="text-[11px] text-muted-foreground">{L('قنوات', 'chaînes', 'channels')}</span></div><div className="rounded-xl bg-muted/50 p-3"><strong className="block text-lg">{source.stats?.movies ?? 0}</strong><span className="text-[11px] text-muted-foreground">{L('أفلام', 'films', 'movies')}</span></div><div className="rounded-xl bg-muted/50 p-3"><strong className="block text-lg">{source.stats?.series ?? 0}</strong><span className="text-[11px] text-muted-foreground">{L('مسلسلات', 'séries', 'series')}</span></div></div>
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">{source.syncStatus === 'syncing' ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : source.syncStatus === 'error' ? <XCircle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-signal-green" />}<span>{source.syncStatus === 'syncing' ? L('جارٍ تنفيذ المزامنة…', 'Synchronisation en cours…', 'Syncing…') : source.syncStatus === 'error' ? `${L('فشلت المزامنة:', 'Échec de la synchro :', 'Sync failed:')} ${source.lastError || L('خطأ غير معروف', 'Erreur inconnue', 'Unknown error')}` : `${L('آخر مزامنة:', 'Dernière synchro :', 'Last sync:')} ${formatDate(source.lastSyncAt, locale)}`}</span>{source.stabilityReport && source.stabilityReport.listUnchanged === true && (<span className="inline-flex items-center gap-1 rounded-full bg-signal-green/10 px-2 py-0.5 text-[11px] font-medium text-signal-green"><ShieldCheck className="h-3 w-3" />{L(`القائمة لم تتغير ✓ (${source.stabilityReport.added ?? 0} قناة جديدة، ${source.stabilityReport.matched ?? 0} رُبطت كاحتياطي)`, `Liste inchangée ✓ (+${source.stabilityReport.added ?? 0} nouvelle, ${source.stabilityReport.matched ?? 0} liées en secours)`, `List unchanged ✓ (+${source.stabilityReport.added ?? 0} new, ${source.stabilityReport.matched ?? 0} linked as backup)`)}</span>)}</div>
            <div className="mt-4 flex items-center justify-between rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs"><span><strong>التشغيل المباشر</strong><span className="ms-2 text-muted-foreground">{source.directPlayback ? "مفعل" : "متوقف"}</span></span><button onClick={() => toggleDirectPlayback(source)} className="rounded-lg border border-border px-3 py-1.5 font-medium hover:border-primary/40">{source.directPlayback ? "تعطيل" : "تفعيل"}</button></div><div className="mt-5 flex flex-wrap gap-2"><button onClick={() => testSource(source)} disabled={testingId === source._id || busyId === source._id} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:border-primary/40 disabled:opacity-50"><Wifi className="h-4 w-4" />{testingId === source._id ? L('جارٍ الاختبار…', 'Test en cours…', 'Testing…') : L('اختبار الاتصال', 'Tester la connexion', 'Test connection')}</button><button onClick={() => runDiagnostics(source)} disabled={busyId === source._id || source.syncStatus === 'syncing'} className="inline-flex items-center gap-2 rounded-xl border border-primary/40 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"><ShieldCheck className="h-4 w-4" />{L('تشخيص حي', 'Diagnostic', 'Live diagnostics')}</button><button onClick={() => previewSource(source)} disabled={busyId === source._id || source.syncStatus === 'syncing'} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:border-primary/40 disabled:opacity-50"><Eye className="h-4 w-4" />{L('معاينة التغييرات', 'Aperçu des changements', 'Preview changes')}</button><button onClick={() => syncSource(source)} disabled={syncingId === source._id || source.syncStatus === 'syncing' || busyId === source._id} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${syncingId === source._id || source.syncStatus === 'syncing' ? 'animate-spin' : ''}`} />{L('مزامنة الآن', 'Synchroniser', 'Sync now')}</button><button onClick={() => rollbackSource(source)} disabled={busyId === source._id || source.syncStatus === 'syncing'} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:border-primary/40 disabled:opacity-50"><RotateCcw className="h-4 w-4" />{L('استرجاع', 'Restaurer', 'Rollback')}</button><button onClick={() => loadHealth(source)} disabled={busyId === source._id} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:border-primary/40 disabled:opacity-50"><Activity className="h-4 w-4" />{L('الصحة', 'Santé', 'Health')}</button><button onClick={() => importCatalog(source)} disabled={busyId === source._id || source.syncStatus === 'syncing'} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:border-primary/40 disabled:opacity-50"><Database className="h-4 w-4" />{L('استيراد الكتالوج', 'Importer le catalogue', 'Import catalog')}</button><button onClick={() => failoverOpen === source._id ? setFailoverOpen(null) : loadFailoverMaps(source)} disabled={busyId === source._id} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:border-primary/40 disabled:opacity-50"><Server className="h-4 w-4" />{L('Failover', 'Failover', 'Failover')}</button><button onClick={() => deleteSource(source)} className="ms-auto inline-flex items-center gap-2 rounded-xl border border-destructive/30 px-3 py-2 text-xs text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" />{L('حذف', 'Supprimer', 'Delete')}</button></div>
            {previews[source._id] && <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs"><div className="flex items-center gap-2 font-medium text-primary"><GitCompare className="h-4 w-4" />{L('معاينة قبل التطبيق', 'Aperçu avant application', 'Preview before applying')}</div><p className="mt-1 text-muted-foreground">+{previews[source._id]?.diff.added ?? 0} {L('إضافة', 'ajouts', 'added')} · {previews[source._id]?.diff.changed ?? 0} {L('تغيير', 'modifications', 'changed')} · -{previews[source._id]?.diff.removed ?? 0} {L('حذف', 'suppressions', 'removed')} · {previews[source._id]?.diff.unchanged ?? 0} {L('دون تغيير', 'inchangés', 'unchanged')}</p></div>}
            {health[source._id] && <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3 text-xs"><div className="flex items-center gap-2 font-medium"><Activity className="h-4 w-4 text-primary" />{L('ملخص صحة المصدر', 'Résumé de santé de la source', 'Source health summary')}</div><div className="mt-2 grid grid-cols-3 gap-2 text-center"><span><strong className="block text-base">{health[source._id]?.health?.alive ?? 0}</strong>{L('حي', 'actifs', 'alive')}</span><span><strong className="block text-base">{health[source._id]?.health?.dead ?? 0}</strong>{L('متوقف', 'morts', 'dead')}</span><span><strong className="block text-base">{health[source._id]?.mappedChannels ?? 0}</strong>{L('مسارات احتياطية', 'chemins de repli', 'fallback routes')}</span></div></div>}
            {failoverOpen === source._id && <div className="mt-3 space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="block">مسارات Failover</strong><span className="text-muted-foreground">تُستخدم فقط مع مصدر احتياطي مصرح به.</span></div><button onClick={() => autoMatchFailover(source)} disabled={busyId === source._id} className="rounded-lg border border-primary/40 px-3 py-1.5 font-medium text-primary disabled:opacity-50">مطابقة آلية حتى 500</button></div><div className="grid gap-2 md:grid-cols-3"><input value={failoverForm.channelRef} onChange={(event) => setFailoverForm({ ...failoverForm, channelRef: event.target.value })} placeholder="مرجع القناة" dir="ltr" className="h-9 rounded-lg border border-border bg-background px-2" /><input value={failoverForm.backupStreamId} onChange={(event) => setFailoverForm({ ...failoverForm, backupStreamId: event.target.value })} placeholder="معرّف البث الاحتياطي" dir="ltr" className="h-9 rounded-lg border border-border bg-background px-2" /><input value={failoverForm.backupChannelName} onChange={(event) => setFailoverForm({ ...failoverForm, backupChannelName: event.target.value })} placeholder="اسم القناة الاحتياطية" className="h-9 rounded-lg border border-border bg-background px-2" /></div><button onClick={() => addFailoverMap(source)} disabled={busyId === source._id} className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50">حفظ المسار اليدوي</button>{(failoverMaps[source._id] || []).length === 0 ? <p className="text-muted-foreground">لا توجد مسارات failover مفعلة.</p> : <div className="space-y-2">{failoverMaps[source._id]?.map((map) => <div key={map._id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-2 py-2"><span><strong>{map.channelId?.channelName || map.channelRef}</strong><span className="ms-2 text-muted-foreground" dir="ltr">→ {map.backupChannelName} ({map.backupStreamId})</span></span><button onClick={() => deleteFailoverMap(source, map)} className="text-destructive hover:underline">{L('حذف', 'Supprimer', 'Delete')}</button></div>)}</div>}</div>}
          </article>
        ))}</div>}
      </section>
    </div>
  );
}
