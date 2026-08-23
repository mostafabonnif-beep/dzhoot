'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Send, Trash2, Plus, Bell, Check } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useLocale } from '@/components/locale-provider';
import Pagination from '@/components/ui/pagination';

interface Notification {
  _id: string;
  title: string;
  body: string;
  imageUrl?: string;
  deepLink?: string;
  audience: 'ALL' | 'ACTIVE';
  status: 'DRAFT' | 'SCHEDULED' | 'SENT';
  scheduledAt?: string | null;
  sentAt?: string | null;
  createdAt?: string;
}

export default function NotificationsPage() {
  const { locale } = useLocale();
  const { toast } = useToast();

  const L = (ar: string, fr: string, en: string) => (locale === 'ar' ? ar : locale === 'fr' ? fr : en);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [deepLink, setDeepLink] = useState('');
  const [audience, setAudience] = useState<'ALL' | 'ACTIVE'>('ALL');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');

  const [sendingId, setSendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/notifications', { params: { page, pageSize } });
      const body = res.data;
      setNotifications(Array.isArray(body) ? body : body.data || []);
      setTotalCount(body.totalCount ?? (Array.isArray(body) ? body.length : 0));
    } catch {
      toast(L('فشل تحميل الإشعارات', 'Échec du chargement des notifications', 'Failed to load notifications'), 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!title.trim() || !body.trim()) {
      setFormError(L('العنوان والنص مطلوبان', 'Titre et contenu requis', 'Title and body are required'));
      return;
    }
    setCreating(true);
    try {
      await api.post('/admin/notifications', {
        title: title.trim(),
        body: body.trim(),
        imageUrl: imageUrl.trim(),
        deepLink: deepLink.trim(),
        audience,
      });
      toast(L('تم إنشاء الإشعار (مسودة)', 'Notification créée (brouillon)', 'Notification created (draft)'), 'success');
      setShowForm(false);
      setTitle('');
      setBody('');
      setImageUrl('');
      setDeepLink('');
      setAudience('ALL');
      await fetchNotifications();
    } catch {
      setFormError(L('فشل إنشاء الإشعار', 'Échec de la création', 'Failed to create notification'));
    } finally {
      setCreating(false);
    }
  }

  async function handleSend(n: Notification) {
    const confirmed = window.confirm(
      L(
        `سيتم إرسال «${n.title}» إلى ${n.audience === 'ALL' ? 'جميع المستخدمين' : 'المستخدمين النشطين'} عبر FCM. متابعة؟`,
        `«${n.title}» sera envoyée à ${n.audience === 'ALL' ? 'tous les utilisateurs' : 'utilisateurs actifs'} via FCM. Continuer ?`,
        `"${n.title}" will be sent to ${n.audience === 'ALL' ? 'all users' : 'active users'} via FCM. Continue?`,
      ),
    );
    if (!confirmed) return;
    setSendingId(n._id);
    try {
      const res = await api.post(`/admin/notifications/${n._id}/send`);
      const fcm = res.data?.fcm;
      const sent = fcm?.successCount ?? fcm?.sent ?? 0;
      toast(
        L(
          sent > 0 ? `تم الإرسال إلى ${sent} جهاز` : 'تم وضع علامة مُرسَل (لا أجهزة مستهدفة)',
          sent > 0 ? `Envoyée à ${sent} appareils` : 'Marquée envoyée (aucun appareil ciblé)',
          sent > 0 ? `Sent to ${sent} devices` : 'Marked sent (no targeted devices)',
        ),
        'success',
      );
      await fetchNotifications();
    } catch {
      toast(L('فشل إرسال الإشعار', 'Échec de l’envoi', 'Failed to send notification'), 'error');
    } finally {
      setSendingId(null);
    }
  }

  async function handleDelete(n: Notification) {
    const confirmed = window.confirm(
      L(
        `حذف الإشعار «${n.title}» نهائياً؟`,
        `Supprimer la notification «${n.title}» ?`,
        `Delete notification "${n.title}"?`,
      ),
    );
    if (!confirmed) return;
    setDeletingId(n._id);
    try {
      await api.delete(`/admin/notifications/${n._id}`);
      toast(L('تم الحذف', 'Supprimée', 'Deleted'), 'success');
      await fetchNotifications();
    } catch {
      toast(L('فشل الحذف', 'Échec de la suppression', 'Failed to delete'), 'error');
    } finally {
      setDeletingId(null);
    }
  }

  const inputClass =
    'w-full h-10 px-3 border border-border bg-background text-sm focus-visible:outline-none focus-visible:border-primary';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">
            {L('الإشعارات', 'Notifications', 'Notifications')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {L('إنشاء وإرسال إشعارات الدفع عبر FCM', 'Créer et envoyer des notifications push via FCM', 'Create and send push notifications via FCM')}
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {L('إشعار جديد', 'Nouvelle notification', 'New notification')}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="border border-border bg-card p-5 space-y-4">
          {formError && (
            <div role="alert" className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {L('العنوان', 'Titre', 'Title')} *
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputClass} />
            </label>
            <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {L('الجمهور', 'Audience', 'Audience')}
              <select value={audience} onChange={(e) => setAudience(e.target.value as 'ALL' | 'ACTIVE')} className={inputClass}>
                <option value="ALL">{L('جميع المستخدمين', 'Tous', 'All users')}</option>
                <option value="ACTIVE">{L('المستخدمون النشطون فقط', 'Actifs uniquement', 'Active subscribers only')}</option>
              </select>
            </label>
          </div>
          <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
            {L('النص', 'Contenu', 'Body')} *
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              rows={3}
              className="w-full px-3 py-2 border border-border bg-background text-sm focus-visible:outline-none focus-visible:border-primary"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {L('رابط الصورة (اختياري)', 'Image URL (facultatif)', 'Image URL (optional)')}
              <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className={inputClass} dir="ltr" />
            </label>
            <label className="block space-y-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {L('الرابط العميق (اختياري)', 'Deep link (facultatif)', 'Deep link (optional)')}
              <input value={deepLink} onChange={(e) => setDeepLink(e.target.value)} className={inputClass} dir="ltr" />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {L('إنشاء مسودة', 'Créer le brouillon', 'Create draft')}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-5 py-2.5 text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              {L('إلغاء', 'Annuler', 'Cancel')}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="border border-border px-4 py-12 text-center text-sm text-muted-foreground">
          <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
          {L('لا توجد إشعارات بعد.', 'Aucune notification.', 'No notifications yet.')}
        </div>
      ) : (
        <div className="border border-border divide-y divide-border">
          {notifications.map((n) => (
            <div key={n._id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{n.title}</span>
                  <span
                    className={`shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 border ${
                      n.status === 'SENT'
                        ? 'border-signal-green/30 text-signal-green'
                        : 'border-signal-amber/40 text-signal-amber'
                    }`}
                  >
                    {n.status === 'SENT'
                      ? L('مُرسَل', 'Envoyée', 'Sent')
                      : L('مسودة', 'Brouillon', 'Draft')}
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {n.audience === 'ALL'
                      ? L('الكل', 'Tous', 'All')
                      : L('النشطون', 'Actifs', 'Active')}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.body}</p>
                <p className="text-[11px] text-muted-foreground/70 mt-1">
                  {n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}
                  {n.sentAt ? ` · ${L('أُرسل', 'Envoyée le', 'Sent')}: ${new Date(n.sentAt).toLocaleString()}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {n.status !== 'SENT' && (
                  <button
                    onClick={() => handleSend(n)}
                    disabled={sendingId === n._id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-signal-green/40 text-signal-green hover:bg-signal-green/5 disabled:opacity-50 transition-colors"
                  >
                    {sendingId === n._id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    {L('إرسال', 'Envoyer', 'Send')}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(n)}
                  disabled={deletingId === n._id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-destructive/40 text-destructive hover:bg-destructive/5 disabled:opacity-50 transition-colors"
                >
                  {deletingId === n._id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {totalCount > pageSize && (
        <Pagination page={page} pageSize={pageSize} totalCount={totalCount} onPageChange={setPage} />
      )}
    </div>
  );
}
