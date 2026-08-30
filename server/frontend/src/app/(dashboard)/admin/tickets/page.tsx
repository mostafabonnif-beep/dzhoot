'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquare, Send, Lock, RefreshCw, Search } from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';
import { useToast } from '@/hooks/use-toast';
import Modal from '@/components/ui/modal';

interface TicketRow {
  _id: string;
  subject: string;
  status: 'OPEN' | 'PENDING' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  messageCount: number;
  lastMessage: { author: 'reseller' | 'admin'; body: string; createdAt: string } | null;
  closedAt: string | null;
  createdAt: string;
  reseller: { _id: string; name: string; city?: string; phone?: string; username?: string; status?: string } | null;
}

interface TicketThread extends TicketRow {
  messages: Array<{ author: 'reseller' | 'admin'; body: string; createdAt: string }>;
}

const STATUS_TABS = ['ALL', 'OPEN', 'PENDING', 'CLOSED'] as const;

const statusClass: Record<string, string> = {
  OPEN: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  PENDING: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  CLOSED: 'bg-muted text-muted-foreground',
};

const statusLabel: Record<string, string> = {
  OPEN: 'portal.ticketOpen',
  PENDING: 'portal.ticketPending',
  CLOSED: 'portal.ticketClosed',
};

const priorityClass: Record<string, string> = {
  LOW: 'text-muted-foreground',
  MEDIUM: 'text-amber-600 dark:text-amber-400',
  HIGH: 'text-red-600 dark:text-red-400',
};

export default function AdminTicketsPage() {
  const { t } = useLocale();
  const { toast } = useToast();
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [summary, setSummary] = useState({ OPEN: 0, PENDING: 0, CLOSED: 0 });
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [thread, setThread] = useState<TicketThread | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/admin/tickets', { params: { status: tab === 'ALL' ? undefined : tab } });
      setRows(res.data?.data || []);
      setSummary(res.data?.summary || { OPEN: 0, PENDING: 0, CLOSED: 0 });
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = search.trim()
    ? rows.filter((r) => {
        const q = search.trim().toLowerCase();
        return (
          r.subject.toLowerCase().includes(q) ||
          (r.reseller?.name || '').toLowerCase().includes(q) ||
          (r.reseller?.username || '').toLowerCase().includes(q)
        );
      })
    : rows;

  async function openThread(id: string) {
    try {
      const res = await api.get(`/admin/tickets/${id}`);
      setThread(res.data?.data || null);
      setReply('');
    } catch {
      toast(t('portal.transferFailed'), 'error');
    }
  }

  async function doAction(kind: 'reply' | 'close' | 'reopen') {
    if (!thread) return;
    setBusy(true);
    try {
      if (kind === 'reply') {
        if (!reply.trim()) return;
        await api.post(`/admin/tickets/${thread._id}/reply`, { body: reply.trim() });
        toast(t('portal.replySent'), 'success');
        setReply('');
      } else if (kind === 'close') {
        await api.post(`/admin/tickets/${thread._id}/close`);
      } else {
        await api.post(`/admin/tickets/${thread._id}/reopen`);
      }
      await openThread(thread._id);
      await load();
    } catch {
      toast(t('portal.transferFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('nav.tickets')}</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              className="h-9 w-56 border border-border bg-background pr-9 pl-3 text-sm"
              placeholder={t('portal.clientSearch')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-sm border border-border hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_TABS.map((s) => {
          const count = s === 'ALL' ? summary.OPEN + summary.PENDING + summary.CLOSED : summary[s];
          return (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border transition-colors ${
                tab === s ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {s === 'ALL' ? t('nav.dashboard') : t(statusLabel[s])}
              <span className="text-xs opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-border p-10 text-center text-muted-foreground">
          {t('portal.ticketEmpty')}
        </div>
      ) : (
        <div className="border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.15em] text-muted-foreground">
                <th className="text-right p-3">{t('portal.ticketSubject')}</th>
                <th className="text-right p-3">{t('resellers.count')}</th>
                <th className="text-right p-3">{t('portal.ticketPriority')}</th>
                <th className="text-right p-3">{t('portal.ledgerStatus')}</th>
                <th className="text-right p-3">{t('portal.ledgerDate')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r._id}
                  onClick={() => openThread(r._id)}
                  className="border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/40"
                >
                  <td className="p-3">
                    <div className="font-medium">{r.subject}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {r.messageCount} msg · {r.lastMessage?.body?.slice(0, 60) || ''}
                    </div>
                  </td>
                  <td className="p-3 text-xs">
                    {r.reseller ? (
                      <div>
                        <div className="font-medium">{r.reseller.name}</div>
                        <div className="text-muted-foreground" dir="ltr">{r.reseller.username || ''}</div>
                      </div>
                    ) : '—'}
                  </td>
                  <td className={`p-3 text-xs font-medium ${priorityClass[r.priority] || ''}`}>{r.priority}</td>
                  <td className="p-3">
                    <span className={`inline-flex px-2 py-0.5 text-[11px] font-medium ${statusClass[r.status] || ''}`}>
                      {t(statusLabel[r.status])}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground" dir="ltr">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Thread modal */}
      <Modal open={!!thread} onClose={() => setThread(null)} title={thread?.subject || ''} size="lg">
        {thread && (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className={`inline-flex px-2 py-0.5 text-[11px] font-medium ${statusClass[thread.status] || ''}`}>
                  {t(statusLabel[thread.status])}
                </span>
                <span className="text-xs text-muted-foreground">
                  {thread.reseller?.name || ''} {thread.reseller?.city ? `— ${thread.reseller.city}` : ''}
                  {thread.reseller?.phone ? ` · ${thread.reseller.phone}` : ''}
                </span>
              </div>
              {thread.status === 'CLOSED' ? (
                <button
                  onClick={() => doAction('reopen')}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border hover:bg-muted disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> {t('portal.ticketReopen')}
                </button>
              ) : (
                <button
                  onClick={() => doAction('close')}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border hover:bg-muted disabled:opacity-50"
                >
                  <Lock className="h-3.5 w-3.5" /> {t('portal.ticketClose')}
                </button>
              )}
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {thread.messages.map((m, i) => (
                <div
                  key={i}
                  className={`p-3 text-sm border ${m.author === 'admin' ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30'}`}
                >
                  <div className="text-[11px] text-muted-foreground mb-1">
                    {m.author === 'admin' ? 'Admin' : thread.reseller?.name || 'Reseller'} ·{' '}
                    <span dir="ltr">{new Date(m.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="whitespace-pre-wrap">{m.body}</div>
                </div>
              ))}
            </div>
            {thread.status !== 'CLOSED' && (
              <div className="flex items-center gap-2">
                <textarea
                  rows={2}
                  className="flex-1 px-3 py-2 border border-border bg-background text-sm"
                  placeholder={t('portal.ticketReply')}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  maxLength={4000}
                />
                <button
                  onClick={() => doAction('reply')}
                  disabled={busy || !reply.trim()}
                  className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t('portal.ticketSend')}
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
