'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Download,
  Package,
  Calendar,
  FileText,
  Tag,
  AlertCircle,
  Plus,
  Pencil,
  Power,
  PowerOff,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Lock,
  History,
} from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useLocale } from '@/components/locale-provider';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import Modal from '@/components/ui/modal';
import {
  APP_VERSION_DISTRIBUTIONS,
  APP_VERSION_PLATFORMS,
  APP_VERSION_RELEASE_CHANNELS,
} from '@dzhoof/shared';
import type { CreateAppVersionInput } from '@dzhoof/shared';
import {
  deriveVersionCode,
  isHttpsUrl,
  missingProvenance,
  platformLabel,
  platformOptionsFor,
  shortSha,
  urlHost,
  PLATFORM_OPTIONS,
} from '@/lib/release-metadata';
import type {
  AppVersionRow,
  Distribution,
  MissingField,
  ReleaseChannel,
} from '@/lib/release-metadata';

// ---------------------------------------------------------------------------
// Shared contract
//
// The `@dzhoof/shared` package is resolvable from the frontend, so the enum
// values and the create-payload type are imported from it instead of being
// duplicated here. The schemas that own these constraints live at
// server/packages/shared/src/schemas/app-version.schema.ts.
// ---------------------------------------------------------------------------

const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;

/** Shape used by the read-only public section (/app/latest, /app/versions). */
interface PublicAppVersion {
  _id: string;
  versionName: string;
  versionCode: number;
  apkFileName?: string;
  apkFileSize?: number;
  downloadUrl?: string;
  releaseNotes?: string;
  isActive?: boolean;
  isMandatory?: boolean;
  minCompatibleVersion?: number;
  releasedAt?: string;
}

/** Turn an axios/network failure into a readable, trilingual message. */
function describeError(err: unknown, pick: (ar: string, fr: string, en: string) => string): string {
  const error = err as { response?: { status?: number; data?: unknown }; message?: string };
  const status = error?.response?.status;
  const data = error?.response?.data;

  let serverMessage = '';
  if (typeof data === 'string') {
    serverMessage = data;
  } else if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.error === 'string') serverMessage = record.error;
    else if (typeof record.message === 'string') serverMessage = record.message;
  }

  // Schema violations come back as { error, details: [{ path, message }] }.
  let details = '';
  if (data && typeof data === 'object') {
    const rawDetails = (data as { details?: unknown }).details;
    if (Array.isArray(rawDetails)) {
      details = rawDetails
        .map((d) => {
          const item = d as { path?: unknown; message?: unknown };
          const path = typeof item.path === 'string' ? item.path : '';
          const message = typeof item.message === 'string' ? item.message : '';
          return [path, message].filter(Boolean).join(': ');
        })
        .filter(Boolean)
        .join(' • ');
    }
  }

  if (serverMessage && details) return `${serverMessage} — ${details}`;
  if (serverMessage) return serverMessage;
  if (status === 401) {
    return pick(
      'انتهت صلاحية الجلسة (401). أعد تسجيل الدخول ثم حاول مجدداً.',
      'Votre session a expiré (401). Reconnectez-vous et réessayez.',
      'Your session expired (401). Sign in again and retry.',
    );
  }
  if (status === 403) {
    return pick(
      'لا تملك صلاحية الوصول إلى إدارة الإصدارات (403).',
      'Vous n’avez pas accès à la gestion des versions (403).',
      'You do not have access to release management (403).',
    );
  }
  if (status) {
    return pick(
      `فشل الطلب (رمز ${status}).`,
      `La requête a échoué (code ${status}).`,
      `The request failed (status ${status}).`,
    );
  }
  return pick(
    'تعذّر الاتصال بالخادم. تحقق من الشبكة وحاول مجدداً.',
    'Impossible de joindre le serveur. Vérifiez la connexion et réessayez.',
    'Could not reach the server. Check your connection and retry.',
  );
}

interface PublishFormState {
  versionName: string;
  versionCode: string;
  apkFileName: string;
  apkFileSize: string;
  downloadUrl: string;
  sha256: string;
  releaseNotes: string;
  releaseChannel: ReleaseChannel;
  distribution: Distribution;
  isMandatory: boolean;
  minCompatibleVersion: string;
  platforms: string[];
}

const EMPTY_PUBLISH_FORM: PublishFormState = {
  versionName: '',
  versionCode: '',
  apkFileName: '',
  apkFileSize: '',
  downloadUrl: '',
  sha256: '',
  releaseNotes: '',
  releaseChannel: 'stable',
  distribution: 'external_apk',
  isMandatory: false,
  minCompatibleVersion: '1',
  platforms: [],
};

interface EditDraft {
  releaseNotes: string;
  isMandatory: boolean;
  minCompatibleVersion: string;
  releaseChannel: ReleaseChannel;
  distribution: Distribution;
  platforms: string[];
}

const MISSING_LABELS: Record<MissingField, [string, string, string]> = {
  sha256: ['بصمة sha256', 'empreinte sha256', 'sha256 digest'],
  apkFileSize: ['حجم الملف', 'taille du fichier', 'file size'],
  apkFileName: ['اسم الملف', 'nom du fichier', 'file name'],
  downloadUrl: ['رابط التحميل', 'URL de téléchargement', 'download URL'],
};

const CHANNEL_LABELS: Record<ReleaseChannel, [string, string, string]> = {
  stable: ['مستقر', 'stable', 'stable'],
  beta: ['تجريبي', 'bêta', 'beta'],
};

const DISTRIBUTION_LABELS: Record<Distribution, [string, string, string]> = {
  external_apk: ['ملف APK خارجي', 'APK externe', 'external APK'],
  play: ['Google Play', 'Google Play', 'Google Play'],
  managed_device: ['جهاز مُدار', 'appareil géré', 'managed device'],
};

export default function VersionsPage() {
  const { t, locale } = useLocale();
  const { toast } = useToast();

  const pick = useCallback(
    (ar: string, fr: string, en: string) => (locale === 'ar' ? ar : locale === 'fr' ? fr : en),
    [locale],
  );

  // --- Public view (unchanged contract: /app/latest, /app/versions, /app/download-url)
  const [latest, setLatest] = useState<PublicAppVersion | null>(null);
  const [versions, setVersions] = useState<PublicAppVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');

  // --- Admin-managed collection (GET/POST /admin/app-versions)
  const [adminVersions, setAdminVersions] = useState<AppVersionRow[]>([]);
  const [adminLoading, setAdminLoading] = useState(true);
  const [adminError, setAdminError] = useState('');

  // --- Publish form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<PublishFormState>(EMPTY_PUBLISH_FORM);
  const [versionCodeTouched, setVersionCodeTouched] = useState(false);
  const [overrideAck, setOverrideAck] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [formError, setFormError] = useState('');

  // --- PATCH edit
  const [editing, setEditing] = useState<AppVersionRow | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);

  // --- Activate / deactivate
  const [pendingDeactivate, setPendingDeactivate] = useState<AppVersionRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function fetchData() {
      const [latestRes, versionsRes] = await Promise.allSettled([
        api.get('/app/latest', { signal: controller.signal }),
        api.get('/app/versions', { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;

      if (latestRes.status === 'fulfilled') {
        const data = latestRes.value.data;
        setLatest(data.version || data.data || data);
      }

      if (versionsRes.status === 'fulfilled') {
        const data = versionsRes.value.data;
        setVersions(data.versions || data.data || []);
      }

      if (latestRes.status === 'rejected' && versionsRes.status === 'rejected') {
        setError(
          locale === 'ar'
            ? 'فشل تحميل معلومات الإصدار'
            : locale === 'fr'
              ? 'Échec du chargement des informations de version'
              : 'Failed to load version information',
        );
      }

      try {
        const dlRes = await api.get('/app/download-url', { signal: controller.signal });
        if (!controller.signal.aborted) {
          setDownloadUrl(dlRes.data.downloadUrl || dlRes.data.url || '');
        }
      } catch {
        // download URL may not be configured
      }

      if (!controller.signal.aborted) setLoading(false);
    }
    fetchData();
    return () => controller.abort();
  }, [locale]);

  const loadAdmin = useCallback(
    async (signal?: AbortSignal) => {
      setAdminLoading(true);
      setAdminError('');
      try {
        const res = await api.get('/admin/app-versions', { signal });
        if (signal?.aborted) return;
        const body = res.data;
        const rows = Array.isArray(body) ? body : body?.data;
        setAdminVersions(Array.isArray(rows) ? (rows as AppVersionRow[]) : []);
      } catch (err) {
        if (signal?.aborted) return;
        if ((err as { code?: string })?.code === 'ERR_CANCELED') return;
        setAdminError(describeError(err, pick));
      } finally {
        if (!signal?.aborted) setAdminLoading(false);
      }
    },
    [pick],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadAdmin(controller.signal);
    return () => controller.abort();
  }, [loadAdmin]);

  const derivedVersionCode = useMemo(
    () => deriveVersionCode(form.versionName),
    [form.versionName],
  );
  const parsedVersionCode = useMemo(() => {
    const raw = form.versionCode.trim();
    return /^\d+$/.test(raw) ? Number(raw) : NaN;
  }, [form.versionCode]);
  const overrideMismatch =
    derivedVersionCode !== null && Number.isFinite(parsedVersionCode) && parsedVersionCode !== derivedVersionCode;

  function updateForm<K extends keyof PublishFormState>(key: K, value: PublishFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleVersionNameChange(value: string) {
    setForm((prev) => {
      const next = { ...prev, versionName: value };
      if (!versionCodeTouched) {
        const derived = deriveVersionCode(value);
        next.versionCode = derived === null ? prev.versionCode : String(derived);
      }
      return next;
    });
  }

  function togglePlatform(target: string, list: string[]): string[] {
    return list.includes(target) ? list.filter((p) => p !== target) : [...list, target];
  }

  /** Client-side mirror of createAppVersionSchema (source of truth: @dzhoof/shared). */
  function validatePublish(): string | null {
    if (!form.versionName.trim()) {
      return pick('اسم الإصدار مطلوب', 'Le nom de version est requis', 'Version name is required');
    }
    if (!/^\d+$/.test(form.versionCode.trim()) || Number(form.versionCode) <= 0) {
      return pick(
        'رمز الإصدار يجب أن يكون عدداً صحيحاً موجباً',
        'Le code de version doit être un entier positif',
        'Version code must be a positive integer',
      );
    }
    if (overrideMismatch && !overrideAck) {
      return pick(
        'رمز الإصدار لا يطابق الاشتقاق من اسم الإصدار. أكّد التجاوز أو صحّح الرمز.',
        'Le code de version ne correspond pas à la dérivation du nom. Confirmez la dérogation ou corrigez le code.',
        'Version code disagrees with the value derived from the name. Acknowledge the override or fix the code.',
      );
    }
    if (!form.apkFileName.trim()) {
      return pick('اسم ملف APK مطلوب', 'Le nom du fichier APK est requis', 'APK file name is required');
    }
    if (!/^\d+$/.test(form.apkFileSize.trim()) || Number(form.apkFileSize) <= 0) {
      return pick(
        'حجم الملف يجب أن يكون عدداً صحيحاً موجباً (بايت)',
        'La taille du fichier doit être un entier positif (octets)',
        'File size must be a positive integer (bytes)',
      );
    }
    if (!isHttpsUrl(form.downloadUrl)) {
      return pick(
        'رابط التحميل يجب أن يكون رابط https صالحاً',
        'L’URL de téléchargement doit être une URL https valide',
        'Download URL must be a valid https URL',
      );
    }
    if (!SHA256_PATTERN.test(form.sha256.trim())) {
      return pick(
        'بصمة sha256 يجب أن تكون 64 حرفاً سداسياً (a-f, 0-9)',
        'L’empreinte sha256 doit comporter 64 caractères hexadécimaux (a-f, 0-9)',
        'sha256 must be 64 hex characters (a-f, 0-9)',
      );
    }
    if (!/^\d+$/.test(form.minCompatibleVersion.trim())) {
      return pick(
        'أدنى إصدار متوافق يجب أن يكون عدداً صحيحاً',
        'La version minimale compatible doit être un entier',
        'Minimum compatible version must be an integer',
      );
    }
    return null;
  }

  function resetPublishForm() {
    setForm(EMPTY_PUBLISH_FORM);
    setVersionCodeTouched(false);
    setOverrideAck(false);
    setFormError('');
  }

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    const validation = validatePublish();
    if (validation) {
      setFormError(validation);
      return;
    }

    const selectedPlatforms = form.platforms;
    const payload: CreateAppVersionInput = {
      versionName: form.versionName.trim(),
      versionCode: Number(form.versionCode),
      apkFileName: form.apkFileName.trim(),
      apkFileSize: Number(form.apkFileSize),
      downloadUrl: form.downloadUrl.trim(),
      releaseNotes: form.releaseNotes,
      isActive: true,
      isMandatory: form.isMandatory,
      minCompatibleVersion: Number(form.minCompatibleVersion),
      sha256: form.sha256.trim().toLowerCase(),
      releaseChannel: form.releaseChannel,
      distribution: form.distribution,
      ...(selectedPlatforms.length > 0
        ? { platforms: selectedPlatforms as CreateAppVersionInput['platforms'] }
        : {}),
    };

    setPublishing(true);
    try {
      await api.post('/admin/app-versions', payload);
      toast(
        pick(
          `تم نشر الإصدار ${payload.versionName} (رمز ${payload.versionCode})`,
          `Version ${payload.versionName} (code ${payload.versionCode}) publiée`,
          `Published version ${payload.versionName} (code ${payload.versionCode})`,
        ),
        'success',
      );
      setShowForm(false);
      resetPublishForm();
      await loadAdmin();
    } catch (err) {
      // Keep every entered value; surface the server's message (including the
      // duplicate versionName/versionCode rejection).
      setFormError(describeError(err, pick));
    } finally {
      setPublishing(false);
    }
  }

  function openEdit(row: AppVersionRow) {
    setEditing(row);
    setEditError('');
    setDraft({
      releaseNotes: row.releaseNotes || '',
      isMandatory: row.isMandatory === true,
      minCompatibleVersion: String(row.minCompatibleVersion ?? 1),
      releaseChannel: row.releaseChannel,
      distribution: row.distribution,
      platforms: Array.isArray(row.platforms) ? [...row.platforms] : [],
    });
  }

  function closeEdit() {
    if (saving) return;
    setEditing(null);
    setDraft(null);
    setEditError('');
  }

  async function handleSaveEdit() {
    if (!editing || !draft) return;
    setEditError('');
    if (!/^\d+$/.test(draft.minCompatibleVersion.trim())) {
      setEditError(
        pick(
          'أدنى إصدار متوافق يجب أن يكون عدداً صحيحاً',
          'La version minimale compatible doit être un entier',
          'Minimum compatible version must be an integer',
        ),
      );
      return;
    }

    const validPlatforms = APP_VERSION_PLATFORMS as readonly string[];
    const body = {
      releaseNotes: draft.releaseNotes,
      isMandatory: draft.isMandatory,
      minCompatibleVersion: Number(draft.minCompatibleVersion),
      releaseChannel: draft.releaseChannel,
      distribution: draft.distribution,
      platforms: draft.platforms.filter((p) => validPlatforms.includes(p)),
    };

    setSaving(true);
    try {
      const res = await api.patch(`/admin/app-versions/${editing._id}`, body);
      const updated = res.data?.data as AppVersionRow | undefined;
      if (updated) {
        setAdminVersions((prev) => prev.map((row) => (row._id === updated._id ? updated : row)));
      } else {
        await loadAdmin();
      }
      toast(
        pick(
          `تم تحديث الإصدار ${editing.versionName}`,
          `Version ${editing.versionName} mise à jour`,
          `Updated version ${editing.versionName}`,
        ),
        'success',
      );
      setEditing(null);
      setDraft(null);
    } catch (err) {
      setEditError(describeError(err, pick));
    } finally {
      setSaving(false);
    }
  }

  async function applyActive(row: AppVersionRow, isActive: boolean) {
    setTogglingId(row._id);
    try {
      const res = await api.patch(`/admin/app-versions/${row._id}`, { isActive });
      const updated = res.data?.data as AppVersionRow | undefined;
      if (updated) {
        setAdminVersions((prev) => prev.map((item) => (item._id === updated._id ? updated : item)));
      } else {
        await loadAdmin();
      }
      toast(
        isActive
          ? pick(
              `تم تفعيل الإصدار ${row.versionName}`,
              `Version ${row.versionName} activée`,
              `Activated version ${row.versionName}`,
            )
          : pick(
              `تم تعطيل الإصدار ${row.versionName}`,
              `Version ${row.versionName} désactivée`,
              `Deactivated version ${row.versionName}`,
            ),
        'success',
      );
    } catch (err) {
      toast(describeError(err, pick), 'error');
    } finally {
      setTogglingId(null);
      setPendingDeactivate(null);
    }
  }

  function formatBytes(bytes?: number): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatMb(bytes?: number): string {
    if (!bytes || bytes <= 0) return '—';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const inputClass =
    'w-full h-10 px-3 border border-border bg-background text-sm focus-visible:outline-none focus-visible:border-primary';
  const labelClass =
    'block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground';

  const publishPlatformOptions: string[] = [...PLATFORM_OPTIONS];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">
          {pick('إصدارات التطبيق', 'Versions de l’application', 'App versions')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {pick(
            'نشر إصدارات تطبيق Fire TV وإدارة بياناتها الوصفية',
            'Publier et gérer les métadonnées des versions de l’application Fire TV',
            'Publish and manage Fire TV application release metadata',
          )}
        </p>
      </div>

      {error && (
        <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Admin: managed releases                                            */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-4" aria-labelledby="managed-releases-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              id="managed-releases-heading"
              className="text-base font-display font-bold uppercase tracking-[0.1em] flex items-center gap-2"
            >
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              {pick('الإصدارات المُدارة', 'Versions gérées', 'Managed releases')}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {pick(
                'مصدر الإصدارات الذي يقرأه التطبيق ويُدمج مع GitHub Releases.',
                'La source de versions lue par l’application, fusionnée avec GitHub Releases.',
                'The release source the app reads, merged with GitHub Releases.',
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadAdmin()}
              disabled={adminLoading}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium border border-border text-muted-foreground uppercase tracking-[0.1em] transition-colors hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${adminLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {t('common.refresh')}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm((v) => !v);
                setFormError('');
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {pick('نشر إصدار', 'Publier une version', 'Publish release')}
            </button>
          </div>
        </div>

        {/* Auditability notice */}
        <div className="flex items-start gap-2 border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          <History className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            {pick(
              'كل عملية نشر أو تعديل تُسجَّل في سجل التدقيق: APP_VERSION_PUBLISH عند النشر وAPP_VERSION_UPDATE عند التعديل (مع القيم قبل وبعد).',
              'Chaque publication ou modification est journalisée : APP_VERSION_PUBLISH à la publication et APP_VERSION_UPDATE à la modification (valeurs avant/après).',
              'Every publish or edit is written to the audit log: APP_VERSION_PUBLISH on publish and APP_VERSION_UPDATE on edit (with before/after values).',
            )}
          </p>
        </div>

        {adminError && (
          <div role="alert" className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {adminError}
          </div>
        )}

        {/* Publish form */}
        {showForm && (
          <form onSubmit={handlePublish} className="border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-display font-bold uppercase tracking-[0.1em]">
                {pick('نشر إصدار جديد', 'Publier une nouvelle version', 'Publish a new release')}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetPublishForm();
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {t('common.close')}
              </button>
            </div>

            {formError && (
              <div role="alert" className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className={labelClass}>
                {pick('اسم الإصدار', 'Nom de version', 'Version name')} *
                <input
                  value={form.versionName}
                  onChange={(e) => handleVersionNameChange(e.target.value)}
                  placeholder="1.4.2"
                  dir="ltr"
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {pick('رمز الإصدار', 'Code de version', 'Version code')} *
                <input
                  value={form.versionCode}
                  onChange={(e) => {
                    setVersionCodeTouched(true);
                    updateForm('versionCode', e.target.value);
                  }}
                  inputMode="numeric"
                  dir="ltr"
                  className={inputClass}
                />
                <span className="block text-[11px] normal-case tracking-normal text-muted-foreground/80">
                  {derivedVersionCode !== null
                    ? pick(
                        `الاشتقاق من الاسم: ${derivedVersionCode}`,
                        `Dérivé du nom : ${derivedVersionCode}`,
                        `Derived from name: ${derivedVersionCode}`,
                      )
                    : pick(
                        'تعذّر اشتقاق الرمز من اسم الإصدار — أدخله يدوياً.',
                        'Impossible de dériver le code du nom — saisissez-le manuellement.',
                        'Could not derive the code from the name — enter it manually.',
                      )}
                </span>
              </label>
              <label className={labelClass}>
                {pick('قناة الإصدار', 'Canal de version', 'Release channel')}
                <select
                  value={form.releaseChannel}
                  onChange={(e) => updateForm('releaseChannel', e.target.value as ReleaseChannel)}
                  className={inputClass}
                >
                  {APP_VERSION_RELEASE_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {pick(...CHANNEL_LABELS[channel])}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                {pick('قناة التوزيع', 'Distribution', 'Distribution')}
                <select
                  value={form.distribution}
                  onChange={(e) => updateForm('distribution', e.target.value as Distribution)}
                  className={inputClass}
                >
                  {APP_VERSION_DISTRIBUTIONS.map((dist) => (
                    <option key={dist} value={dist}>
                      {pick(...DISTRIBUTION_LABELS[dist])}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                {pick('اسم ملف APK', 'Nom du fichier APK', 'APK file name')} *
                <input
                  value={form.apkFileName}
                  onChange={(e) => updateForm('apkFileName', e.target.value)}
                  placeholder="dzhoof-tv-v1.4.2-official.apk"
                  dir="ltr"
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {pick('حجم الملف (بايت)', 'Taille du fichier (octets)', 'File size (bytes)')} *
                <input
                  value={form.apkFileSize}
                  onChange={(e) => updateForm('apkFileSize', e.target.value)}
                  inputMode="numeric"
                  dir="ltr"
                  className={inputClass}
                />
              </label>
              <label className={`${labelClass} lg:col-span-2`}>
                {pick('رابط التحميل (https)', 'URL de téléchargement (https)', 'Download URL (https)')} *
                <input
                  value={form.downloadUrl}
                  onChange={(e) => updateForm('downloadUrl', e.target.value)}
                  placeholder="https://github.com/…/dzhoof-tv-v1.4.2-official.apk"
                  dir="ltr"
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {pick('بصمة sha256', 'Empreinte sha256', 'sha256 digest')} *
                <input
                  value={form.sha256}
                  onChange={(e) => updateForm('sha256', e.target.value)}
                  placeholder="64 hex characters"
                  dir="ltr"
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {pick('أدنى إصدار متوافق', 'Version minimale compatible', 'Min compatible version')}
                <input
                  value={form.minCompatibleVersion}
                  onChange={(e) => updateForm('minCompatibleVersion', e.target.value)}
                  inputMode="numeric"
                  dir="ltr"
                  className={inputClass}
                />
              </label>
            </div>

            <label className={labelClass}>
              {pick('ملاحظات الإصدار', 'Notes de version', 'Release notes')}
              <textarea
                value={form.releaseNotes}
                onChange={(e) => updateForm('releaseNotes', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-border bg-background text-sm focus-visible:outline-none focus-visible:border-primary"
              />
            </label>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isMandatory}
                  onChange={(e) => updateForm('isMandatory', e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                {pick('تحديث إلزامي', 'Mise à jour obligatoire', 'Mandatory update')}
              </label>
              <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <legend className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  {pick('المنصات (فارغ = الكل)', 'Plateformes (vide = toutes)', 'Platforms (empty = all)')}
                </legend>
                {publishPlatformOptions.map((platform) => (
                  <label key={platform} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.platforms.includes(platform)}
                      onChange={() => updateForm('platforms', togglePlatform(platform, form.platforms))}
                      className="h-4 w-4 accent-primary"
                    />
                    {pick(...platformLabel(platform))}
                  </label>
                ))}
              </fieldset>
            </div>

            {overrideMismatch && (
              <div
                role="alert"
                className="border border-signal-amber/40 bg-signal-amber/10 px-4 py-3 text-sm text-signal-amber space-y-2"
              >
                <p>
                  {pick(
                    `تحذير: رمز الإصدار ${parsedVersionCode} لا يطابق الاشتقاق ${derivedVersionCode} من اسم الإصدار. العملاء يرفضون هذا الملف.`,
                    `Attention : le code ${parsedVersionCode} ne correspond pas à la dérivation ${derivedVersionCode} du nom. Les clients rejettent cet artefact.`,
                    `Warning: version code ${parsedVersionCode} disagrees with the derived ${derivedVersionCode}. Clients reject this artifact.`,
                  )}
                </p>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={overrideAck}
                    onChange={(e) => setOverrideAck(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  {pick(
                    'أُقر بأن هذا تجاوز مقصود لرمز الإصدار.',
                    'Je confirme cette dérogation volontaire au code de version.',
                    'I acknowledge this deliberate version-code override.',
                  )}
                </label>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={publishing || (overrideMismatch && !overrideAck)}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {publishing
                  ? pick('جارٍ النشر...', 'Publication...', 'Publishing...')
                  : pick('نشر الإصدار', 'Publier', 'Publish release')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetPublishForm();
                }}
                className="px-5 py-2.5 text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}

        {/* Managed rows */}
        {adminLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : adminVersions.length === 0 ? (
          <div className="border border-border px-6 py-10 text-center">
            <Package className="h-8 w-8 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {pick(
                'لا توجد إصدارات مُدارة بعد.',
                'Aucune version gérée pour le moment.',
                'No managed releases yet.',
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {pick(
                'انشر أول إصدار من الزر أعلاه ليقرأه التطبيق.',
                'Publiez une première version ci-dessus pour que l’application la lise.',
                'Publish a first release above for the app to read.',
              )}
            </p>
          </div>
        ) : (
          <div className="border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-[0.15em] text-muted-foreground">
                <tr>
                  <th className="text-start px-3 py-2 font-medium">{pick('الإصدار', 'Version', 'Version')}</th>
                  <th className="text-start px-3 py-2 font-medium">{pick('القناة', 'Canal', 'Channel')}</th>
                  <th className="text-start px-3 py-2 font-medium">{pick('التوزيع', 'Distribution', 'Distribution')}</th>
                  <th className="text-start px-3 py-2 font-medium">{pick('الملف', 'Fichier', 'File')}</th>
                  <th className="text-start px-3 py-2 font-medium">{pick('البصمة', 'Empreinte', 'Digest')}</th>
                  <th className="text-start px-3 py-2 font-medium">{pick('المضيف', 'Hôte', 'Host')}</th>
                  <th className="text-start px-3 py-2 font-medium">{pick('التاريخ', 'Date', 'Date')}</th>
                  <th className="text-start px-3 py-2 font-medium">{pick('الحالة', 'Statut', 'Status')}</th>
                  <th className="text-start px-3 py-2 font-medium">{pick('الاكتمال', 'Complétude', 'Provenance')}</th>
                  <th className="text-start px-3 py-2 font-medium">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {adminVersions.map((row) => {
                  const missing = missingProvenance(row);
                  const complete = missing.length === 0;
                  const active = row.isActive !== false;
                  return (
                    <tr key={row._id} className={active ? '' : 'opacity-70'}>
                      <td className="px-3 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <Tag className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
                          <span className="font-medium">{row.versionName}</span>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono mt-0.5">
                          code {row.versionCode}
                          {row.isMandatory && (
                            <span className="ms-2 uppercase tracking-[0.1em] bg-signal-red/10 text-signal-red px-1.5 py-0.5 font-medium">
                              {pick('إلزامي', 'Obligatoire', 'Mandatory')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        {pick(...CHANNEL_LABELS[row.releaseChannel])}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {pick(...DISTRIBUTION_LABELS[row.distribution])}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="max-w-[16rem] truncate" dir="ltr" title={row.apkFileName || undefined}>
                          {row.apkFileName || '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">{formatMb(row.apkFileSize)}</div>
                      </td>
                      <td className="px-3 py-3 align-top font-mono text-xs" dir="ltr">
                        <span title={row.sha256 || undefined}>{shortSha(row.sha256)}</span>
                      </td>
                      <td className="px-3 py-3 align-top text-xs" dir="ltr">
                        {urlHost(row.downloadUrl)}
                      </td>
                      <td className="px-3 py-3 align-top text-xs whitespace-nowrap">
                        {row.releasedAt ? new Date(row.releasedAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs ${
                            active ? 'text-signal-green' : 'text-muted-foreground'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-signal-green' : 'bg-muted-foreground'}`}
                            aria-hidden="true"
                          />
                          {active ? t('common.active') : t('common.inactive')}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        {complete ? (
                          <span className="inline-flex items-center gap-1.5 text-xs border px-2 py-0.5 bg-signal-green/10 text-signal-green border-signal-green/20">
                            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                            {pick('مكتمل', 'Complet', 'COMPLETE')}
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-start gap-1.5 text-xs border px-2 py-0.5 bg-signal-amber/10 text-signal-amber border-signal-amber/30"
                            title={missing.map((field) => pick(...MISSING_LABELS[field])).join(' • ')}
                          >
                            <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" />
                            <span>
                              {pick('ناقص:', 'Incomplet :', 'Missing:')}{' '}
                              {missing.map((field) => pick(...MISSING_LABELS[field])).join(' • ')}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            {t('common.edit')}
                          </button>
                          {active ? (
                            <button
                              type="button"
                              onClick={() => setPendingDeactivate(row)}
                              disabled={togglingId === row._id}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                            >
                              <PowerOff className="h-3.5 w-3.5" aria-hidden="true" />
                              {pick('تعطيل', 'Désactiver', 'Deactivate')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void applyActive(row, true)}
                              disabled={togglingId === row._id}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-signal-green/40 text-signal-green hover:bg-signal-green/10 transition-colors disabled:opacity-50"
                            >
                              <Power className="h-3.5 w-3.5" aria-hidden="true" />
                              {pick('تفعيل', 'Activer', 'Activate')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground/80">
          {pick(
            'هوية الملف (versionName، versionCode، apkFileName، apkFileSize، downloadUrl، sha256) غير قابلة للتغيير بعد النشر. الإصلاح يعني نشر versionCode جديد.',
            'L’identité de l’artefact (versionName, versionCode, apkFileName, apkFileSize, downloadUrl, sha256) est immuable après publication. Corriger signifie publier un nouveau versionCode.',
            'The artifact identity (versionName, versionCode, apkFileName, apkFileSize, downloadUrl, sha256) is immutable after publish. Fixing it means publishing a new versionCode.',
          )}
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Public view: what a device receives                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-4" aria-labelledby="public-view-heading">
        <div>
          <h2
            id="public-view-heading"
            className="text-base font-display font-bold uppercase tracking-[0.1em]"
          >
            {pick('ما يراه العملاء', 'Vue publique', 'Public view')}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {pick(
              'نتيجة /app/latest و/app/versions و/app/download-url كما تصل إلى الأجهزة.',
              'Résultat de /app/latest, /app/versions et /app/download-url tel que reçu par les appareils.',
              'The result of /app/latest, /app/versions and /app/download-url as received by devices.',
            )}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : (
          <>
            {latest && (
              <div className="border-2 border-primary/30 bg-card">
                <div className="px-5 py-3 border-b border-border bg-muted/50 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">
                    {pick('أحدث إصدار', 'Dernière version', 'Latest release')}
                  </p>
                  {latest.isMandatory && (
                    <span className="text-xs uppercase tracking-[0.1em] bg-signal-red/10 text-signal-red px-2 py-0.5 font-medium border border-signal-red/20">
                      {pick('تحديث إلزامي', 'Mise à jour obligatoire', 'Mandatory update')}
                    </span>
                  )}
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Tag className="h-4 w-4 text-primary" aria-hidden="true" />
                        <span className="text-lg font-display font-bold">{latest.versionName}</span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {pick(`(الرمز: ${latest.versionCode})`, `(code : ${latest.versionCode})`, `(code: ${latest.versionCode})`)}
                        </span>
                      </div>
                      {latest.releasedAt && (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                          {new Date(latest.releasedAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {latest.isActive !== false && (
                        <span className="flex items-center gap-1.5 text-xs text-signal-green">
                          <span className="w-1.5 h-1.5 rounded-full bg-signal-green" aria-hidden="true" />
                          {t('common.active')}
                        </span>
                      )}
                    </div>
                  </div>

                  {latest.releaseNotes && (
                    <div className="space-y-1.5">
                      <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                        {pick('ملاحظات الإصدار', 'Notes de version', 'Release notes')}
                      </p>
                      <div className="bg-muted/50 border border-border px-4 py-3 text-sm whitespace-pre-wrap">
                        {latest.releaseNotes}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                        {pick('الملف', 'Fichier', 'File')}
                      </p>
                      <p className="text-sm font-medium mt-0.5 truncate">{latest.apkFileName || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                        {pick('الحجم', 'Taille', 'Size')}
                      </p>
                      <p className="text-sm font-medium mt-0.5">{formatBytes(latest.apkFileSize)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                        {pick('أدنى إصدار متوافق', 'Compatibilité minimale', 'Min compatible')}
                      </p>
                      <p className="text-sm font-medium mt-0.5">{latest.minCompatibleVersion || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t('common.status')}</p>
                      <p className="text-sm font-medium mt-0.5">
                        {latest.isActive !== false ? t('common.active') : t('common.inactive')}
                      </p>
                    </div>
                  </div>

                  {(downloadUrl || latest.downloadUrl) && (
                    <a
                      href={downloadUrl || latest.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={pick(
                        `تنزيل نسخة APK ${latest.versionName}`,
                        `Télécharger la version APK ${latest.versionName}`,
                        `Download APK version ${latest.versionName}`,
                      )}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      {pick('تنزيل APK', 'Télécharger l’APK', 'Download APK')}
                    </a>
                  )}
                </div>
              </div>
            )}

            {!latest && !error && (
              <div className="border border-border bg-card px-6 py-10 text-center">
                <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">{t('common.noData')}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {pick(
                    'الإصدارات تُدار عبر GitHub Releases (workflow release-candidate) أو بوضع ملف APK في مجلد downloads/ على الخادم ثم تسجيل إصدار جديد من هنا',
                    'Les versions sont gérées via les versions GitHub (workflow release-candidate) ou en plaçant un APK dans le dossier downloads/ du serveur, puis en enregistrant une nouvelle version ici',
                    'Versions are managed via GitHub Releases (release-candidate workflow) or by placing an APK in the server downloads/ folder, then registering a new version here',
                  )}
                </p>
              </div>
            )}

            {versions.length > 1 && (
              <div className="border border-border">
                <div className="px-4 py-2 bg-muted/50 border-b border-border">
                  <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                    {pick(`سجل الإصدارات (${versions.length})`, `Historique des versions (${versions.length})`, `Version history (${versions.length})`)}
                  </h3>
                </div>
                <div className="divide-y divide-border">
                  {versions.map((v) => (
                    <div key={v._id} className="flex items-center gap-4 px-4 py-3">
                      <Package className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{v.versionName}</span>
                          <span className="text-xs text-muted-foreground font-mono">v{v.versionCode}</span>
                          {v.isMandatory && (
                            <span className="text-xs uppercase tracking-[0.1em] bg-signal-red/10 text-signal-red px-1.5 py-0.5 font-medium">
                              {pick('إلزامي', 'Obligatoire', 'Mandatory')}
                            </span>
                          )}
                          {v.isActive === false && (
                            <span className="text-xs uppercase tracking-[0.1em] bg-muted text-muted-foreground px-1.5 py-0.5">
                              {t('common.inactive')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          {v.releasedAt && <span>{new Date(v.releasedAt).toLocaleDateString()}</span>}
                          {v.apkFileSize && <span>{formatBytes(v.apkFileSize)}</span>}
                          {v.releaseNotes && (
                            <span className="relative inline-flex items-center gap-1.5">
                              <FileText className="h-3 w-3" aria-hidden="true" />{' '}
                              {pick('توجد ملاحظات', 'Notes disponibles', 'Has notes')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Edit modal: mutable metadata only                                  */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        open={editing !== null}
        onClose={closeEdit}
        title={editing ? pick(`تعديل الإصدار ${editing.versionName}`, `Modifier la version ${editing.versionName}`, `Edit version ${editing.versionName}`) : undefined}
        size="lg"
      >
        {editing && draft && (
          <div className="p-5 space-y-5">
            {editError && (
              <div role="alert" className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {editError}
              </div>
            )}

            {/* Immutable identity */}
            <div className="border border-border bg-muted/40 px-4 py-3 space-y-2">
              <p className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                {pick('هوية الملف — غير قابلة للتعديل', 'Identité de l’artefact — non modifiable', 'Artifact identity — read-only')}
              </p>
              <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2" dir="ltr">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">versionName</dt>
                  <dd className="font-mono text-end">{editing.versionName}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">versionCode</dt>
                  <dd className="font-mono text-end">{editing.versionCode}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">apkFileName</dt>
                  <dd className="font-mono text-end truncate">{editing.apkFileName || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">apkFileSize</dt>
                  <dd className="font-mono text-end">{editing.apkFileSize || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2 sm:col-span-2">
                  <dt className="text-muted-foreground">downloadUrl</dt>
                  <dd className="font-mono text-end truncate">{editing.downloadUrl || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2 sm:col-span-2">
                  <dt className="text-muted-foreground">sha256</dt>
                  <dd className="font-mono text-end truncate">{editing.sha256 || '—'}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                {pick(
                  'لتصحيح أي من هذه القيم انشر versionCode جديداً؛ لا يمكن إعادة توجيه نفس الرمز (يرفضه الخادم بـ400).',
                  'Pour corriger l’une de ces valeurs, publiez un nouveau versionCode ; le même code ne peut pas être re-pointé (le serveur renvoie 400).',
                  'To fix any of these, publish a new versionCode; the same code cannot be re-pointed (the server returns 400).',
                )}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                {pick('قناة الإصدار', 'Canal de version', 'Release channel')}
                <select
                  value={draft.releaseChannel}
                  onChange={(e) => setDraft({ ...draft, releaseChannel: e.target.value as ReleaseChannel })}
                  className={inputClass}
                >
                  {APP_VERSION_RELEASE_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {pick(...CHANNEL_LABELS[channel])}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                {pick('قناة التوزيع', 'Distribution', 'Distribution')}
                <select
                  value={draft.distribution}
                  onChange={(e) => setDraft({ ...draft, distribution: e.target.value as Distribution })}
                  className={inputClass}
                >
                  {APP_VERSION_DISTRIBUTIONS.map((dist) => (
                    <option key={dist} value={dist}>
                      {pick(...DISTRIBUTION_LABELS[dist])}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                {pick('أدنى إصدار متوافق', 'Version minimale compatible', 'Min compatible version')}
                <input
                  value={draft.minCompatibleVersion}
                  onChange={(e) => setDraft({ ...draft, minCompatibleVersion: e.target.value })}
                  inputMode="numeric"
                  dir="ltr"
                  className={inputClass}
                />
              </label>
              <div className="flex items-end pb-1">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.isMandatory}
                    onChange={(e) => setDraft({ ...draft, isMandatory: e.target.checked })}
                    className="h-4 w-4 accent-primary"
                  />
                  {pick('تحديث إلزامي', 'Mise à jour obligatoire', 'Mandatory update')}
                </label>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                {pick('المنصات (فارغ = الكل)', 'Plateformes (vide = toutes)', 'Platforms (empty = all)')}
              </legend>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {platformOptionsFor(editing.platforms).map((platform) => (
                  <label key={platform} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.platforms.includes(platform)}
                      onChange={() => setDraft({ ...draft, platforms: togglePlatform(platform, draft.platforms) })}
                      className="h-4 w-4 accent-primary"
                    />
                    {pick(...platformLabel(platform))}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className={labelClass}>
              {pick('ملاحظات الإصدار', 'Notes de version', 'Release notes')}
              <textarea
                value={draft.releaseNotes}
                onChange={(e) => setDraft({ ...draft, releaseNotes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-border bg-background text-sm focus-visible:outline-none focus-visible:border-primary"
              />
            </label>

            <p className="text-xs text-muted-foreground">
              {pick(
                'سيُسجَّل هذا التعديل في سجل التدقيق باسم APP_VERSION_UPDATE مع القيم قبل وبعد.',
                'Cette modification sera journalisée sous APP_VERSION_UPDATE avec les valeurs avant/après.',
                'This edit will be logged as APP_VERSION_UPDATE with before/after values.',
              )}
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSaveEdit()}
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {saving ? t('common.saving') : t('common.save')}
              </button>
              <button
                type="button"
                onClick={closeEdit}
                disabled={saving}
                className="px-5 py-2.5 text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Deactivation confirmation */}
      <ConfirmDialog
        open={pendingDeactivate !== null}
        title={pick('تعطيل إصدار', 'Désactiver une version', 'Deactivate release')}
        message={
          pendingDeactivate
            ? pick(
                `سيتم تعطيل الإصدار ${pendingDeactivate.versionName} (رمز ${pendingDeactivate.versionCode}) فلن يقدّم للأجهزة. متابعة؟`,
                `La version ${pendingDeactivate.versionName} (code ${pendingDeactivate.versionCode}) sera désactivée et ne sera plus proposée aux appareils. Continuer ?`,
                `Version ${pendingDeactivate.versionName} (code ${pendingDeactivate.versionCode}) will be deactivated and no longer served to devices. Continue?`,
              )
            : ''
        }
        confirmLabel={pick('تعطيل', 'Désactiver', 'Deactivate')}
        variant="destructive"
        loading={togglingId !== null}
        onConfirm={() => {
          if (pendingDeactivate) void applyActive(pendingDeactivate, false);
        }}
        onCancel={() => {
          if (togglingId === null) setPendingDeactivate(null);
        }}
      />
    </div>
  );
}
