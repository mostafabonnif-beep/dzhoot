'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bug,
  Filter,
  Loader2,
  RefreshCw,
  Smartphone,
  TriangleAlert,
} from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';

type Kind = 'problem' | 'crash';
type Status = 'new' | 'triaged' | 'investigating' | 'resolved' | 'duplicate';

interface ReportRow {
  id: string;
  kind: Kind;
  reportId: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
  appVersion: string | null;
  appVersionCode: number | null;
  platform: string | null;
  deviceModel: string | null;
  deviceBrand: string | null;
  androidVersion: string | null;
  sdkInt: number | null;
  deviceId: string | null;
  feature: string | null;
  screen: string | null;
  errorCode: string | null;
  severity: string | null;
  retryable: boolean | null;
  correlationId: string | null;
  dedupeKey: string | null;
  message: string;
  diagnostics: Record<string, unknown> | null;
  adminNotes: string | null;
  resolvedInVersion: string | null;
}

interface ReportGroup {
  errorCode: string | null;
  feature: string | null;
  appVersionCode: number | null;
  count: number;
  deviceCount: number;
  lastSeenAt: string;
}

interface ListResponse {
  data: ReportRow[];
  groups: ReportGroup[];
  statusCounts: Record<string, number>;
}

const EMPTY = '—';
const STATUSES: Status[] = ['new', 'triaged', 'investigating', 'resolved', 'duplicate'];

const STATUS_LABEL: Record<Status, string> = {
  new: 'جديد',
  triaged: 'مُصنَّف',
  investigating: 'قيد التحقيق',
  resolved: 'تم الحل',
  duplicate: 'مكرر',
};

const STATUS_STYLE: Record<Status, string> = {
  new: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  triaged: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  investigating: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  resolved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  duplicate: 'bg-white/10 text-white/60 border-white/20',
};

function formatDate(value?: string | null): string {
  if (!value) return EMPTY;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? EMPTY : date.toLocaleString();
}

/** Turn an axios/network failure into a readable message instead of an empty list. */
function describeError(error: unknown): string {
  const anyError = error as { response?: { status?: number; data?: { error?: string } } };
  const status = anyError?.response?.status;
  const serverMessage = anyError?.response?.data?.error;
  if (status === 401) return 'انتهت الجلسة. سجّل الدخول من جديد.';
  if (status === 403) return 'ليس لديك صلاحية عرض بلاغات العملاء.';
  if (serverMessage) return serverMessage;
  if (status) return `فشل الطلب (${status}).`;
  return 'تعذر الوصول إلى الخادم. تحقّق من الاتصال وأعد المحاولة.';
}

function TextRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-mono text-xs break-all" dir="ltr">
        {value === null || value === undefined || value === '' ? EMPTY : String(value)}
      </span>
    </div>
  );
}

export default function AdminErrorReportsPage() {
  const { t } = useLocale();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [groups, setGroups] = useState<ReportGroup[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [status, setStatus] = useState<Status | 'ALL'>('ALL');
  const [kind, setKind] = useState<Kind | 'ALL'>('ALL');
  const [errorCode, setErrorCode] = useState('');
  const [feature, setFeature] = useState('');
  const [deviceId, setDeviceId] = useState('');

  const [notes, setNotes] = useState('');
  const [fixVersion, setFixVersion] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | undefined> = {
        kind: kind === 'ALL' ? undefined : kind,
        status: status === 'ALL' ? undefined : status,
        errorCode: errorCode.trim() || undefined,
        feature: feature.trim() || undefined,
        deviceId: deviceId.trim() || undefined,
        limit: '100',
      };
      const response = await api.get<ListResponse>('/admin/error-reports', { params });
      setRows(response.data.data || []);
      setGroups(response.data.groups || []);
      setStatusCounts(response.data.statusCounts || {});
    } catch (err) {
      // A failed request must never look like "no reports" — the same trap the tickets
      // page has, where a 500 renders the empty-state copy.
      setRows([]);
      setGroups([]);
      setStatusCounts({});
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [kind, status, errorCode, feature, deviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) || null,
    [rows, selectedId],
  );

  useEffect(() => {
    setNotes(selected?.adminNotes || '');
    setFixVersion(selected?.resolvedInVersion || '');
    setSaveError(null);
  }, [selected?.id, selected?.adminNotes, selected?.resolvedInVersion]);

  const save = useCallback(
    async (nextStatus: Status) => {
      if (!selected || selected.kind === 'crash') return;
      setSaving(true);
      setSaveError(null);
      try {
        await api.patch(`/admin/error-reports/${selected.id}`, {
          status: nextStatus,
          adminNotes: notes,
          resolvedInVersion: fixVersion,
        });
        await load();
      } catch (err) {
        setSaveError(describeError(err));
      } finally {
        setSaving(false);
      }
    },
    [selected, notes, fixVersion, load],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bug className="h-5 w-5 text-gold" />
          <h1 className="text-xl font-semibold">{t('nav.errorReports')}</h1>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-white/10 bg-card/40 p-3">
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          التصفية
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">النوع</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as Kind | 'ALL')}
              className="rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm"
            >
              <option value="ALL">الكل</option>
              <option value="problem">بلاغ عميل</option>
              <option value="crash">عطل تلقائي</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">كود الخطأ</span>
            <input
              value={errorCode}
              onChange={(event) => setErrorCode(event.target.value)}
              placeholder="PLAYBACK_FAILED"
              className="w-44 rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm"
              dir="ltr"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">الميزة</span>
            <input
              value={feature}
              onChange={(event) => setFeature(event.target.value)}
              placeholder="player"
              className="w-36 rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm"
              dir="ltr"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">معرّف الجهاز</span>
            <input
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
              placeholder="dz-…"
              className="w-48 rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm"
              dir="ltr"
            />
          </label>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2">
        {(['ALL', ...STATUSES] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setStatus(entry)}
            className={`rounded-lg border px-3 py-1 text-xs ${
              status === entry
                ? 'border-gold/40 bg-gold/15 text-gold'
                : 'border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10'
            }`}
          >
            {entry === 'ALL' ? 'الكل' : STATUS_LABEL[entry]}
            {entry !== 'ALL' && statusCounts[entry] ? ` (${statusCounts[entry]})` : ''}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 rounded-lg border border-red-400/30 px-2 py-1 text-xs hover:bg-red-500/10"
            >
              {t('common.retry')}
            </button>
          </div>
        </div>
      )}

      {groups.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-card/40 p-3">
          <p className="mb-2 text-xs text-muted-foreground">أكثر الأعطال تكرارًا</p>
          <div className="flex flex-wrap gap-2">
            {groups.slice(0, 8).map((group) => (
              <button
                key={`${group.errorCode}-${group.feature}-${group.appVersionCode}`}
                type="button"
                onClick={() => {
                  setErrorCode(group.errorCode || '');
                  setFeature(group.feature || '');
                }}
                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-start text-xs hover:bg-white/10"
              >
                <span className="block font-mono text-[11px]" dir="ltr">
                  {group.errorCode || 'بدون كود'}
                </span>
                <span className="text-muted-foreground">
                  {group.count} بلاغ · {group.deviceCount} جهاز
                  {group.appVersionCode ? ` · ${group.appVersionCode}` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        {/* List */}
        <div className="rounded-xl border border-white/10 bg-card/40">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحميل…
            </div>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {error ? '—' : 'لا توجد بلاغات مطابقة.'}
            </p>
          ) : (
            <ul className="divide-y divide-white/5">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className={`w-full px-3 py-2.5 text-start hover:bg-white/5 ${
                      selectedId === row.id ? 'bg-white/5' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        {row.kind === 'crash' ? (
                          <TriangleAlert className="h-3.5 w-3.5 text-red-300" />
                        ) : (
                          <Bug className="h-3.5 w-3.5 text-gold" />
                        )}
                        <span className="font-mono text-xs" dir="ltr">
                          {row.reportId}
                        </span>
                      </span>
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-[10px] ${
                          row.kind === 'crash'
                            ? 'border-red-500/30 bg-red-500/10 text-red-200'
                            : STATUS_STYLE[row.status]
                        }`}
                      >
                        {row.kind === 'crash' ? 'عطل تلقائي' : STATUS_LABEL[row.status]}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-sm">{row.message || EMPTY}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="font-mono" dir="ltr">
                        {row.errorCode || 'بدون كود'}
                      </span>
                      {row.feature && <span dir="ltr">{row.feature}</span>}
                      {row.appVersionCode && <span dir="ltr">v{row.appVersionCode}</span>}
                      {row.deviceModel && <span dir="ltr">{row.deviceModel}</span>}
                      <span>{formatDate(row.createdAt)}</span>
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detail */}
        <div className="rounded-xl border border-white/10 bg-card/40 p-4">
          {!selected ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              اختر بلاغًا لعرض تفاصيله.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-mono text-sm" dir="ltr">
                  {selected.reportId}
                </h2>
                <span className="text-[11px] text-muted-foreground">
                  {formatDate(selected.createdAt)}
                </span>
              </div>

              <div className="rounded-lg border border-white/10 bg-background/40 p-3">
                <p className="text-sm whitespace-pre-wrap">{selected.message || EMPTY}</p>
              </div>

              <div className="divide-y divide-white/5">
                <TextRow label="النوع" value={selected.kind === 'crash' ? 'عطل تلقائي' : 'بلاغ عميل'} />
                <TextRow label="كود الخطأ" value={selected.errorCode} />
                <TextRow label="الميزة" value={selected.feature} />
                <TextRow label="الشاشة" value={selected.screen} />
                <TextRow label="الخطورة" value={selected.severity} />
                <TextRow
                  label="قابل لإعادة المحاولة"
                  value={selected.retryable === null ? null : selected.retryable ? 'نعم' : 'لا'}
                />
                <TextRow label="إصدار التطبيق" value={selected.appVersion} />
                <TextRow label="كود الإصدار" value={selected.appVersionCode} />
                <TextRow label="المنصّة" value={selected.platform} />
                <TextRow label="الجهاز" value={[selected.deviceBrand, selected.deviceModel].filter(Boolean).join(' ') || null} />
                <TextRow label="أندرويد" value={selected.androidVersion} />
                <TextRow label="معرّف الجهاز" value={selected.deviceId} />
                <TextRow label="معرّف الارتباط" value={selected.correlationId} />
                <TextRow label="مجموعة التكرار" value={selected.dedupeKey} />
                {selected.resolvedInVersion && (
                  <TextRow label="أُصلح في" value={selected.resolvedInVersion} />
                )}
              </div>

              {selected.diagnostics && (
                <details className="rounded-lg border border-white/10 bg-background/40 p-3">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    لقطة تشخيصية
                  </summary>
                  <pre className="mt-2 max-h-72 overflow-auto text-[11px] whitespace-pre-wrap" dir="ltr">
                    {JSON.stringify(selected.diagnostics, null, 2)}
                  </pre>
                </details>
              )}

              {selected.kind === 'crash' ? (
                <p className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-muted-foreground">
                  <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  بلاغ تلقائي من التطبيق: لا يحمل حالة تصنيف. الكود يشير إلى العطل، و
                  <span className="font-mono mx-1">معرّف الارتباط</span>
                  يربطه بسجلّ الطلب على الخادم.
                </p>
              ) : (
                <div className="space-y-2">
                  <label className="block text-xs">
                    <span className="mb-1 block text-muted-foreground">ملاحظات المتابعة</span>
                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      rows={3}
                      maxLength={4000}
                      className="w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="mb-1 block text-muted-foreground">أُصلح في إصدار</span>
                    <input
                      value={fixVersion}
                      onChange={(event) => setFixVersion(event.target.value)}
                      placeholder="1.3.2"
                      className="w-32 rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm"
                      dir="ltr"
                    />
                  </label>

                  {saveError && <p className="text-xs text-red-300">{saveError}</p>}

                  <div className="flex flex-wrap gap-2">
                    {STATUSES.map((entry) => (
                      <button
                        key={entry}
                        type="button"
                        disabled={saving || selected.status === entry}
                        onClick={() => void save(entry)}
                        className={`rounded-lg border px-2.5 py-1 text-xs disabled:opacity-40 ${
                          selected.status === entry
                            ? STATUS_STYLE[entry]
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        }`}
                      >
                        {saving && selected.status !== entry ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          STATUS_LABEL[entry]
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
