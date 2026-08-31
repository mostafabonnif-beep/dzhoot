'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, Eye, Loader2, Plus } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import Modal from '@/components/ui/modal';
import DataTable, { type DataTableColumn } from '@/components/ui/data-table';
import { useLocale } from '@/components/locale-provider';

interface ResellerOption {
  _id: string;
  name: string;
  city?: string;
  status: 'Active' | 'Inactive';
}

interface PlanOption {
  _id: string;
  name: string;
  durationDays: number;
  status?: string;
}

interface BatchData {
  _id: string;
  batchNumber: number;
  resellerId: string;
  planId: string;
  quantity: number;
  receiptDate: string;
  notes?: string;
  status: 'delivered' | 'pending';
  reseller: { _id?: string; name: string; city?: string } | null;
  plan: { _id?: string; name: string; durationDays: number } | null;
  stats?: { total: number; activated: number; remaining: number; revoked: number };
  wholesalePrice?: number | null;
  createdAt?: string;
}

interface BatchCode {
  _id: string;
  prefix: string;
  codeLast4: string;
  status: 'UNUSED' | 'ACTIVATED' | 'REVOKED' | 'EXPIRED';
  activatedAt?: string | null;
}

interface BatchResult {
  batch: {
    _id: string;
    batchNumber: number;
    reseller: { name: string; city?: string } | null;
    plan: { name: string; durationDays: number } | null;
    receiptDate: string;
    quantity: number;
    wholesalePrice?: number | null;
    wholesaleTotal?: number | null;
  };
  codes: string[];
}

interface BatchForm {
  resellerId: string;
  planId: string;
  quantity: string;
  receiptDate: string;
  notes: string;
  prefix: string;
}

const inputClass =
  'flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary';

function todayString() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function displayCode(prefix: string, last4: string) {
  return `${prefix}-••••-••••-${last4}`;
}

function codeStatusBadge(status: BatchCode['status'], t: (k: string) => string) {
  const keys: Record<BatchCode['status'], string> = {
    UNUSED: 'codes.unused',
    ACTIVATED: 'codes.activated',
    REVOKED: 'codes.revoked',
    EXPIRED: 'codes.expired',
  };
  const map: Record<BatchCode['status'], string> = {
    UNUSED: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    ACTIVATED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    REVOKED: 'bg-destructive/15 text-destructive',
    EXPIRED: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-medium ${map[status]}`}>
      {t(keys[status])}
    </span>
  );
}

export default function CodeBatchesPage() {
  const { toast } = useToast();
  const { t } = useLocale();
  const [batches, setBatches] = useState<BatchData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [resellers, setResellers] = useState<ResellerOption[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);

  // New batch modal
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<BatchForm>({
    resellerId: '',
    planId: '',
    quantity: '100',
    receiptDate: todayString(),
    notes: '',
    prefix: 'DZHF',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Result modal (created batch + plaintext codes)
  const [result, setResult] = useState<BatchResult | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // View codes modal
  const [viewTarget, setViewTarget] = useState<BatchData | null>(null);
  const [batchCodes, setBatchCodes] = useState<BatchCode[]>([]);
  const [codesLoading, setCodesLoading] = useState(false);
  const [codesError, setCodesError] = useState('');

  const fetchBatches = useCallback(async () => {
    try {
      const res = await api.get('/admin/code-batches');
      setBatches(res.data?.data || []);
      setError('');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr.response?.data?.error || t('batches.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const fetchOptions = useCallback(async () => {
    try {
      const [resellersRes, plansRes] = await Promise.all([
        api.get('/admin/resellers'),
        api.get('/admin/plans'),
      ]);
      setResellers(resellersRes.data?.data || []);
      setPlans(plansRes.data?.data || []);
    } catch {
      // options are loaded lazily; failures surface when submitting
    }
  }, []);

  useEffect(() => {
    fetchBatches();
    fetchOptions();
  }, [fetchBatches, fetchOptions]);

  function openCreate() {
    setForm({
      resellerId: resellers[0]?._id ?? '',
      planId: plans[0]?._id ?? '',
      quantity: '100',
      receiptDate: todayString(),
      notes: '',
      prefix: 'DZHF',
    });
    setFormError('');
    setFormOpen(true);
  }

  async function handleCreate() {
    setSaving(true);
    setFormError('');
    try {
      const res = await api.post('/admin/code-batches', {
        resellerId: form.resellerId,
        planId: form.planId,
        quantity: Number(form.quantity),
        receiptDate: form.receiptDate || undefined,
        notes: form.notes.trim() || undefined,
        prefix: form.prefix.trim() || undefined,
      });
      const data = res.data?.data;
      setResult(data || null);
      setFormOpen(false);
      toast(t('batches.createSuccess'), 'success');
      fetchBatches();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setFormError(axiosErr.response?.data?.error || t('batches.createError'));
    } finally {
      setSaving(false);
    }
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedCode(key);
    setTimeout(() => setCopiedCode(null), 1500);
  }

  function handleCopyAll() {
    if (!result) return;
    navigator.clipboard.writeText(result.codes.join('\n')).catch(() => {});
    setCopiedAll(true);
    toast(t('batches.copied'), 'success');
    setTimeout(() => setCopiedAll(false), 1500);
  }

  async function downloadBatchFile(batchId: string, batchNumber?: number) {
    try {
      const res = await api.get(`/admin/code-batches/${batchId}/export`, {
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'text/plain;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = batchNumber ? `dzhoof-batch-${batchNumber}.txt` : 'dzhoof-batch.txt';
      a.click();
      URL.revokeObjectURL(url);
      toast(t('batches.exportSuccess'), 'success');
    } catch {
      toast(t('batches.exportError'), 'error');
    }
  }

  async function openViewCodes(b: BatchData) {
    setViewTarget(b);
    setBatchCodes([]);
    setCodesError('');
    setCodesLoading(true);
    try {
      const res = await api.get(`/admin/code-batches/${b._id}/codes`);
      setBatchCodes(res.data?.data || []);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setCodesError(axiosErr.response?.data?.error || t('batches.codesLoadError'));
    } finally {
      setCodesLoading(false);
    }
  }

  function batchLabel(b: { batchNumber: number }) {
    return `${t('batches.batchLabel')} #${b.batchNumber}`;
  }

  const columns: DataTableColumn<BatchData>[] = [
    {
      key: 'batchNumber',
      header: t('batches.batchNumber'),
      cell: (b) => <span className="font-medium whitespace-nowrap">{batchLabel(b)}</span>,
    },
    {
      key: 'shop',
      header: t('batches.shop'),
      cell: (b) =>
        b.reseller ? (
          <div className="min-w-0">
            <div className="font-medium truncate">{b.reseller.name}</div>
            {b.reseller.city && (
              <div className="text-xs text-muted-foreground truncate">{b.reseller.city}</div>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'plan',
      header: t('batches.plan'),
      cell: (b) =>
        b.plan ? (
          <div className="min-w-0">
            <div className="truncate">{b.plan.name}</div>
            <div className="text-xs text-muted-foreground">
              {b.plan.durationDays} {t('common.days')}
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'quantity',
      header: t('batches.quantity'),
      cell: (b) => <span>{b.quantity}</span>,
    },
    {
      key: 'wholesale',
      mobileHidden: true,
      header: t('batches.wholesale'),
      cell: (b) =>
        b.wholesalePrice != null ? (
          <span>
            {b.wholesalePrice} دج
            {b.stats?.total ? (
              <span className="block text-xs text-muted-foreground">
                = {b.wholesalePrice * b.stats.total} دج
              </span>
            ) : null}
          </span>
        ) : null,
    },
    {
      key: 'receiptDate',
      mobileHidden: true,
      header: t('batches.receiptDate'),
      cell: (b) => (
        <span className="text-xs whitespace-nowrap" dir="ltr">
          {b.receiptDate ? b.receiptDate.slice(0, 10) : '—'}
        </span>
      ),
    },
    {
      key: 'stats',
      header: t('resellers.stats'),
      cell: (b) => {
        const stats = b.stats || { total: 0, activated: 0, remaining: 0, revoked: 0 };
        return (
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {stats.activated} / {stats.total}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {stats.remaining} {t('batches.remaining')}
              {stats.revoked > 0 && (
                <span className="text-destructive">
                  {' '}
                  · {stats.revoked} {t('batches.revoked')}
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: t('batches.status'),
      cell: (b) =>
        b.status === 'delivered' ? (
          <span className="inline-flex px-2 py-0.5 text-xs font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            {t('batches.delivered')}
          </span>
        ) : (
          <span className="inline-flex px-2 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400">
            {t('batches.pending')}
          </span>
        ),
    },
    {
      key: 'actions',
      header: '',
      cell: (b) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openViewCodes(b);
            }}
            className="inline-flex items-center gap-1.5 p-1.5 text-muted-foreground hover:text-foreground"
            title={t('batches.viewCodes')}
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              downloadBatchFile(b._id, b.batchNumber);
            }}
            className="inline-flex items-center gap-1.5 p-1.5 text-muted-foreground hover:text-foreground"
            title={t('batches.downloadFile')}
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">
            {t('batches.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {batches.length} {t('batches.batchLabel')}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          {t('batches.new')}
        </button>
      </div>

      {error && (
        <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={batches}
        gridTemplate="90px minmax(160px,1.4fr) minmax(140px,1fr) 80px 110px 130px 100px 110px"
        ariaLabel={t('batches.title')}
        emptyMessage={t('batches.empty')}
        rowKey={(b) => b._id}
      />

      {/* New batch modal */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={t('batches.new')}>
        <div className="p-5 space-y-4">
          {formError && (
            <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('batches.shop')} *
            </label>
            <select
              className={inputClass}
              value={form.resellerId}
              onChange={(e) => setForm({ ...form, resellerId: e.target.value })}
            >
              {resellers.length === 0 && <option value="">{t('batches.noResellers')}</option>}
              {resellers.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name}
                  {r.city ? ` — ${r.city}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('batches.plan')} *
            </label>
            <select
              className={inputClass}
              value={form.planId}
              onChange={(e) => setForm({ ...form, planId: e.target.value })}
            >
              {plans.length === 0 && <option value="">{t('batches.noPlans')}</option>}
              {plans.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} — {p.durationDays} {t('common.days')}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {t('batches.quantity')} *
              </label>
              <input
                className={inputClass}
                type="number"
                min={1}
                max={10000}
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {t('batches.receiptDate')}
              </label>
              <input
                className={inputClass}
                type="date"
                value={form.receiptDate}
                onChange={(e) => setForm({ ...form, receiptDate: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('batches.prefix')}
            </label>
            <input
              className={inputClass}
              value={form.prefix}
              maxLength={8}
              onChange={(e) => setForm({ ...form, prefix: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('batches.notes')}
            </label>
            <textarea
              className={`${inputClass} h-auto py-2`}
              value={form.notes}
              maxLength={500}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder={t('batches.notesPlaceholder')}
              rows={2}
            />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleCreate}
              disabled={saving || !form.resellerId || !form.planId || !Number(form.quantity)}
              className="inline-flex items-center px-6 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {saving ? t('common.saving') : t('common.create')}
            </button>
            <button
              onClick={() => setFormOpen(false)}
              disabled={saving}
              className="px-6 py-2.5 text-sm font-medium border border-border uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Result modal: created batch + plaintext codes (shown once) */}
      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        title={t('batches.codesTitle')}
        size="lg"
      >
        <div className="p-5 space-y-4">
          {result && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="border border-border bg-muted/30 px-3 py-2">
                  <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                    {t('batches.batchNumber')}
                  </div>
                  <div className="text-sm font-medium mt-0.5">{batchLabel(result.batch)}</div>
                </div>
                <div className="border border-border bg-muted/30 px-3 py-2">
                  <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                    {t('batches.shop')}
                  </div>
                  <div className="text-sm font-medium mt-0.5 truncate">
                    {result.batch.reseller?.name || '—'}
                  </div>
                </div>
                <div className="border border-border bg-muted/30 px-3 py-2">
                  <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                    {t('batches.quantity')}
                  </div>
                  <div className="text-sm font-medium mt-0.5">{result.batch.quantity}</div>
                </div>
                {result.batch.wholesaleTotal != null ? (
                  <div className="border border-border bg-muted/30 px-3 py-2">
                    <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                      {t('batches.wholesaleTotal')}
                    </div>
                    <div className="text-sm font-medium mt-0.5">
                      {result.batch.wholesalePrice} دج × {result.batch.quantity} ={' '}
                      <strong>{result.batch.wholesaleTotal} دج</strong>
                    </div>
                  </div>
                ) : null}
                <div className="border border-border bg-muted/30 px-3 py-2">
                  <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                    {t('batches.receiptDate')}
                  </div>
                  <div className="text-sm font-medium mt-0.5" dir="ltr">
                    {result.batch.receiptDate
                      ? String(result.batch.receiptDate).slice(0, 10)
                      : '—'}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleCopyAll}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  {copiedAll ? (
                    <Check className="h-4 w-4 text-emerald-300" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {t('batches.copyAll')}
                </button>
                <button
                  onClick={() => downloadBatchFile(result.batch._id, result.batch.batchNumber)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.1em] border border-border text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Download className="h-4 w-4" />
                  {t('batches.downloadFile')}
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto border border-border divide-y divide-border">
                {result.codes.map((code) => (
                  <div key={code} className="flex items-center justify-between gap-2 px-3 py-2">
                    <code className="font-mono text-sm" dir="ltr">
                      {code}
                    </code>
                    <button
                      onClick={() => copyText(code, code)}
                      className="p-1.5 text-muted-foreground hover:text-foreground"
                      title={t('common.copy')}
                    >
                      {copiedCode === code ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t('batches.resultHelp')}</p>
            </>
          )}
        </div>
      </Modal>

      {/* View codes modal */}
      <Modal
        open={!!viewTarget}
        onClose={() => setViewTarget(null)}
        title={viewTarget ? `${t('batches.codesTitle')} — ${batchLabel(viewTarget)}` : ''}
        size="lg"
      >
        <div className="p-5 space-y-4">
          {codesLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : codesError ? (
            <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {codesError}
            </div>
          ) : (
            <>
              {viewTarget?.notes && (
                <p className="text-sm text-muted-foreground">{viewTarget.notes}</p>
              )}
              <div className="max-h-80 overflow-y-auto border border-border divide-y divide-border">
                {batchCodes.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {t('codes.empty')}
                  </div>
                ) : (
                  batchCodes.map((c) => (
                    <div key={c._id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <code className="font-mono text-sm" dir="ltr">
                        {displayCode(c.prefix, c.codeLast4)}
                      </code>
                      <div className="flex items-center gap-2 shrink-0">
                        {c.activatedAt && (
                          <span className="text-xs text-muted-foreground" dir="ltr">
                            {new Date(c.activatedAt).toLocaleDateString()}
                          </span>
                        )}
                        {codeStatusBadge(c.status, t)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
