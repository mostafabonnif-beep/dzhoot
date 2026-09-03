'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Users, KeyRound, Power } from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';
import { useToast } from '@/hooks/use-toast';

interface SubReseller {
  _id: string;
  username: string;
  name: string;
  status: 'Active' | 'Inactive';
  credit: Array<{ planId: string; quantity: number }>;
  createdAt?: string;
  stats: { total: number; activated: number; remaining: number };
}

const inputClass =
  'flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary';

export default function SubResellersSection() {
  const { t } = useLocale();
  const { toast } = useToast();

  const [subs, setSubs] = useState<SubReseller[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create form
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/reseller/sub-resellers');
      setSubs(res.data?.data || []);
    } catch {
      setSubs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const res = await api.post('/reseller/sub-resellers', { username, password, name });
      toast(`${t('resellersSub.created')} ${res.data?.data?.username}`, 'success');
      setUsername('');
      setPassword('');
      setName('');
      await load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast(msg || t('resellersSub.failed'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const resetPassword = async (sub: SubReseller) => {
    const newPassword = window.prompt(t('resellersSub.newPasswordPrompt'), '');
    if (!newPassword) return;
    setBusyId(sub._id);
    try {
      await api.patch(`/reseller/sub-resellers/${sub._id}`, { action: 'reset-password', newPassword });
      toast(t('resellersSub.passwordReset'), 'success');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast(msg || t('resellersSub.failed'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const toggleStatus = async (sub: SubReseller) => {
    const next = sub.status === 'Active' ? 'Inactive' : 'Active';
    setBusyId(sub._id);
    try {
      await api.patch(`/reseller/sub-resellers/${sub._id}`, { action: 'set-status', status: next });
      toast(`${sub.username}: ${next === 'Active' ? t('resellersSub.activated') : t('resellersSub.deactivated')}`, 'success');
      await load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast(msg || t('resellersSub.failed'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="border border-border bg-card p-4 space-y-4" data-testid="sub-resellers-section">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">{t('resellersSub.title')}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{t('resellersSub.subtitle')}</p>

      {/* Create form */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input
          className={inputClass}
          placeholder={t('resellersSub.username')}
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          dir="ltr"
        />
        <input
          className={inputClass}
          type="password"
          placeholder={t('resellersSub.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          dir="ltr"
        />
        <input
          className={inputClass}
          placeholder={t('resellersSub.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          onClick={create}
          disabled={creating || !username || password.length < 8}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t('resellersSub.create')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : subs.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t('resellersSub.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-start text-muted-foreground">
                <th className="px-3 py-2 text-start font-medium">{t('resellersSub.username')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('resellersSub.name')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('resellersSub.status')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('resellersSub.credit')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('resellersSub.codes')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('resellersSub.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s._id} className="border-b border-border/60">
                  <td className="px-3 py-2 font-mono" dir="ltr">{s.username}</td>
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.status === 'Active'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'bg-red-500/15 text-red-600 dark:text-red-400'
                      }`}
                    >
                      {s.status === 'Active' ? t('resellersSub.active') : t('resellersSub.inactive')}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {(s.credit || []).reduce((sum, c) => sum + (c.quantity || 0), 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {s.stats.activated}/{s.stats.total}
                    <span className="text-muted-foreground"> ({s.stats.remaining})</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => resetPassword(s)}
                        disabled={busyId === s._id}
                        title={t('resellersSub.resetPassword')}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {t('resellersSub.resetPassword')}
                      </button>
                      <button
                        onClick={() => toggleStatus(s)}
                        disabled={busyId === s._id}
                        title={s.status === 'Active' ? t('resellersSub.deactivate') : t('resellersSub.activate')}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        <Power className="h-3.5 w-3.5" />
                        {s.status === 'Active' ? t('resellersSub.deactivate') : t('resellersSub.activate')}
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
  );
}
