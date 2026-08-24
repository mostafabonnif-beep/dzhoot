'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, History, RotateCcw } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import Modal from '@/components/ui/modal';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import DataTable, { type DataTableColumn } from '@/components/ui/data-table';
import { useLocale } from '@/components/locale-provider';

interface ResellerData {
  _id: string;
  name: string;
  city?: string;
  phone?: string;
  notes?: string;
  status: 'Active' | 'Inactive';
  prices?: { planId: string; price: number }[];
  credit?: { planId: string; quantity: number }[];
  username?: string;
  stats?: { total: number; activated: number; remaining: number };
  createdAt?: string;
}

interface ResellerForm {
  name: string;
  city: string;
  phone: string;
  notes: string;
  status: 'Active' | 'Inactive';
  prices: { planId: string; price: string }[];
  credit: { planId: string; quantity: string }[];
  username: string;
  password: string;
}

const emptyForm: ResellerForm = {
  name: '',
  city: '',
  phone: '',
  notes: '',
  status: 'Active',
  prices: [],
  credit: [],
  username: '',
  password: '',
};

const inputClass =
  'flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary';

export default function ResellersPage() {
  const { toast } = useToast();
  const { t } = useLocale();
  const [resellers, setResellers] = useState<ResellerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ResellerForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<ResellerData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [plans, setPlans] = useState<{ _id: string; name: string; durationDays: number }[]>([]);

  const fetchPlans = useCallback(async () => {
    try {
      const res = await api.get('/admin/plans');
      setPlans((res.data?.data || []).filter((p: { status?: string }) => p.status !== 'Inactive'));
    } catch {
      // price editor is optional — ignore failures
    }
  }, []);

  const fetchResellers = useCallback(async () => {
    try {
      const res = await api.get('/admin/resellers');
      setResellers(res.data?.data || []);
      setError('');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr.response?.data?.error || t('resellers.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchResellers();
    fetchPlans();
  }, [fetchResellers, fetchPlans]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(r: ResellerData) {
    setEditingId(r._id);
    const existing = (r.prices || []).map((p) => ({ planId: String(p.planId), price: String(p.price) }));
    const existingCredit = (r.credit || []).map((c) => ({ planId: String(c.planId), quantity: String(c.quantity) }));
    setForm({
      name: r.name,
      city: r.city || '',
      phone: r.phone || '',
      notes: r.notes || '',
      status: r.status,
      prices: existing,
      credit: existingCredit,
      username: r.username || '',
      password: '',
    });
    setFormError('');
    setFormOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        name: form.name.trim(),
        city: form.city.trim(),
        phone: form.phone.trim(),
        notes: form.notes.trim(),
        status: form.status,
        prices: form.prices
          .filter((p) => p.planId && p.price !== '')
          .map((p) => ({ planId: p.planId, price: Number(p.price) })),
        credit: form.credit
          .filter((c) => c.planId && c.quantity !== '')
          .map((c) => ({ planId: c.planId, quantity: Number(c.quantity) })),
        username: form.username.trim() || undefined,
        password: form.password || undefined,
      };
      if (editingId) {
        await api.put(`/admin/resellers/${editingId}`, payload);
        toast(t('resellers.updateSuccess'), 'success');
      } else {
        await api.post('/admin/resellers', payload);
        toast(t('resellers.createSuccess'), 'success');
      }
      setFormOpen(false);
      fetchResellers();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setFormError(axiosErr.response?.data?.error || t('resellers.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/resellers/${deleteTarget._id}`);
      toast(t('resellers.deleteSuccess'), 'success');
      setDeleteTarget(null);
      fetchResellers();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      const serverError = axiosErr.response?.data?.error;
      // The server rejects deletion when activation codes reference the reseller.
      toast(
        serverError?.startsWith('Cannot delete') ? t('resellers.cannotDelete') : serverError || t('resellers.deleteError'),
        'error',
      );
    } finally {
      setDeleting(false);
    }
  }

  // ---- Credit ledger (سجل حركات الرصيد) ----
  const [ledgerReseller, setLedgerReseller] = useState<ResellerData | null>(null);
  const [ledgerRows, setLedgerRows] = useState<Array<{ _id: string; type: string; quantity: number; balanceAfter: number; planName: string; note: string; createdAt: string }>>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [returning, setReturning] = useState(false);

  async function openLedger(r: ResellerData) {
    setLedgerReseller(r);
    setLedgerRows([]);
    setLedgerLoading(true);
    try {
      const res = await api.get(`/admin/resellers/${r._id}/ledger`);
      setLedgerRows(res.data?.data?.rows || []);
      setLedgerTotal(res.data?.data?.total || 0);
    } catch {
      toast(t('resellers.ledgerError'), 'error');
    } finally {
      setLedgerLoading(false);
    }
  }

  async function handleReturnCredit() {
    if (!ledgerReseller) return;
    setReturning(true);
    try {
      const res = await api.post(`/admin/resellers/${ledgerReseller._id}/credit/return`, {});
      const n = res.data?.data?.revoked ?? 0;
      toast(n > 0 ? `${t('resellers.returnSuccess')} (${n})` : t('resellers.returnNone'), n > 0 ? 'success' : 'info');
      await openLedger(ledgerReseller);
      fetchResellers();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || t('resellers.returnError'), 'error');
    } finally {
      setReturning(false);
    }
  }

  function ledgerTypeLabel(type: string) {
    const map: Record<string, string> = {
      GRANT: t('resellers.txGrant'),
      CONSUME: t('resellers.txConsume'),
      RETURN: t('resellers.txReturn'),
      EXPIRE_RETURN: t('resellers.txExpireReturn'),
    };
    return map[type] || type;
  }

  const columns: DataTableColumn<ResellerData>[] = [
    {
      key: 'name',
      header: t('resellers.name'),
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{r.name}</div>
          {r.notes && <div className="text-xs text-muted-foreground truncate">{r.notes}</div>}
        </div>
      ),
    },
    {
      key: 'city',
      header: t('resellers.city'),
      cell: (r) => <span>{r.city || '—'}</span>,
    },
    {
      key: 'phone',
      header: t('resellers.phone'),
      cell: (r) =>
        r.phone ? (
          <span className="text-sm" dir="ltr">
            {r.phone}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'status',
      header: t('resellers.status'),
      cell: (r) =>
        r.status === 'Active' ? (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {t('resellers.active')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted" />
            {t('resellers.inactive')}
          </span>
        ),
    },
    {
      key: 'stats',
      header: t('resellers.stats'),
      cell: (r) => {
        const stats = r.stats || { total: 0, activated: 0, remaining: 0 };
        return (
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {stats.activated} / {stats.total}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {stats.remaining} {t('resellers.remaining')}
            </div>
          </div>
        );
      },
    },
    {
      key: 'credit',
      header: t('resellers.credit'),
      cell: (r) => {
        const credit = (r.credit || []).filter((c) => (Number(c.quantity) || 0) > 0);
        const totalQty = credit.reduce((s, c) => s + (Number(c.quantity) || 0), 0);
        if (totalQty === 0) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="min-w-0 max-w-[11rem]">
            {credit.map((c) => {
              const plan = plans.find((p) => p._id === String(c.planId));
              return (
                <div key={String(c.planId)} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">{plan?.name || '—'}</span>
                  <span className="font-medium tabular-nums">{c.quantity}</span>
                </div>
              );
            })}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEdit(r);
            }}
            className="p-1.5 text-muted-foreground hover:text-foreground"
            title={t('resellers.edit')}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openLedger(r);
            }}
            className="p-1.5 text-muted-foreground hover:text-primary"
            title={t('resellers.ledger')}
          >
            <History className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(r);
            }}
            className="p-1.5 text-muted-foreground hover:text-destructive"
            title={t('common.delete')}
          >
            <Trash2 className="h-4 w-4" />
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
            {t('resellers.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {resellers.length} {t('resellers.count')}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          {t('resellers.add')}
        </button>
      </div>

      {error && (
        <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={resellers}
        gridTemplate="minmax(180px,1.6fr) 120px 130px 100px 140px 110px"
        ariaLabel={t('resellers.title')}
        emptyMessage={t('resellers.empty')}
        rowKey={(r) => r._id}
      />

      {/* Create / edit modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? t('resellers.edit') : t('resellers.add')}
      >
        <div className="p-5 space-y-4">
          {formError && (
            <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('resellers.name')} *
            </label>
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('resellers.namePlaceholder')}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {t('resellers.city')}
              </label>
              <input
                className={inputClass}
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {t('resellers.phone')}
              </label>
              <input
                className={inputClass}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('resellers.notes')}
            </label>
            <textarea
              className={`${inputClass} h-auto py-2`}
              value={form.notes}
              maxLength={500}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder={t('resellers.notesPlaceholder')}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('resellers.status')}
            </label>
            <select
              className={inputClass}
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as 'Active' | 'Inactive' })
              }
            >
              <option value="Active">{t('resellers.active')}</option>
              <option value="Inactive">{t('resellers.inactive')}</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {t('resellers.username')}
              </label>
              <input
                className={inputClass}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="username"
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {t('resellers.password')}
              </label>
              <input
                type="password"
                className={inputClass}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={form.username ? '••••••' : ''}
                dir="ltr"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('resellers.wholesalePrices')}
            </label>
            <div className="space-y-2 border border-border p-3">
              {plans.length === 0 && (
                <div className="text-xs text-muted-foreground">{t('resellers.noPlans')}</div>
              )}
              {plans.map((plan) => {
                const entry = form.prices.find((p) => p.planId === plan._id);
                return (
                  <div key={plan._id} className="flex items-center gap-2">
                    <span className="flex-1 text-sm">
                      {plan.name} <span className="text-muted-foreground text-xs">({plan.durationDays} يوم)</span>
                    </span>
                    <input
                      type="number"
                      min={0}
                      className={`${inputClass} w-28`}
                      placeholder="0"
                      value={entry?.price ?? ''}
                      onChange={(e) => {
                        const others = form.prices.filter((p) => p.planId !== plan._id);
                        setForm({
                          ...form,
                          prices: e.target.value === '' ? others : [...others, { planId: plan._id, price: e.target.value }],
                        });
                      }}
                    />
                    <span className="text-xs text-muted-foreground w-8">دج</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('resellers.credit')}
            </label>
            <p className="text-xs text-muted-foreground">{t('resellers.creditHint')}</p>
            <div className="space-y-2 border border-border p-3">
              {plans.length === 0 && (
                <div className="text-xs text-muted-foreground">{t('resellers.noPlans')}</div>
              )}
              {plans.map((plan) => {
                const entry = form.credit.find((c) => c.planId === plan._id);
                return (
                  <div key={plan._id} className="flex items-center gap-2">
                    <span className="flex-1 text-sm">
                      {plan.name} <span className="text-muted-foreground text-xs">({plan.durationDays} يوم)</span>
                    </span>
                    <input
                      type="number"
                      min={0}
                      className={`${inputClass} w-28`}
                      placeholder="0"
                      value={entry?.quantity ?? ''}
                      onChange={(e) => {
                        const others = form.credit.filter((c) => c.planId !== plan._id);
                        setForm({
                          ...form,
                          credit:
                            e.target.value === ''
                              ? others
                              : [...others, { planId: plan._id, quantity: e.target.value }],
                        });
                      }}
                    />
                    <span className="text-xs text-muted-foreground w-8">كود</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
              className="inline-flex items-center px-6 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {saving ? t('common.saving') : t('common.save')}
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

      <Modal
        open={!!ledgerReseller}
        onClose={() => setLedgerReseller(null)}
        title={`${t('resellers.ledger')} — ${ledgerReseller?.name ?? ''}`}
      >
        <div className="p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {t('resellers.ledgerHint')} · {ledgerTotal} {t('resellers.txCount')}
            </p>
            <button
              onClick={handleReturnCredit}
              disabled={returning}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${returning ? 'animate-spin' : ''}`} />
              {t('resellers.returnUnused')}
            </button>
          </div>
          {ledgerLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : ledgerRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('resellers.ledgerEmpty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-right text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">التاريخ</th>
                    <th className="px-3 py-2 font-medium">{t('resellers.txType')}</th>
                    <th className="px-3 py-2 font-medium">{t('resellers.txPlan')}</th>
                    <th className="px-3 py-2 font-medium">{t('resellers.txQty')}</th>
                    <th className="px-3 py-2 font-medium">{t('resellers.txBalance')}</th>
                    <th className="px-3 py-2 font-medium">{t('resellers.txNote')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((row) => (
                    <tr key={row._id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(row.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            row.type === 'CONSUME'
                              ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                              : row.type === 'GRANT'
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {ledgerTypeLabel(row.type)}
                        </span>
                      </td>
                      <td className="px-3 py-2">{row.planName}</td>
                      <td className={`px-3 py-2 font-medium tabular-nums ${row.quantity < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                      </td>
                      <td className="px-3 py-2 font-medium tabular-nums">{row.balanceAfter}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{row.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('resellers.deleteTitle')}
        message={`${t('resellers.deleteConfirm')} (${deleteTarget?.name ?? ''})`}
        confirmLabel={t('common.delete')}
        variant="destructive"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
