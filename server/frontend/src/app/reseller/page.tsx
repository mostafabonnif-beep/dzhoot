'use client';

import { useCallback, useEffect, useState } from 'react';
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
} from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';
import { useToast } from '@/hooks/use-toast';
import Modal from '@/components/ui/modal';
import { useLocale } from '@/components/locale-provider';

interface CreditItem {
  planId: string;
  quantity: number;
  plan: { name: string; durationDays: number };
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
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<{ batchNumber: number; planName: string; codes: string[] } | null>(null);
  const [genCopied, setGenCopied] = useState(false);

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
    if (!accessToken) {
      router.replace('/reseller/login');
      return;
    }
    load();
    loadLedger();
  }, [hydrated, accessToken, router, load]);

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
      const res = await api.post('/reseller/codes/generate', { planId: genPlanId, quantity: genQty });
      const data = res.data?.data;
      setGenResult({
        batchNumber: data.batch.batchNumber,
        planName: data.batch.plan.name,
        codes: data.codes || [],
      });
      toast(t('portal.generatedSuccess'), 'success');
      setGenQty(1);
      load(); // refresh credit + batches
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || t('portal.loadError'), 'error');
    } finally {
      setGenerating(false);
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
    <div className="h-screen supports-[height:100dvh]:h-dvh overflow-y-auto bg-background" dir="rtl">
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

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
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
  );
}
