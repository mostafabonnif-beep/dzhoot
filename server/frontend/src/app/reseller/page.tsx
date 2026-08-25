'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  Store,
  Package,
  KeyRound,
  Download,
  Copy,
  Check,
  LogOut,
  Wand2,
  Minus,
  Plus,
  BadgeCheck,
  History,
  AlertTriangle,
  HandCoins,
  MessageCircle,
  Trash2,
  CheckCheck,
} from 'lucide-react';
import api, { decodeTokenRole } from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';
import { useToast } from '@/hooks/use-toast';
import Modal from '@/components/ui/modal';
import { useLocale } from '@/components/locale-provider';

interface CreditItem {
  planId: string;
  quantity: number;
  plan: { name: string; durationDays: number; allowCustomDuration?: boolean };
}

interface BatchItem {
  _id: string;
  batchNumber: number;
  plan: { name: string; durationDays: number } | null;
  receiptDate: string;
  notes?: string;
  stats: { total: number; activated: number; remaining: number; revoked: number };
}

interface CodeItem {
  _id: string;
  code: string;
  status: 'UNUSED' | 'ACTIVATED' | 'REVOKED' | 'EXPIRED';
  activatedAt?: string | null;
  subscriptionStartsAt?: string | null;
  subscriptionExpiresAt?: string | null;
}

interface DebtItem {
  _id: string;
  customerName: string;
  customerPhone: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  quantity: number | null;
  planName: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  note: string;
  paidAt?: string | null;
  createdAt?: string | null;
}

const inputClass =
  'flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary';

function statusBadge(status: CodeItem['status']) {
  const map: Record<CodeItem['status'], string> = {
    UNUSED: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    ACTIVATED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    REVOKED: 'bg-destructive/15 text-destructive',
    EXPIRED: 'bg-muted text-muted-foreground',
  };
  const label: Record<CodeItem['status'], string> = {
    UNUSED: 'غير مستخدم',
    ACTIVATED: 'مُفعّل',
    REVOKED: 'ملغي',
    EXPIRED: 'منتهي',
  };
  return <span className={`inline-flex px-2 py-0.5 text-xs font-medium ${map[status]}`}>{label[status]}</span>;
}

export default function ResellerDashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useLocale();
  const logout = useAuthStore((s) => s.logout);
  const accessToken = useAuthStore((s) => s.accessToken);
  // Wait for zustand persist to rehydrate from localStorage BEFORE deciding
  // whether to redirect — otherwise a reseller with a valid saved token gets
  // kicked to /reseller/login on every page refresh (mobile browsers reload
  // constantly). Same pattern as hooks/use-auth.ts useRequireAuth.
  const [hydrated, setHydrated] = useState(false);
  const [me, setMe] = useState<{
    name: string;
    city: string;
    prefix?: string;
    stats: { total: number; activated: number; activatedThisMonth: number; remaining: number };
    credit: CreditItem[];
    prices?: Array<{ planId: string; price: number; currency: string; plan: { name: string; durationDays: number } }>;
    account?: { purchasedQty: number; purchasedValue: number; consumedQty: number; returnedQty: number; netQty: number };
    expiringSoon?: number;
  } | null>(null);
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openBatch, setOpenBatch] = useState<BatchItem | null>(null);
  const [codes, setCodes] = useState<CodeItem[]>([]);
  const [codesLoading, setCodesLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  // Ledger (سجل حركات الرصيد)
  const [ledger, setLedger] = useState<Array<{ _id: string; type: string; quantity: number; balanceAfter: number; planName: string; note: string; createdAt: string }>>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Change password
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '' });
  const [pwSaving, setPwSaving] = useState(false);

  // Batch search
  const [batchSearch, setBatchSearch] = useState('');
  const filteredBatches = batchSearch.trim()
    ? batches.filter((b) => String(b.batchNumber).includes(batchSearch.trim()) || (b.plan?.name || '').toLowerCase().includes(batchSearch.trim().toLowerCase()))
    : batches;

  // Generation state
  const [genPlanId, setGenPlanId] = useState('');
  const [genQty, setGenQty] = useState(1);
  const [genCustomerName, setGenCustomerName] = useState('');
  const [genCustomerPhone, setGenCustomerPhone] = useState('');
  const [genCustomDays, setGenCustomDays] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<{ batchNumber: number; planName: string; codes: string[] } | null>(null);
  const [genCopied, setGenCopied] = useState(false);

  // Statement (كشف حساب)
  const [statement, setStatement] = useState<{
    summary: { granted: number; consumed: number; returned: number; purchaseValue: number; netCodes: number };
    rows: Array<{ _id: string; type: string; quantity: number; unitPrice: number; amount: number; balanceAfter: number; planName: string; note: string; createdAt: string }>;
    total: number;
  } | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);

  // Customer debts (ديون الزبائن)
  const [debts, setDebts] = useState<DebtItem[]>([]);
  const [debtsLoading, setDebtsLoading] = useState(false);
  const [debtsSummary, setDebtsSummary] = useState({ outstanding: 0, unpaidCount: 0 });
  const [showDebtForm, setShowDebtForm] = useState(false);
  const [debtForm, setDebtForm] = useState({
    customerName: '',
    customerPhone: '',
    amount: '',
    quantity: '',
    planName: '',
    note: '',
  });
  const [savingDebt, setSavingDebt] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [deletingDebtId, setDeletingDebtId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [meRes, batchRes] = await Promise.all([
        api.get('/reseller/me'),
        api.get('/reseller/batches'),
      ]);
      setMe(meRes.data?.data || null);
      setBatches(batchRes.data?.data || []);
      setError('');
    } catch {
      setError(t('portal.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadStatement = useCallback(async () => {
    setStatementLoading(true);
    try {
      const res = await api.get('/reseller/statement');
      setStatement(res.data?.data || null);
    } catch {
      // statement is secondary — ignore failures
    } finally {
      setStatementLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hydrated) return;
    let active = true;
    const finish = () => {
      if (active) setHydrated(true);
    };
    const persistApi = useAuthStore.persist;
    const unsub = persistApi?.onFinishHydration?.(finish);
    if (persistApi?.hasHydrated?.()) {
      finish();
    } else if (persistApi?.rehydrate) {
      void Promise.resolve(persistApi.rehydrate()).then(finish, finish);
    } else {
      finish();
    }
    return () => {
      active = false;
      unsub?.();
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    // The portal shares localStorage with the admin panel. Only a JWT with
    // role 'reseller' may render this dashboard — a user/admin token would
    // otherwise produce a permanently broken page.
    if (!accessToken || decodeTokenRole(accessToken) !== 'reseller') {
      router.replace('/reseller/login');
      return;
    }
    load();
    loadLedger();
    loadDebts();
    loadStatement();
  }, [hydrated, accessToken, router, load, loadStatement]);

  async function loadLedger() {
    setLedgerLoading(true);
    try {
      const res = await api.get('/reseller/ledger');
      setLedger(res.data?.data?.rows || []);
    } catch {
      // ledger is secondary — ignore failures
    } finally {
      setLedgerLoading(false);
    }
  }

  async function loadDebts() {
    setDebtsLoading(true);
    try {
      const res = await api.get('/reseller/debts');
      setDebts(res.data?.data || []);
      setDebtsSummary(res.data?.summary || { outstanding: 0, unpaidCount: 0 });
    } catch {
      // debts are secondary — ignore failures
    } finally {
      setDebtsLoading(false);
    }
  }

  async function handleAddDebt(e: React.FormEvent) {
    e.preventDefault();
    if (!debtForm.customerName.trim()) {
      toast(t('portal.customerName') + ' *', 'error');
      return;
    }
    if (debtForm.amount === '' || Number(debtForm.amount) < 0 || !Number.isFinite(Number(debtForm.amount))) {
      toast(t('portal.debtAmount') + ' *', 'error');
      return;
    }
    setSavingDebt(true);
    try {
      await api.post('/reseller/debts', {
        customerName: debtForm.customerName.trim(),
        customerPhone: debtForm.customerPhone.trim(),
        amount: Number(debtForm.amount),
        quantity: debtForm.quantity ? Number(debtForm.quantity) : undefined,
        planName: debtForm.planName.trim(),
        note: debtForm.note.trim(),
      });
      toast(t('portal.debtCreated'), 'success');
      setShowDebtForm(false);
      setDebtForm({ customerName: '', customerPhone: '', amount: '', quantity: '', planName: '', note: '' });
      await loadDebts();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || t('portal.loadError'), 'error');
    } finally {
      setSavingDebt(false);
    }
  }

  async function handleSettleDebt(d: DebtItem) {
    if (!window.confirm(t('portal.settleConfirm').replace('{name}', d.customerName))) return;
    setSettlingId(d._id);
    try {
      await api.patch(`/reseller/debts/${d._id}`, { status: 'PAID' });
      toast(t('portal.debtSettled'), 'success');
      await loadDebts();
    } catch {
      toast(t('portal.loadError'), 'error');
    } finally {
      setSettlingId(null);
    }
  }

  async function handleDeleteDebt(d: DebtItem) {
    if (!window.confirm(t('portal.confirmDeleteDebt').replace('{name}', d.customerName))) return;
    setDeletingDebtId(d._id);
    try {
      await api.delete(`/reseller/debts/${d._id}`);
      toast(t('portal.debtDeleted'), 'success');
      await loadDebts();
    } catch {
      toast(t('portal.loadError'), 'error');
    } finally {
      setDeletingDebtId(null);
    }
  }

  function waLink(d: DebtItem): string | null {
    const phone = d.customerPhone.replace(/\D/g, '');
    if (!phone) return null;
    const msg = t('portal.waReminderMsg')
      .replace('{name}', d.customerName)
      .replace('{amount}', String(Math.round(d.remaining)));
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  }

  function daysAgo(iso?: string | null): number | null {
    if (!iso) return null;
    return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  }

  const debtStatusLabel: Record<DebtItem['status'], string> = {
    UNPAID: t('portal.debtUnpaid'),
    PARTIAL: t('portal.debtPartial'),
    PAID: t('portal.debtPaid'),
  };

  // Sort: unpaid (oldest first — the forgotten ones surface), then partial, then paid (newest first)
  const sortedDebts = useMemo(() => {
    const priority: Record<DebtItem['status'], number> = { UNPAID: 0, PARTIAL: 1, PAID: 2 };
    return [...debts].sort((a, b) => {
      const p = priority[a.status] - priority[b.status];
      if (p !== 0) return p;
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return a.status === 'PAID' ? tb - ta : ta - tb;
    });
  }, [debts]);

  async function handleChangePassword() {
    if (!pwForm.currentPassword || !pwForm.newPassword) {
      toast(t('portal.pwRequired'), 'error');
      return;
    }
    if (pwForm.newPassword.length < 6) {
      toast(t('portal.pwMin'), 'error');
      return;
    }
    setPwSaving(true);
    try {
      await api.post('/reseller/auth/change-password', pwForm);
      toast(t('portal.pwChanged'), 'success');
      setPwForm({ currentPassword: '', newPassword: '' });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || t('portal.pwError'), 'error');
    } finally {
      setPwSaving(false);
    }
  }

  function ledgerTypeLabel(type: string) {
    const map: Record<string, string> = {
      GRANT: t('portal.txGrant'),
      CONSUME: t('portal.txConsume'),
      RETURN: t('portal.txReturn'),
      EXPIRE_RETURN: t('portal.txExpireReturn'),
    };
    return map[type] || type;
  }

  async function openCodes(batch: BatchItem) {
    setOpenBatch(batch);
    setCodes([]);
    setCodesLoading(true);
    try {
      const res = await api.get(`/reseller/batches/${batch._id}/codes`);
      setCodes(res.data?.data || []);
    } catch {
      setError(t('portal.loadError'));
    } finally {
      setCodesLoading(false);
    }
  }

  function copyAll() {
    navigator.clipboard.writeText(codes.map((c) => c.code).join('\n')).then(() => {
      setCopied(true);
      toast(t('portal.copied'), 'success');
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function copyOne(code: string, id: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCodeId(id);
      toast(t('portal.copied'), 'success');
      setTimeout(() => setCopiedCodeId(null), 1500);
    });
  }

  function copyGenerated() {
    if (!genResult) return;
    navigator.clipboard.writeText(genResult.codes.join('\n')).then(() => {
      setGenCopied(true);
      toast(t('portal.copied'), 'success');
      setTimeout(() => setGenCopied(false), 2000);
    });
  }

  async function generateCodes() {
    if (!genPlanId || genQty < 1) return;
    setGenerating(true);
    try {
      const res = await api.post('/reseller/codes/generate', {
        planId: genPlanId,
        quantity: genQty,
        customerName: genCustomerName.trim() || undefined,
        customerPhone: genCustomerPhone.trim() || undefined,
        customDays: genCustomDays.trim() ? Number(genCustomDays) : undefined,
      });
      const data = res.data?.data;
      setGenResult({
        batchNumber: data.batch.batchNumber,
        planName: data.batch.plan.name,
        codes: data.codes || [],
      });
      toast(t('portal.generatedSuccess'), 'success');
      setGenQty(1);
      setGenCustomerName('');
      setGenCustomerPhone('');
      setGenCustomDays('');
      load(); // refresh credit + batches
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || t('portal.loadError'), 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function downloadStatement() {
    try {
      const res = await api.get('/reseller/statement', { params: { format: 'csv' }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dzhoof-statement.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast(t('portal.loadError'), 'error');
    }
  }

  async function downloadBatch(batch: BatchItem) {
    try {
      const res = await api.get(`/reseller/batches/${batch._id}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dzhoof-batch-${batch.batchNumber}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast(t('portal.loadError'), 'error');
    }
  }

  function handleLogout() {
    logout();
    router.replace('/reseller/login');
  }

  if (loading || !hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const credit = me?.credit || [];

  return (
    <div className="flex h-screen supports-[height:100dvh]:h-dvh overflow-hidden bg-background" dir="rtl">
      <div className="flex flex-1 flex-col overflow-hidden">
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" />
            <span className="font-semibold">{t('portal.loginTitle')}</span>
          </div>
          <div className="flex items-center gap-3">
            {me && (
              <span className="text-sm text-muted-foreground">
                {me.name} {me.city ? `— ${me.city}` : ''}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" /> {t('portal.logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto w-full max-w-5xl mx-auto px-4 py-6 space-y-6">
        {error && <div className="text-sm text-destructive">{error}</div>}

        {/* Credit + self-service generation */}
        <section className="border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
            <BadgeCheck className="h-4 w-4" /> {t('portal.myCredit')}
          </h2>
          {credit.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t('portal.noCredit')}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {credit.map((c) => (
                <div key={c.planId} className="border border-border p-3 flex flex-col gap-2">
                  <div>
                    <div className="font-medium text-sm">{c.plan.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.plan.durationDays} {t('portal.days')}
                    </div>
                  </div>
                  <div className="text-2xl font-semibold">{c.quantity}</div>
                  <div className="text-xs text-muted-foreground">{t('portal.remainingCredit')}</div>
                  <button
                    onClick={() => {
                      setGenPlanId(c.planId);
                      setGenQty(1);
                      setGenResult(null);
                    }}
                    disabled={c.quantity < 1}
                    className="inline-flex items-center justify-center gap-1.5 text-xs px-2.5 py-1.5 border border-primary/40 text-primary hover:bg-primary/5 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <Wand2 className="h-3.5 w-3.5" /> {t('portal.generateCodes')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {me && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="border border-border bg-card p-4">
                <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t('portal.totalCodes')}</div>
                <div className="text-2xl font-semibold mt-1">{me.stats.total}</div>
              </div>
              <div className="border border-border bg-card p-4">
                <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t('portal.activated')}</div>
                <div className="text-2xl font-semibold mt-1 text-emerald-600 dark:text-emerald-400">{me.stats.activated}</div>
              </div>
              <div className="border border-border bg-card p-4">
                <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t('portal.monthActivations')}</div>
                <div className="text-2xl font-semibold mt-1 text-primary">{me.stats.activatedThisMonth ?? 0}</div>
              </div>
              <div className="border border-border bg-card p-4">
                <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t('portal.remainingCredit')}</div>
                <div className="text-2xl font-semibold mt-1 text-sky-600 dark:text-sky-400">{me.stats.remaining}</div>
              </div>
            </div>

            {typeof me.expiringSoon === 'number' && me.expiringSoon > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {t('portal.expiringSoon').replace('{count}', String(me.expiringSoon))}
              </div>
            )}

            {me.account && (
              <div className="border border-border bg-card p-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
                  <Store className="h-4 w-4" /> {t('portal.myAccount')}
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">{t('portal.purchasedQty')}</div>
                    <div className="text-lg font-semibold mt-0.5">{me.account.purchasedQty}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('portal.purchasedValue')}</div>
                    <div className="text-lg font-semibold mt-0.5" dir="ltr">{me.account.purchasedValue.toLocaleString()} DZD</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('portal.consumedQty')}</div>
                    <div className="text-lg font-semibold mt-0.5 text-sky-600 dark:text-sky-400">{me.account.consumedQty}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('portal.netQty')}</div>
                    <div className="text-lg font-semibold mt-0.5 text-emerald-600 dark:text-emerald-400">{me.account.netQty}</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {me?.prices && me.prices.length > 0 && (
          <section className="border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
              <Store className="h-4 w-4" /> {t('portal.wholesalePrices')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {me.prices.map((p) => (
                <div key={p.planId} className="border border-border p-3">
                  <div className="font-medium text-sm">{p.plan.name}</div>
                  <div className="text-xs text-muted-foreground mb-2">{p.plan.durationDays} {t('portal.days')}</div>
                  <div className="text-xl font-semibold">
                    {Number(p.price || 0).toLocaleString()} <span className="text-sm text-muted-foreground">{p.currency}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
            <History className="h-4 w-4" /> {t('portal.myLedger')}
          </h2>
          {ledgerLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : ledger.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t('portal.ledgerEmpty')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-[0.15em] text-muted-foreground">
                    <th className="text-right p-2">{t('portal.ledgerDate')}</th>
                    <th className="text-right p-2">{t('portal.ledgerType')}</th>
                    <th className="text-right p-2">{t('portal.ledgerPlan')}</th>
                    <th className="text-right p-2">{t('portal.ledgerQty')}</th>
                    <th className="text-right p-2">{t('portal.ledgerBalance')}</th>
                    <th className="text-right p-2">{t('portal.ledgerNote')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((row) => (
                    <tr key={row._id} className="border-b border-border/50 last:border-0">
                      <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(row.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-2">
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
                      <td className="p-2">{row.planName}</td>
                      <td className={`p-2 font-medium tabular-nums ${row.quantity < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                      </td>
                      <td className="p-2 font-medium tabular-nums">{row.balanceAfter}</td>
                      <td className="p-2 text-xs text-muted-foreground">{row.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
            <HandCoins className="h-4 w-4" /> {t('portal.statement')}
          </h2>
          {statementLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : statement ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="border border-border p-3">
                  <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t('portal.statementGranted')}</div>
                  <div className="text-xl font-semibold mt-1 text-emerald-600 dark:text-emerald-400">{statement.summary.granted}</div>
                </div>
                <div className="border border-border p-3">
                  <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t('portal.statementConsumed')}</div>
                  <div className="text-xl font-semibold mt-1 text-sky-600 dark:text-sky-400">{statement.summary.consumed}</div>
                </div>
                <div className="border border-border p-3">
                  <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t('portal.statementReturned')}</div>
                  <div className="text-xl font-semibold mt-1 text-amber-600 dark:text-amber-400">{statement.summary.returned}</div>
                </div>
                <div className="border border-border p-3">
                  <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t('portal.statementValue')}</div>
                  <div className="text-xl font-semibold mt-1">{statement.summary.purchaseValue.toLocaleString()} DZD</div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {t('portal.statementCount')} {statement.total}
                </span>
                <button
                  onClick={downloadStatement}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border hover:bg-muted"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </button>
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-xs uppercase tracking-[0.15em] text-muted-foreground">
                      <th className="text-right p-2">{t('portal.ledgerDate')}</th>
                      <th className="text-right p-2">{t('portal.ledgerType')}</th>
                      <th className="text-right p-2">{t('portal.ledgerPlan')}</th>
                      <th className="text-right p-2">{t('portal.ledgerQty')}</th>
                      <th className="text-right p-2">{t('portal.statementAmount')}</th>
                      <th className="text-right p-2">{t('portal.ledgerBalance')}</th>
                      <th className="text-right p-2">{t('portal.ledgerNote')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.rows.map((row) => (
                      <tr key={row._id} className="border-b border-border/50 last:border-0">
                        <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(row.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="p-2">
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
                        <td className="p-2">{row.planName}</td>
                        <td className={`p-2 font-medium tabular-nums ${row.quantity < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          {row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                        </td>
                        <td className="p-2 font-medium tabular-nums">
                          {row.amount > 0 ? `${row.amount.toLocaleString()} DZD` : '—'}
                        </td>
                        <td className="p-2 font-medium tabular-nums">{row.balanceAfter}</td>
                        <td className="p-2 text-xs text-muted-foreground">{row.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">{t('portal.ledgerEmpty')}</div>
          )}
        </section>

        <section className="border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
            <KeyRound className="h-4 w-4" /> {t('portal.changePassword')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="password"
              className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm"
              placeholder={t('portal.currentPassword')}
              value={pwForm.currentPassword}
              onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
            />
            <input
              type="password"
              className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm"
              placeholder={t('portal.newPassword')}
              value={pwForm.newPassword}
              onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
            />
            <button
              onClick={handleChangePassword}
              disabled={pwSaving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pwSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {t('portal.savePassword')}
            </button>
          </div>
        </section>

        {/* Customer debts (ديون الزبائن) */}
        <section className="border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                <HandCoins className="h-4 w-4" /> {t('portal.debts')}
              </h2>
              <p className="text-xs text-muted-foreground/80 mt-1">{t('portal.debtsHint')}</p>
            </div>
            <button
              onClick={() => setShowDebtForm(true)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-2 border border-primary/40 text-primary hover:bg-primary/5 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> {t('portal.addDebt')}
            </button>
          </div>

          {debtsSummary.unpaidCount > 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400 mb-3">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {t('portal.debtsSummary')
                .replace('{count}', String(debtsSummary.unpaidCount))
                .replace('{total}', Number(debtsSummary.outstanding).toLocaleString())}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400 mb-3">
              <CheckCheck className="h-4 w-4 shrink-0" />
              {t('portal.debtsAllSettled')}
            </div>
          )}

          {debtsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : sortedDebts.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t('portal.debtEmpty')}</div>
          ) : (
            <div className="space-y-2">
              {sortedDebts.map((d) => {
                const days = daysAgo(d.createdAt);
                const isOld = d.status !== 'PAID' && days !== null && days >= 14;
                const wa = waLink(d);
                return (
                  <div
                    key={d._id}
                    className={`border p-3 ${isOld ? 'border-red-400/50 bg-red-500/5' : 'border-border'}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{d.customerName}</span>
                          {d.status === 'UNPAID' && (
                            <span className="inline-flex px-2 py-0.5 text-[11px] font-medium bg-red-500/15 text-red-600 dark:text-red-400">
                              {debtStatusLabel.UNPAID}
                            </span>
                          )}
                          {d.status === 'PARTIAL' && (
                            <span className="inline-flex px-2 py-0.5 text-[11px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400">
                              {debtStatusLabel.PARTIAL}
                            </span>
                          )}
                          {d.status === 'PAID' && (
                            <span className="inline-flex px-2 py-0.5 text-[11px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                              {debtStatusLabel.PAID}
                            </span>
                          )}
                          {isOld && (
                            <span className="inline-flex px-2 py-0.5 text-[11px] font-medium bg-red-600/20 text-red-700 dark:text-red-300">
                              {t('portal.debtOld')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          {d.customerPhone && (
                            <span dir="ltr">{d.customerPhone}</span>
                          )}
                          {d.planName && <span>{d.planName}</span>}
                          {d.quantity != null && (
                            <span>
                              {d.quantity} {t('portal.debtQty').split('(')[0].trim() || ''}
                            </span>
                          )}
                          {days !== null && (
                            <span>
                              {days === 0 ? t('portal.debtToday') : t('portal.debtDaysAgo').replace('{days}', String(days))}
                            </span>
                          )}
                        </div>
                        {d.note && <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-2">{d.note}</p>}
                      </div>
                      <div className="text-left shrink-0">
                        <div className="text-lg font-semibold tabular-nums" dir="ltr">
                          {Number(d.remaining).toLocaleString()} <span className="text-xs font-normal text-muted-foreground">DZD</span>
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
                          <MessageCircle className="h-3.5 w-3.5" />
                          {t('portal.whatsappRemind')}
                        </a>
                      )}
                      {d.status !== 'PAID' && (
                        <button
                          onClick={() => handleSettleDebt(d)}
                          disabled={settlingId === d._id}
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-signal-green/40 text-signal-green hover:bg-signal-green/5 disabled:opacity-50 transition-colors"
                        >
                          {settlingId === d._id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCheck className="h-3.5 w-3.5" />
                          )}
                          {t('portal.settleDebt')}
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteDebt(d)}
                        disabled={deletingDebtId === d._id}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-destructive/40 text-destructive hover:bg-destructive/5 disabled:opacity-50 transition-colors"
                      >
                        {deletingDebtId === d._id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
            <Package className="h-4 w-4" /> {t('portal.myBatches')}
          </h2>
          <input
            type="text"
            className="mb-3 flex h-10 w-full max-w-sm border border-border bg-card px-3 py-2 text-sm"
            placeholder={t('portal.searchBatches')}
            value={batchSearch}
            onChange={(e) => setBatchSearch(e.target.value)}
          />
          {batches.length === 0 ? (
            <div className="border border-dashed border-border p-8 text-center text-muted-foreground">
              {t('portal.noBatches')}
            </div>
          ) : (
            <div className="border border-border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-[0.15em] text-muted-foreground">
                    <th className="text-right p-3">{t('portal.batch')}</th>
                    <th className="text-right p-3">{t('portal.duration')}</th>
                    <th className="text-right p-3">{t('portal.receiptDate')}</th>
                    <th className="text-right p-3">{t('portal.activatedTotal')}</th>
                    <th className="text-right p-3">{t('portal.remainingCredit')}</th>
                    <th className="text-right p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBatches.map((b) => (
                    <tr key={b._id} className="border-b border-border/50 last:border-0">
                      <td className="p-3 font-medium">
                        {t('portal.batch')} {b.batchNumber}
                      </td>
                      <td className="p-3">
                        {b.plan ? `${b.plan.name} — ${b.plan.durationDays} ${t('portal.days')}` : '—'}
                      </td>
                      <td className="p-3" dir="ltr">{b.receiptDate?.slice(0, 10)}</td>
                      <td className="p-3">
                        <span className="text-emerald-600 dark:text-emerald-400">{b.stats.activated}</span>
                        {' / '}
                        {b.stats.total}
                      </td>
                      <td className="p-3 text-sky-600 dark:text-sky-400">{b.stats.remaining}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openCodes(b)}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border hover:bg-muted"
                          >
                            <KeyRound className="h-3.5 w-3.5" /> {t('portal.codes')}
                          </button>
                          <button
                            onClick={() => downloadBatch(b)}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border hover:bg-muted"
                          >
                            <Download className="h-3.5 w-3.5" /> {t('portal.file')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Batch codes modal */}
      <Modal open={!!openBatch} onClose={() => setOpenBatch(null)} title={openBatch ? `${t('portal.batch')} ${openBatch.batchNumber} — ${t('portal.codes')}` : ''}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {codes.filter((c) => c.status === 'ACTIVATED').length} {t('portal.activated')} {codes.length}
            </span>
            <button
              onClick={copyAll}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border hover:bg-muted"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {t('portal.copyAll')}
            </button>
          </div>
          {codesLoading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {codes.map((c) => (
                <div key={c._id} className="border border-border px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <code className="text-sm font-mono" dir="ltr">{c.code}</code>
                    <div className="flex items-center gap-2">
                      {statusBadge(c.status)}
                      <button
                        onClick={() => copyOne(c.code, c._id)}
                        className="p-1 text-muted-foreground hover:text-primary"
                        title={t('portal.copyCode')}
                      >
                        {copiedCodeId === c._id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  {c.status === 'ACTIVATED' && c.subscriptionExpiresAt && (
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>{t('portal.subStart')} <span dir="ltr">{new Date(c.subscriptionStartsAt || c.activatedAt || '').toLocaleDateString()}</span></span>
                      <span>{t('portal.subEnd')} <span dir="ltr">{new Date(c.subscriptionExpiresAt).toLocaleDateString()}</span></span>
                    </div>
                  )}
                </div>
              ))}
              {codes.length === 0 && !codesLoading && (
                <div className="text-center text-muted-foreground py-6">{t('portal.emptyCodes')}</div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Add debt modal */}
      <Modal open={showDebtForm} onClose={() => setShowDebtForm(false)} title={t('portal.addDebt')}>
        <form onSubmit={handleAddDebt} className="space-y-3">
          <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
            {t('portal.customerName')} *
            <input
              className={inputClass}
              value={debtForm.customerName}
              onChange={(e) => setDebtForm({ ...debtForm, customerName: e.target.value })}
              maxLength={100}
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {t('portal.customerPhone')}
              <input
                className={inputClass}
                value={debtForm.customerPhone}
                onChange={(e) => setDebtForm({ ...debtForm, customerPhone: e.target.value })}
                placeholder="05XXXXXXXX"
                dir="ltr"
                maxLength={30}
              />
            </label>
            <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {t('portal.debtAmount')} *
              <input
                type="number"
                min={0}
                className={inputClass}
                value={debtForm.amount}
                onChange={(e) => setDebtForm({ ...debtForm, amount: e.target.value })}
                dir="ltr"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {t('portal.debtQty')}
              <input
                type="number"
                min={1}
                className={inputClass}
                value={debtForm.quantity}
                onChange={(e) => setDebtForm({ ...debtForm, quantity: e.target.value })}
                dir="ltr"
              />
            </label>
            <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {t('portal.debtPlan')}
              <input
                className={inputClass}
                value={debtForm.planName}
                onChange={(e) => setDebtForm({ ...debtForm, planName: e.target.value })}
                maxLength={100}
              />
            </label>
          </div>
          <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
            {t('portal.debtNote')}
            <textarea
              rows={2}
              className="w-full px-3 py-2 border border-border bg-background text-sm focus-visible:outline-none focus-visible:border-primary"
              value={debtForm.note}
              onChange={(e) => setDebtForm({ ...debtForm, note: e.target.value })}
              maxLength={500}
            />
          </label>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={savingDebt}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {savingDebt ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}
              {t('portal.saveDebt')}
            </button>
            <button
              type="button"
              onClick={() => setShowDebtForm(false)}
              className="h-10 px-4 text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              {'إلغاء'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Generation modal */}
      <Modal
        open={!!genPlanId || !!genResult}
        onClose={() => {
          setGenPlanId('');
          setGenResult(null);
        }}
        title={genResult ? `${t('portal.newCodes')} — ${genResult.planName}` : t('portal.generateCodes')}
      >
        {genResult ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-400">
              <BadgeCheck className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                {t('portal.startsOnActivation')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t('portal.batch')} {genResult.batchNumber} — {genResult.codes.length}
              </span>
              <button
                onClick={copyGenerated}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border hover:bg-muted"
              >
                {genCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {t('portal.copyAll')}
              </button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {genResult.codes.map((code, i) => (
                <div key={i} className="border border-border px-3 py-2.5 text-center">
                  <code className="text-base font-mono font-semibold tracking-wide" dir="ltr">{code}</code>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">
              {(() => {
                const selected = me?.credit?.find((c) => c.planId === genPlanId);
                return selected ? `${selected.plan.name} — ${selected.plan.durationDays} ${t('portal.days')}` : '';
              })()}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
                {t('portal.customerName')}
                <input
                  className={inputClass}
                  value={genCustomerName}
                  onChange={(e) => setGenCustomerName(e.target.value)}
                  maxLength={100}
                />
              </label>
              <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
                {t('portal.customerPhone')}
                <input
                  className={inputClass}
                  value={genCustomerPhone}
                  onChange={(e) => setGenCustomerPhone(e.target.value)}
                  placeholder="05XXXXXXXX"
                  dir="ltr"
                  maxLength={30}
                />
              </label>
            </div>
            {me?.credit?.find((c) => c.planId === genPlanId)?.plan?.allowCustomDuration && (
              <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
                {t('portal.customDays')}
                <input
                  type="number"
                  min={1}
                  max={730}
                  className={inputClass}
                  value={genCustomDays}
                  onChange={(e) => setGenCustomDays(e.target.value)}
                  placeholder={String(me?.credit?.find((c) => c.planId === genPlanId)?.plan?.durationDays ?? '')}
                  dir="ltr"
                />
              </label>
            )}
            <div className="flex items-center gap-2">
              <span className="text-sm">العدد</span>
              <button
                onClick={() => setGenQty((q) => Math.max(1, q - 1))}
                className="p-1.5 border border-border hover:bg-muted"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <input
                type="number"
                min={1}
                max={50}
                className={`${inputClass} w-20 text-center`}
                value={genQty}
                onChange={(e) => setGenQty(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
              />
              <button
                onClick={() => setGenQty((q) => Math.min(50, q + 1))}
                className="p-1.5 border border-border hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs text-muted-foreground">{t('portal.quantity')}</span>
            </div>
            <button
              onClick={generateCodes}
              disabled={generating}
              className="inline-flex w-full items-center justify-center gap-2 h-10 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {generating && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('portal.generate')}
            </button>
            <div className="text-xs text-muted-foreground">{t('portal.startsOnActivation')}</div>
          </div>
        )}
      </Modal>
      </div>
    </div>
  );
}
