'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, History, RotateCcw, HandCoins, MessageCircle, CheckCheck, AlertTriangle, QrCode } from 'lucide-react';
import ShopQrCard from '@/components/shop-qr-card';
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
  prefix?: string;
  stats?: { total: number; activated: number; remaining: number };
  purchasedValue?: number;
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
  prefix: string;
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
  prefix: '',
};

interface CreditDebtItem {
  _id: string;
  resellerId: string;
  resellerName: string;
  resellerPhone: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  note: string;
  autoFromGrant: boolean;
  paidAt?: string | null;
  createdAt?: string | null;
}

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
  const [qrTarget, setQrTarget] = useState<ResellerData | null>(null);
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
   setCreditPaid(false);
  }


  function openEdit(r: ResellerData) {
    setEditingId(r._id);
    const existing = (r.prices || []).map((p) => ({ planId: String(p.planId), price: String(p.price) }));
    const existingCredit = (r.credit || []).map((c) => ({ planId: String(c.planId), quantity: String(c.quantity) }));
    setCreditPaid(false);
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
      prefix: r.prefix || '',
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
        prefix: form.prefix.trim() ? form.prefix.trim().toUpperCase() : undefined,
        creditPaid,
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
      fetchDebts();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setFormError(axiosErr.response?.data?.error || t('resellers.saveError'));
    } finally {
      setSaving(false);
    }
  }

  // Reseller credit debts (ديون المحلات عليهم)
  const [debts, setDebts] = useState<CreditDebtItem[]>([]);
  const [debtsSummary, setDebtsSummary] = useState({ outstanding: 0, unpaidCount: 0 });
  const [settlingDebtId, setSettlingDebtId] = useState<string | null>(null);
  const [deletingDebtId, setDeletingDebtId] = useState<string | null>(null);
  const [debtFormOpen, setDebtFormOpen] = useState(false);
  const [debtForm, setDebtForm] = useState({ resellerId: '', amount: '', note: '' });
  const [savingDebt, setSavingDebt] = useState(false);
  const [creditPaid, setCreditPaid] = useState(false);

  // ─── Reseller credit debts (ديون المحلات عليهم) ───────────
  const fetchDebts = useCallback(async () => {
    try {
      const res = await api.get('/admin/reseller-debts');
      setDebts(res.data?.data || []);
      setDebtsSummary(res.data?.summary || { outstanding: 0, unpaidCount: 0 });
    } catch {
      // secondary — ignore
    }
  }, []);

  useEffect(() => {
    fetchDebts();
  }, [fetchDebts]);

  async function handleAddDebt(e: React.FormEvent) {
    e.preventDefault();
    if (!debtForm.resellerId) {
      toast(t('resellers.debtSelectReseller'), 'error');
      return;
    }
    if (debtForm.amount === '' || Number(debtForm.amount) < 0 || !Number.isFinite(Number(debtForm.amount))) {
      toast(t('resellers.debtAmount') + ' *', 'error');
      return;
    }
    setSavingDebt(true);
    try {
      await api.post('/admin/reseller-debts', {
        resellerId: debtForm.resellerId,
        amount: Number(debtForm.amount),
        note: debtForm.note.trim(),
      });
      toast(t('resellers.debtCreated'), 'success');
      setDebtFormOpen(false);
      setDebtForm({ resellerId: '', amount: '', note: '' });
      await fetchDebts();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || t('resellers.saveError'), 'error');
    } finally {
      setSavingDebt(false);
    }
  }

  async function handleSettleDebt(d: CreditDebtItem) {
    if (!window.confirm(t('resellers.debtSettleConfirm').replace('{name}', d.resellerName))) return;
    setSettlingDebtId(d._id);
    try {
      await api.patch(`/admin/reseller-debts/${d._id}`, { status: 'PAID' });
      toast(t('resellers.debtSettled'), 'success');
      await fetchDebts();
    } catch {
      toast(t('resellers.saveError'), 'error');
    } finally {
      setSettlingDebtId(null);
    }
  }

  async function handleDeleteDebt(d: CreditDebtItem) {
    if (!window.confirm(t('resellers.debtDeleteConfirm').replace('{name}', d.resellerName))) return;
    setDeletingDebtId(d._id);
    try {
      await api.delete(`/admin/reseller-debts/${d._id}`);
      toast(t('resellers.debtDeleted'), 'success');
      await fetchDebts();
    } catch {
      toast(t('resellers.saveError'), 'error');
    } finally {
      setDeletingDebtId(null);
    }
  }

  function debtWaLink(d: CreditDebtItem): string | null {
    const phone = d.resellerPhone.replace(/\D/g, '');
    if (!phone) return null;
    const msg = t('resellers.debtWaMsg')
      .replace('{name}', d.resellerName)
      .replace('{amount}', String(Math.round(d.remaining)));
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  }

  function debtDaysAgo(iso?: string | null): number | null {
    if (!iso) return null;
    return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  }

  const sortedDebts = useMemo(() => {
    const priority: Record<CreditDebtItem['status'], number> = { UNPAID: 0, PARTIAL: 1, PAID: 2 };
    return [...debts].sort((a, b) => {
      const p = priority[a.status] - priority[b.status];
      if (p !== 0) return p;
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return a.status === 'PAID' ? tb - ta : ta - tb;
    });
  }, [debts]);

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
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{r.name}</span>
            {r.prefix && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary" dir="ltr">
                {r.prefix}
              </span>
            )}
          </div>
          {r.notes && <div className="text-xs text-muted-foreground truncate">{r.notes}</div>}
        </div>
      ),
    },
    {
      key: 'city',
      mobileHidden: true,
      header: t('resellers.city'),
      cell: (r) => <span>{r.city || '—'}</span>,
    },
    {
      key: 'phone',
      mobileHidden: true,
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
      key: 'purchasedValue',
      header: t('resellers.purchasedValue'),
      cell: (r) => (
        <span className="tabular-nums whitespace-nowrap" dir="ltr">
          {(r.purchasedValue || 0).toLocaleString()} <span className="text-xs text-muted-foreground">دج</span>
        </span>
      ),
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
              setQrTarget(r);
            }}
            className="p-1.5 text-muted-foreground hover:text-primary"
            title="بطاقة QR للمحل"
          >
            <QrCode className="h-4 w-4" />
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

      {/* Reseller credit debts (ديون المحلات عليهم) */}
      <div className="border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 bg-muted/50">
          <h2 className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            <HandCoins className="h-4 w-4" /> {t('resellers.debtsTitle')}
          </h2>
          <button
            onClick={() => setDebtFormOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-primary/40 text-primary hover:bg-primary/5 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> {t('resellers.addDebt')}
          </button>
        </div>
        <div className="p-4">
          {debtsSummary.unpaidCount > 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400 mb-3">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {t('resellers.debtsSummary')
                .replace('{count}', String(debtsSummary.unpaidCount))
                .replace('{total}', Number(debtsSummary.outstanding).toLocaleString())}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400 mb-3">
              <CheckCheck className="h-4 w-4 shrink-0" />
              {t('resellers.debtsAllSettled')}
            </div>
          )}
          {sortedDebts.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t('resellers.debtsEmpty')}</div>
          ) : (
            <div className="space-y-2">
              {sortedDebts.map((d) => {
                const days = debtDaysAgo(d.createdAt);
                const wa = debtWaLink(d);
                return (
                  <div key={d._id} className={`border p-3 ${d.status !== 'PAID' && days !== null && days >= 14 ? 'border-red-400/50 bg-red-500/5' : 'border-border'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{d.resellerName}</span>
                          {d.status === 'UNPAID' && (
                            <span className="inline-flex px-2 py-0.5 text-[11px] font-medium bg-red-500/15 text-red-600 dark:text-red-400">{t('resellers.debtUnpaid')}</span>
                          )}
                          {d.status === 'PARTIAL' && (
                            <span className="inline-flex px-2 py-0.5 text-[11px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400">{t('resellers.debtPartial')}</span>
                          )}
                          {d.status === 'PAID' && (
                            <span className="inline-flex px-2 py-0.5 text-[11px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">{t('resellers.debtPaid')}</span>
                          )}
                          {d.status !== 'PAID' && days !== null && days >= 14 && (
                            <span className="inline-flex px-2 py-0.5 text-[11px] font-medium bg-red-600/20 text-red-700 dark:text-red-300">{t('resellers.debtOld')}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          {d.resellerPhone && <span dir="ltr">{d.resellerPhone}</span>}
                          {days !== null && (
                            <span>{days === 0 ? t('resellers.debtToday') : t('resellers.debtDaysAgo').replace('{days}', String(days))}</span>
                          )}
                          {d.autoFromGrant && <span className="text-[11px] text-primary/70">↳ {t('resellers.debtAuto')}</span>}
                        </div>
                        {d.note && <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-2">{d.note}</p>}
                      </div>
                      <div className="text-left shrink-0">
                        <div className="text-lg font-semibold tabular-nums" dir="ltr">
                          {Number(d.remaining).toLocaleString()} <span className="text-xs font-normal text-muted-foreground">دج</span>
                        </div>
                        {d.status === 'PARTIAL' && (
                          <div className="text-[11px] text-muted-foreground line-through tabular-nums" dir="ltr">
                            {Number(d.amount).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {wa && (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/5 transition-colors"
                        >
                          <MessageCircle className="h-3.5 w-3.5" /> {t('resellers.whatsappRemind')}
                        </a>
                      )}
                      {d.status !== 'PAID' && (
                        <button
                          onClick={() => handleSettleDebt(d)}
                          disabled={settlingDebtId === d._id}
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-signal-green/40 text-signal-green hover:bg-signal-green/5 disabled:opacity-50 transition-colors"
                        >
                          {settlingDebtId === d._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                          {t('resellers.settleDebt')}
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteDebt(d)}
                        disabled={deletingDebtId === d._id}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-destructive/40 text-destructive hover:bg-destructive/5 disabled:opacity-50 transition-colors"
                      >
                        {deletingDebtId === d._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

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
                {t('resellers.prefix')}
              </label>
              <input
                className={inputClass}
                value={form.prefix}
                onChange={(e) => setForm({ ...form, prefix: e.target.value.toUpperCase() })}
                placeholder="ALG1"
                maxLength={6}
                dir="ltr"
              />
              <p className="text-[11px] text-muted-foreground">{t('resellers.prefixHint')}</p>
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
            <label className="flex items-center gap-2 mt-2 text-xs cursor-pointer select-none border border-border p-3 bg-muted/40">
              <input
                type="checkbox"
                checked={creditPaid}
                onChange={(e) => setCreditPaid(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span>
                {t('resellers.creditPaid')}
                <span className="block text-[11px] text-muted-foreground mt-0.5">
                  {t('resellers.creditPaidHint')}
                </span>
              </span>
            </label>
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

      {/* Add reseller debt modal */}
      <Modal open={debtFormOpen} onClose={() => setDebtFormOpen(false)} title={t('resellers.addDebt')}>
        <form onSubmit={handleAddDebt} className="space-y-3 p-5">
          <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
            {t('resellers.debtReseller')} *
            <select
              className={inputClass}
              value={debtForm.resellerId}
              onChange={(e) => setDebtForm({ ...debtForm, resellerId: e.target.value })}
            >
              <option value="">—</option>
              {resellers.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name} {r.city ? `— ${r.city}` : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {t('resellers.debtAmount')} *
              <input
                type="number"
                min={0}
                className={inputClass}
                value={debtForm.amount}
                onChange={(e) => setDebtForm({ ...debtForm, amount: e.target.value })}
                dir="ltr"
              />
            </label>
            <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {t('resellers.debtNote')}
              <input
                className={inputClass}
                value={debtForm.note}
                onChange={(e) => setDebtForm({ ...debtForm, note: e.target.value })}
                maxLength={200}
              />
            </label>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={savingDebt}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {savingDebt ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}
              {t('resellers.saveDebt')}
            </button>
            <button
              type="button"
              onClick={() => setDebtFormOpen(false)}
              className="h-10 px-4 text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              {'إلغاء'}
            </button>
          </div>
        </form>
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
      {qrTarget && (
        <ShopQrCard
          reseller={{ _id: qrTarget._id, name: qrTarget.name, phone: qrTarget.phone }}
          open
          onClose={() => setQrTarget(null)}
        />
      )}
    </div>
  );
}
