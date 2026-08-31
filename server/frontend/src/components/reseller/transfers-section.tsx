'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Send, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';
import { useToast } from '@/hooks/use-toast';

interface TransferRow {
  _id: string;
  type: 'TRANSFER_IN' | 'TRANSFER_OUT';
  quantity: number;
  balanceAfter: number;
  plan: { name: string; durationDays: number } | null;
  counterparty: { _id: string; name: string; city: string } | null;
  note: string;
  createdAt: string;
}

interface Props {
  credit: Array<{ planId: string; quantity: number; plan: { name: string; durationDays: number } }>;
}

export default function TransfersSection({ credit }: Props) {
  const { t } = useLocale();
  const { toast } = useToast();
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toUsername, setToUsername] = useState('');
  const [planId, setPlanId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/reseller/transfers');
      setRows(res.data?.data || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSend() {
    if (!toUsername.trim() || !planId || !Number.isInteger(Number(quantity)) || Number(quantity) < 1) {
      toast(t('portal.transferFailed'), 'error');
      return;
    }
    setSending(true);
    try {
      await api.post('/reseller/transfers', {
        toUsername: toUsername.trim(),
        planId,
        quantity: Number(quantity),
      });
      toast(t('portal.transferSuccess'), 'success');
      setToUsername('');
      setQuantity(1);
      setPlanId('');
      await load();
    } catch (err) {
      const resp = (err as { response?: { data?: { error?: string } } })?.response?.data;
      toast(resp?.error || t('portal.transferFailed'), 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-1">
        <Send className="h-4 w-4" /> {t('portal.transfers')}
      </h2>
      <p className="text-xs text-muted-foreground/80 mb-3">{t('portal.transfersHint')}</p>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
        <input
          className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm"
          placeholder={t('portal.transferTo')}
          value={toUsername}
          onChange={(e) => setToUsername(e.target.value)}
          dir="ltr"
        />
        <select
          className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
        >
          <option value="">{t('portal.transferPlan')}…</option>
          {credit
            .filter((c) => c.quantity > 0)
            .map((c) => (
              <option key={c.planId} value={c.planId}>
                {c.plan.name} — {c.quantity} {t('portal.remainingCredit')}
              </option>
            ))}
        </select>
        <input
          type="number"
          min={1}
          className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm"
          placeholder={t('portal.transferQty')}
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value) || 1)}
          dir="ltr"
        />
        <button
          onClick={handleSend}
          disabled={sending}
          className="inline-flex items-center justify-center gap-2 h-10 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {t('portal.transferSend')}
        </button>
      </div>

      <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-2">
        {t('portal.transferHistory')}
      </div>
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t('portal.transferEmpty')}</div>
      ) : (
        <div className="border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.15em] text-muted-foreground">
                <th className="text-right p-2.5">{t('portal.ledgerType')}</th>
                <th className="text-right p-2.5">{t('portal.transferPlan')}</th>
                <th className="text-right p-2.5">{t('portal.transferQty')}</th>
                <th className="text-right p-2.5">{t('portal.ledgerBalance')}</th>
                <th className="text-right p-2.5">{t('portal.ledgerDate')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-b border-border/50 last:border-0">
                  <td className="p-2.5">
                    {r.type === 'TRANSFER_IN' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <ArrowDownLeft className="h-3.5 w-3.5" />
                        {t('portal.transferIn')} {r.counterparty?.name || '—'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
                        <ArrowUpRight className="h-3.5 w-3.5" />
                        {t('portal.transferOut')} {r.counterparty?.name || '—'}
                      </span>
                    )}
                  </td>
                  <td className="p-2.5">{r.plan?.name || '—'}</td>
                  <td className="p-2.5 font-medium tabular-nums">{Math.abs(r.quantity)}</td>
                  <td className="p-2.5 tabular-nums">{r.balanceAfter}</td>
                  <td className="p-2.5 text-muted-foreground" dir="ltr">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
