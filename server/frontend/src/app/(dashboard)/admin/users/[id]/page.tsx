'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, Copy, Check, RefreshCw, KeyRound } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useLocale } from '@/components/locale-provider';
import ConfirmDialog from '@/components/ui/confirm-dialog';

interface UserDetail {
  _id: string;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  channelListCode?: string;
  lastLogin?: string;
  createdAt?: string;
  channels?: Array<{
    _id: string;
    channelName: string;
    channelGroup?: string;
    channelUrl?: string;
    channelImg?: string;
    tvgLogo?: string;
    order?: number;
    channelId?: string;
  }>;
  devicesInUse?: number;
  subscription?: {
    planId?: string;
    planName?: string;
    status?: string;
    startsAt?: string | null;
    expiresAt?: string | null;
  } | null;
}

export default function UserDetailPage() {
  const { toast } = useToast();
  const { locale } = useLocale();
  const params = useParams();
  const router = useRouter();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  // Reset password
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetError('');
    if (newPassword.length < 8) {
      setResetError(
        locale === 'ar'
          ? 'كلمة المرور يجب أن تكون 8 أحرف على الأقل'
          : locale === 'fr'
            ? 'Le mot de passe doit contenir au moins 8 caractères'
            : 'Password must be at least 8 characters',
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError(
        locale === 'ar'
          ? 'كلمتا المرور غير متطابقتين'
          : locale === 'fr'
            ? 'Les mots de passe ne correspondent pas'
            : 'Passwords do not match',
      );
      return;
    }
    setResetLoading(true);
    try {
      await api.put(`/users/${params.id}`, { password: newPassword });
      toast(
        locale === 'ar'
          ? 'تمت إعادة تعيين كلمة المرور'
          : locale === 'fr'
            ? 'Mot de passe réinitialisé'
            : 'Password reset',
        'success',
      );
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setResetError(
        locale === 'ar'
          ? 'فشل إعادة تعيين كلمة المرور'
          : locale === 'fr'
            ? 'Échec de la réinitialisation'
            : 'Failed to reset password',
      );
    } finally {
      setResetLoading(false);
    }
  }

  const [editing, setEditing] = useState(false);
  const [editUsername, setEditUsername] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    return () => clearTimeout(copyTimeoutRef.current);
  }, []);

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await api.get(`/users/${params.id}`);
        const data = res.data.data || res.data.user || res.data;
        setUser(data);
        setEditUsername(data.username);
        setEditEmail(data.email);
        setEditRole(data.role);
      } catch {
        setError(
          locale === 'ar'
            ? 'فشل تحميل المستخدم'
            : locale === 'fr'
              ? 'Échec du chargement de l’utilisateur'
              : 'Failed to load user',
        );
      } finally {
        setLoading(false);
      }
    }
    fetchUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError('');
    setSaveLoading(true);
    try {
      const res = await api.put(`/users/${params.id}`, {
        username: editUsername,
        email: editEmail,
        role: editRole,
      });
      const updated = res.data.data || res.data.user || res.data;
      setUser((prev) => (prev ? { ...prev, ...updated } : prev));
      setEditing(false);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setSaveError(
        axiosErr.response?.data?.error ||
          (locale === 'ar'
            ? 'فشل تحديث المستخدم'
            : locale === 'fr'
              ? 'Échec de la mise à jour de l’utilisateur'
              : 'Failed to update user'),
      );
    } finally {
      setSaveLoading(false);
    }
  }

  async function handleRegenerateCode() {
    try {
      const res = await api.put(`/users/${params.id}/regenerate-code`);
      const newCode = res.data.channelListCode || res.data.data?.channelListCode;
      if (newCode) {
        setUser((prev) => (prev ? { ...prev, channelListCode: newCode } : prev));
      }
    } catch {
      toast('فشل إعادة توليد الكود', 'error');
    } finally {
      setShowRegenerateConfirm(false);
    }
  }

  function handleCopyCode() {
    if (!user?.channelListCode) return;
    navigator.clipboard.writeText(user.channelListCode).catch(() => {});
    setCopiedCode(true);
    clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopiedCode(false), 1500);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> {locale === 'ar' ? 'رجوع' : locale === 'fr' ? 'Retour' : 'Back'}
        </button>
        <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error ||
            (locale === 'ar'
              ? 'المستخدم غير موجود'
              : locale === 'fr'
                ? 'Utilisateur introuvable'
                : 'User not found')}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/admin/users')}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> {locale === 'ar' ? 'رجوع' : locale === 'fr' ? 'Retour' : 'Back'}
        </button>
        <div>
          <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">
            {user.username}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{user.email}</p>
        </div>
      </div>

      {/* User Info */}
      <div className="border border-border">
        <div className="px-4 py-2 bg-muted/50 border-b border-border flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            {locale === 'ar' ? 'تفاصيل المستخدم' : locale === 'fr' ? 'Détails de l’utilisateur' : 'User Details'}
          </h2>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80 transition-colors font-medium"
            >
              {locale === 'ar' ? 'تعديل' : locale === 'fr' ? 'Modifier' : 'Edit'}
            </button>
          )}
        </div>

        {editing ? (
          <form onSubmit={handleSave} className="p-4 space-y-4">
            {saveError && (
              <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {saveError}
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-username"
                  className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground"
                >
                  {locale === 'ar' ? 'اسم المستخدم' : locale === 'fr' ? 'Nom d’utilisateur' : 'Username'}
                </label>
                <input
                  id="edit-username"
                  type="text"
                  required
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-email"
                  className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground"
                >
                  {locale === 'ar' ? 'البريد الإلكتروني' : locale === 'fr' ? 'E-mail' : 'Email'}
                </label>
                <input
                  id="edit-email"
                  type="email"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-role"
                  className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground"
                >
                  {locale === 'ar' ? 'الدور' : locale === 'fr' ? 'Rôle' : 'Role'}
                </label>
                <select
                  id="edit-role"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
                >
                  <option value="User">{locale === 'ar' ? 'مستخدم' : locale === 'fr' ? 'Utilisateur' : 'User'}</option>
                  <option value="Admin">{locale === 'ar' ? 'مسؤول' : 'Admin'}</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saveLoading}
                className="px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {locale === 'ar'
                  ? saveLoading
                    ? 'جارٍ الحفظ...'
                    : 'حفظ التغييرات'
                  : locale === 'fr'
                    ? saveLoading
                      ? 'Enregistrement...'
                      : 'Enregistrer les modifications'
                    : saveLoading
                      ? 'Saving...'
                      : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setSaveError('');
                  setEditUsername(user.username);
                  setEditEmail(user.email);
                  setEditRole(user.role);
                }}
                className="px-6 py-2.5 text-sm font-medium border border-border uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
              >
                {locale === 'ar' ? 'إلغاء' : locale === 'fr' ? 'Annuler' : 'Cancel'}
              </button>
            </div>
          </form>
        ) : (
          <dl className="divide-y divide-border">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'اسم المستخدم' : locale === 'fr' ? 'Nom d’utilisateur' : 'Username'}
              </dt>
              <dd className="text-sm font-medium">{user.username}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'البريد الإلكتروني' : locale === 'fr' ? 'E-mail' : 'Email'}
              </dt>
              <dd className="text-sm font-medium">{user.email}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'الدور' : locale === 'fr' ? 'Rôle' : 'Role'}
              </dt>
              <dd className="text-sm font-medium">{user.role}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'الحالة' : locale === 'fr' ? 'Statut' : 'Status'}
              </dt>
              <dd className="flex items-center gap-2">
                <div className="relative inline-flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${user.isActive ? 'bg-signal-green' : 'bg-signal-red'}`}
                  />
                  <span className="text-sm font-medium">
                    {user.isActive
                      ? locale === 'ar'
                        ? 'نشط'
                        : locale === 'fr'
                          ? 'Actif'
                          : 'Active'
                      : locale === 'ar'
                        ? 'غير نشط'
                        : locale === 'fr'
                          ? 'Inactif'
                          : 'Inactive'}
                  </span>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await api.put(`/users/${params.id}`, { isActive: !user.isActive });
                      setUser((prev) => (prev ? { ...prev, isActive: !prev.isActive } : prev));
                    } catch {
                      toast('فشل تحديث الحالة', 'error');
                    }
                  }}
                  className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80 transition-colors font-medium"
                >
                  {user.isActive
                    ? locale === 'ar'
                      ? 'تعطيل'
                      : locale === 'fr'
                        ? 'Désactiver'
                        : 'Deactivate'
                    : locale === 'ar'
                      ? 'تفعيل'
                      : locale === 'fr'
                        ? 'Activer'
                        : 'Activate'}
                </button>
              </dd>
            </div>
            {user.lastLogin && (
              <div className="flex items-center justify-between px-4 py-3">
                <dt className="text-sm text-muted-foreground">
                  {locale === 'ar' ? 'آخر تسجيل دخول' : locale === 'fr' ? 'Dernière connexion' : 'Last Login'}
                </dt>
                <dd className="text-sm font-medium">{new Date(user.lastLogin).toLocaleString()}</dd>
              </div>
            )}
            {user.createdAt && (
              <div className="flex items-center justify-between px-4 py-3">
                <dt className="text-sm text-muted-foreground">
                  {locale === 'ar' ? 'تاريخ الإنشاء' : locale === 'fr' ? 'Créé le' : 'Created'}
                </dt>
                <dd className="text-sm font-medium">{new Date(user.createdAt).toLocaleString()}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {/* Subscription */}
      <div className="border border-border">
        <div className="px-4 py-2 bg-muted/50 border-b border-border">
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            {locale === 'ar' ? 'الاشتراك' : locale === 'fr' ? 'Abonnement' : 'Subscription'}
          </h2>
        </div>
        {user.subscription?.planName ? (
          <dl className="divide-y divide-border">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'الباقة' : locale === 'fr' ? 'Forfait' : 'Plan'}
              </dt>
              <dd className="text-sm font-medium">{user.subscription.planName}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'الحالة' : locale === 'fr' ? 'Statut' : 'Status'}
              </dt>
              <dd className="text-sm font-medium">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] uppercase tracking-wide border ${
                    user.subscription.status === 'ACTIVE'
                      ? 'bg-signal-green/10 text-signal-green border-signal-green/30'
                      : user.subscription.status === 'EXPIRED'
                        ? 'bg-signal-red/10 text-signal-red border-signal-red/30'
                        : 'bg-muted text-muted-foreground border-border'
                  }`}
                >
                  {user.subscription.status === 'ACTIVE'
                    ? locale === 'ar'
                      ? 'نشط'
                      : locale === 'fr'
                        ? 'Actif'
                        : 'Active'
                    : user.subscription.status === 'EXPIRED'
                      ? locale === 'ar'
                        ? 'منتهي'
                        : locale === 'fr'
                          ? 'Expiré'
                          : 'Expired'
                      : locale === 'ar'
                        ? 'ملغى'
                        : locale === 'fr'
                          ? 'Annulé'
                          : 'Cancelled'}
                </span>
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'تاريخ البدء' : locale === 'fr' ? 'Début' : 'Starts'}
              </dt>
              <dd className="text-sm font-medium">
                {user.subscription.startsAt ? new Date(user.subscription.startsAt).toLocaleDateString() : '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'تاريخ الانتهاء' : locale === 'fr' ? 'Expiration' : 'Expires'}
              </dt>
              <dd className="text-sm font-medium">
                {user.subscription.expiresAt ? new Date(user.subscription.expiresAt).toLocaleDateString() : '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'الأجهزة المستخدمة' : locale === 'fr' ? 'Appareils utilisés' : 'Devices in use'}
              </dt>
              <dd className="text-sm font-medium">{user.devicesInUse ?? 0}</dd>
            </div>
          </dl>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            {locale === 'ar'
              ? 'لا يوجد اشتراك مسجل لهذا المستخدم.'
              : locale === 'fr'
                ? 'Aucun abonnement enregistré pour cet utilisateur.'
                : 'No subscription registered for this user.'}
          </div>
        )}
      </div>

      {/* Reset password (admin) */}
      <div className="border border-border">
        <div className="px-4 py-2 bg-muted/50 border-b border-border">
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            {locale === 'ar'
              ? 'إعادة تعيين كلمة المرور'
              : locale === 'fr'
                ? 'Réinitialiser le mot de passe'
                : 'Reset password'}
          </h2>
        </div>
        <form onSubmit={handleResetPassword} className="px-4 py-4 space-y-3">
          {resetError && (
            <div role="alert" className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {resetError}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={
                locale === 'ar' ? 'كلمة المرور الجديدة' : locale === 'fr' ? 'Nouveau mot de passe' : 'New password'
              }
              autoComplete="new-password"
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={
                locale === 'ar' ? 'تأكيد كلمة المرور' : locale === 'fr' ? 'Confirmer' : 'Confirm password'
              }
              autoComplete="new-password"
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={resetLoading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-2 border-destructive/30 text-destructive hover:bg-destructive/5 disabled:opacity-50 transition-colors"
          >
            {resetLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {locale === 'ar'
              ? 'إعادة التعيين'
              : locale === 'fr'
                ? 'Réinitialiser'
                : 'Reset password'}
          </button>
        </form>
      </div>

      {/* Channel List Code */}
      <div className="border border-border">
        <div className="px-4 py-2 bg-muted/50 border-b border-border">
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            {locale === 'ar' ? 'رمز قائمة القنوات' : locale === 'fr' ? 'Code de la liste de chaînes' : 'Channel List Code'}
          </h2>
        </div>
        <div className="px-4 py-4">
          <div className="flex items-center gap-3">
            <code className="text-lg font-mono font-bold bg-muted px-3 py-1.5 tracking-widest">
              {user.channelListCode || '—'}
            </code>
            {user.channelListCode && (
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                aria-label={
                  locale === 'ar'
                    ? 'نسخ إلى الحافظة'
                    : locale === 'fr'
                      ? 'Copier dans le presse-papiers'
                      : 'Copy to clipboard'
                }
              >
                {copiedCode ? (
                  <>
                    <Check className="h-4 w-4 text-signal-green" /> {locale === 'ar' ? 'تم النسخ' : locale === 'fr' ? 'Copié' : 'Copied'}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" /> {locale === 'ar' ? 'نسخ' : locale === 'fr' ? 'Copier' : 'Copy'}
                  </>
                )}
              </button>
            )}
            <button
              onClick={() => setShowRegenerateConfirm(true)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors ml-2"
            >
              <RefreshCw className="h-4 w-4" /> {locale === 'ar' ? 'إعادة توليد' : locale === 'fr' ? 'Régénérer' : 'Regenerate'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {locale === 'ar'
              ? 'يُستخدم هذا الرمز في تطبيق التلفاز لتحميل قائمة قنوات هذا المستخدم.'
              : locale === 'fr'
                ? 'Ce code est utilisé par l’application TV pour charger la liste des chaînes de cet utilisateur.'
                : "This code is used by the TV app to load this user's channel list."}
          </p>
        </div>
      </div>

      {/* Assigned Channels */}
      {user.channels &&
        user.channels.length > 0 &&
        (() => {
          const channels = user.channels!;
          const groupCounts = channels.reduce<Record<string, number>>((acc, ch) => {
            const g =
              ch.channelGroup ||
              (locale === 'ar' ? 'غير مصنّف' : locale === 'fr' ? 'Non catégorisé' : 'Uncategorized');
            acc[g] = (acc[g] || 0) + 1;
            return acc;
          }, {});
          const groupEntries = Object.entries(groupCounts).sort((a, b) => b[1] - a[1]);

          return (
            <div className="border border-border">
              <div className="px-4 py-2 bg-muted/50 border-b border-border">
                <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                  {locale === 'ar' ? 'القنوات المخصصة' : locale === 'fr' ? 'Chaînes assignées' : 'Assigned Channels'}
                </h2>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border border-b border-border">
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-[0.1em]">
                    {locale === 'ar' ? 'الإجمالي' : 'Total'}
                  </p>
                  <p className="text-2xl font-bold mt-0.5">{channels.length}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-[0.1em]">
                    {locale === 'ar' ? 'المجموعات' : locale === 'fr' ? 'Groupes' : 'Groups'}
                  </p>
                  <p className="text-2xl font-bold mt-0.5">{groupEntries.length}</p>
                </div>
                <div className="px-4 py-3 col-span-2 sm:col-span-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-[0.1em] mb-1.5">
                    {locale === 'ar' ? 'حسب المجموعة' : locale === 'fr' ? 'Par groupe' : 'By Group'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {groupEntries.slice(0, 8).map(([group, count]) => (
                      <span
                        key={group}
                        className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 border border-border"
                      >
                        <span className="font-medium">{group}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </span>
                    ))}
                    {groupEntries.length > 8 && (
                      <span className="text-xs text-muted-foreground px-1">
                        {locale === 'ar'
                          ? `+${groupEntries.length - 8} إضافية`
                          : locale === 'fr'
                            ? `+${groupEntries.length - 8} de plus`
                            : `+${groupEntries.length - 8} more`}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Channel table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground w-10">
                        #
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        {locale === 'ar' ? 'القناة' : locale === 'fr' ? 'Chaîne' : 'Channel'}
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground hidden sm:table-cell">
                        {locale === 'ar' ? 'المجموعة' : locale === 'fr' ? 'Groupe' : 'Group'}
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground hidden md:table-cell">
                        {locale === 'ar' ? 'رابط البث' : locale === 'fr' ? 'URL du flux' : 'Stream URL'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {channels.map((ch, idx) => {
                      const logo = ch.tvgLogo || ch.channelImg || null;
                      return (
                        <tr key={ch._id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5 text-muted-foreground text-xs tabular-nums">
                            {ch.order != null ? ch.order : idx + 1}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              {logo ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={logo}
                                  alt=""
                                  className="w-6 h-6 object-contain flex-shrink-0 bg-muted"
                                />
                              ) : (
                                <div className="w-6 h-6 bg-muted/60 flex-shrink-0 border border-border" />
                              )}
                              <span className="font-medium">{ch.channelName}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 hidden sm:table-cell">
                            <span className="text-xs bg-muted px-1.5 py-0.5 border border-border text-muted-foreground">
                              {ch.channelGroup ||
                                (locale === 'ar' ? 'غير مصنّف' : locale === 'fr' ? 'Non catégorisé' : 'Uncategorized')}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 hidden md:table-cell">
                            {ch.channelUrl ? (
                              <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px] block">
                                {ch.channelUrl}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

      <ConfirmDialog
        open={showRegenerateConfirm}
        onCancel={() => setShowRegenerateConfirm(false)}
        onConfirm={handleRegenerateCode}
        title={locale === 'ar' ? 'إعادة توليد الرمز' : locale === 'fr' ? 'Régénérer le code' : 'Regenerate Code'}
        message={
          locale === 'ar'
            ? 'إعادة توليد رمز قائمة القنوات؟ سيتوقف الرمز القديم عن العمل.'
            : locale === 'fr'
              ? 'Régénérer le code de la liste de chaînes ? L’ancien code cessera de fonctionner.'
              : 'Regenerate channel list code? The old code will stop working.'
        }
        confirmLabel={locale === 'ar' ? 'إعادة توليد' : locale === 'fr' ? 'Régénérer' : 'Regenerate'}
        variant="destructive"
      />
    </div>
  );
}
