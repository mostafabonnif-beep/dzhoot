'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, MessageSquare, Send, Lock } from 'lucide-react';
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
}

interface TicketThread {
  _id: string;
  subject: string;
  status: 'OPEN' | 'PENDING' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  messages: Array<{ author: 'reseller' | 'admin'; body: string; createdAt: string }>;
  closedAt: string | null;
  createdAt: string;
}

const statusClass: Record<string, string> = {
  OPEN: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  PENDING: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  CLOSED: 'bg-muted text-muted-foreground',
};

export default function TicketsSection() {
  const { t } = useLocale();
  const { toast } = useToast();
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [thread, setThread] = useState<TicketThread | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const [form, setForm] = useState({ subject: '', body: '', priority: 'MEDIUM' });

  const load = useCallback(async () => {
    try {
      const res = await api.get('/reseller/tickets');
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

  async function handleCreate() {
    if (!form.subject.trim() || !form.body.trim()) return;
    setSending(true);
    try {
      const res = await api.post('/reseller/tickets', form);
      toast(t('portal.ticketCreated'), 'success');
      setShowCreate(false);
      setForm({ subject: '', body: '', priority: 'MEDIUM' });
      await load();
      setThread(res.data?.data || null);
    } catch {
      toast(t('portal.transferFailed'), 'error');
    } finally {
      setSending(false);
    }
  }

  async function openThread(id: string) {
    try {
      const res = await api.get(`/reseller/tickets/${id}`);
      setThread(res.data?.data || null);
      setReply('');
    } catch {
      toast(t('portal.transferFailed'), 'error');
    }
  }

  async function handleReply() {
    if (!thread || !reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/reseller/tickets/${thread._id}/reply`, { body: reply.trim() });
      toast(t('portal.replySent'), 'success');
      setReply('');
      await openThread(thread._id);
      await load();
    } catch {
      toast(t('portal.transferFailed'), 'error');
    } finally {
      setSending(false);
    }
  }

  async function handleClose() {
    if (!thread) return;
    setSending(true);
    try {
      await api.post(`/reseller/tickets/${thread._id}/close`);
      await openThread(thread._id);
      await load();
    } catch {
      toast(t('portal.transferFailed'), 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            <MessageSquare className="h-4 w-4" /> {t('portal.tickets')}
          </h2>
          <p className="text-xs text-muted-foreground/80 mt-1">{t('portal.ticketsHint')}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-2 border border-primary/40 text-primary hover:bg-primary/5 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> {t('portal.newTicket')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground mt-2">{t('portal.ticketEmpty')}</div>
      ) : (
        <div className="mt-2 space-y-2">
          {rows.map((r) => (
            <button
              key={r._id}
              onClick={() => openThread(r._id)}
              className="w-full text-right border border-border/70 hover:border-primary/40 transition-colors p-3"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-medium text-sm">{r.subject}</span>
                <span className={`inline-flex px-2 py-0.5 text-[11px] font-medium ${statusClass[r.status] || ''}`}>
                  {r.status === 'OPEN' ? t('portal.ticketOpen') : r.status === 'PENDING' ? t('portal.ticketPending') : t('portal.ticketClosed')}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {r.lastMessage?.body?.slice(0, 80)}
                {r.lastMessage && r.lastMessage.body.length > 80 ? '…' : ''}
              </div>
              <div className="text-[11px] text-muted-foreground/70 mt-1" dir="ltr">
                {new Date(r.createdAt).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Create ticket modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t('portal.newTicket')}>
        <div className="space-y-3">
          <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
            {t('portal.ticketSubject')} *
            <input
              className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              maxLength={200}
            />
          </label>
          <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
            {t('portal.ticketBody')} *
            <textarea
              rows={4}
              className="w-full px-3 py-2 border border-border bg-background text-sm"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              maxLength={4000}
            />
          </label>
          <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
            {t('portal.ticketPriority')}
            <select
              className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </label>
          <button
            onClick={handleCreate}
            disabled={sending || !form.subject.trim() || !form.body.trim()}
            className="inline-flex w-full items-center justify-center gap-2 h-10 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t('portal.ticketSend')}
          </button>
        </div>
      </Modal>

      {/* Thread modal */}
      <Modal open={!!thread} onClose={() => setThread(null)} title={thread?.subject || ''} size="lg">
        {thread && (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className={`inline-flex px-2 py-0.5 text-[11px] font-medium ${statusClass[thread.status] || ''}`}>
                {thread.status === 'OPEN' ? t('portal.ticketOpen') : thread.status === 'PENDING' ? t('portal.ticketPending') : t('portal.ticketClosed')}
              </span>
              {thread.status !== 'CLOSED' && (
                <button
                  onClick={handleClose}
                  disabled={sending}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border hover:bg-muted disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                  {t('portal.ticketClose')}
                </button>
              )}
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {thread.messages.map((m, i) => (
                <div key={i} className={`p-3 text-sm border ${m.author === 'admin' ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30'}`}>
                  <div className="text-[11px] text-muted-foreground mb-1">
                    {m.author === 'admin' ? 'Admin' : 'أنت'} · <span dir="ltr">{new Date(m.createdAt).toLocaleString()}</span>
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
                  onClick={handleReply}
                  disabled={sending || !reply.trim()}
                  className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t('portal.ticketSend')}
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}
