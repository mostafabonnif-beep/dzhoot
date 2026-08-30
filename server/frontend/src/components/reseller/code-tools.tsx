'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  ArrowLeftRight,
  Ban,
  PlayCircle,
  Download,
  History,
  Check,
  X,
} from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';
import { useToast } from '@/hooks/use-toast';
import Modal from '@/components/ui/modal';

export interface CodeToolsTarget {
  codeId: string;
  code: string;
  planName: string;
  planId?: string;
  status: string;
  expiresAt?: string | null;
}

interface CodeDetail {
  code: string;
  status: string;
  plan: { name: string; durationDays: number } | null;
  customerName: string | null;
  customerPhone: string | null;
  subscription: {
    status: string;
    startsAt: string | null;
    expiresAt: string | null;
    username: string | null;
  } | null;
  redemptions: Array<{ createdAt: string; result: string; deviceId: string | null; failureReason: string | null }>;
  devices: Array<{ deviceId: string; name: string; platform: string; appVersion: string; lastSeenAt: string | null }>;
}

interface Props {
  open: boolean;
  target: CodeToolsTarget | null;
  credit: Array<{ planId: string; quantity: number; plan: { name: string; durationDays: number; allowCustomDuration?: boolean } }>;
  permissions: {
    renew: boolean;
    changePackage: boolean;
    suspend: boolean;
    exportM3U: boolean;
    viewHistory: boolean;
  };
  onClose: () => void;
  onChanged?: () => void;
}

export default function CodeToolsModal({ open, target, credit, permissions, onClose, onChanged }: Props) {
  const { t } = useLocale();
  const { toast } = useToast();
  const [detail, setDetail] = useState<CodeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [customDays, setCustomDays] = useState('');
  const [newPlanId, setNewPlanId] = useState('');

  const loadDetail = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    try {
      const res = await api.get(`/reseller/codes/${target.codeId}`);
      setDetail(res.data?.data || null);
    } catch {
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    if (open && target) {
      setDetail(null);
      setCustomDays('');
      setNewPlanId('');
      loadDetail();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.codeId]);

  function notifyError(err: unknown) {
    const resp = (err as { response?: { data?: { error?: string; code?: string } } })?.response?.data;
    if (resp?.code === 'PERMISSION_DENIED') {
      toast(t('portal.featureDisabled'), 'error');
    } else {
      toast(resp?.error || 'Error', 'error');
    }
  }

  async function doAction(kind: 'renew' | 'change-plan' | 'suspend' | 'reactivate') {
    if (!target) return;
    setBusy(kind);
    try {
      if (kind === 'renew') {
        const body: Record<string, unknown> = {};
        if (customDays.trim()) body.customDays = Number(customDays);
        const res = await api.post(`/reseller/codes/${target.codeId}/renew`, body);
        toast(t('portal.renewSuccess').replace('{date}', new Date(res.data?.data?.expiresAt).toLocaleDateString()), 'success');
      } else if (kind === 'change-plan') {
        if (!newPlanId) {
          toast(t('portal.transferPlan'), 'error');
          setBusy(null);
          return;
        }
        const res = await api.post(`/reseller/codes/${target.codeId}/change-plan`, { planId: newPlanId });
        toast(t('portal.changePlanSuccess').replace('{name}', res.data?.data?.plan?.name || ''), 'success');
      } else if (kind === 'suspend') {
        await api.post(`/reseller/codes/${target.codeId}/suspend`);
        toast(t('portal.suspendSuccess'), 'success');
      } else if (kind === 'reactivate') {
        await api.post(`/reseller/codes/${target.codeId}/reactivate`);
        toast(t('portal.reactivateSuccess'), 'success');
      }
      await loadDetail();
      onChanged?.();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(null);
    }
  }

  async function downloadM3U() {
    if (!target) return;
    setBusy('m3u');
    try {
      const res = await api.get(`/reseller/codes/${target.codeId}/m3u`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data as BlobPart], { type: 'audio/x-mpegurl' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `dzhoof-playlist-${target.code.slice(-6)}.m3u`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(null);
    }
  }

  const subStatus = detail?.subscription?.status || null;
  const currentPlanId = target?.planId;

  return (
    <Modal open={open} onClose={onClose} title={`${t('portal.codeDetail')} — ${target?.code || ''}`} size="lg">
      {loading ? (
        <div className="py-10 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div className="border border-border p-2">
              <div className="text-[11px] text-muted-foreground">{t('portal.ledgerPlan')}</div>
              <div className="text-sm font-medium mt-0.5">{detail?.plan?.name || target?.planName || '—'}</div>
            </div>
            <div className="border border-border p-2">
              <div className="text-[11px] text-muted-foreground">{t('portal.ledgerStatus')}</div>
              <div className="text-sm font-medium mt-0.5">{subStatus || detail?.status || '—'}</div>
            </div>
            <div className="border border-border p-2">
              <div className="text-[11px] text-muted-foreground">{t('portal.clientExpiryCol')}</div>
              <div className="text-sm font-medium mt-0.5" dir="ltr">
                {detail?.subscription?.expiresAt ? new Date(detail.subscription.expiresAt).toLocaleDateString() : '—'}
              </div>
            </div>
            <div className="border border-border p-2">
              <div className="text-[11px] text-muted-foreground">{t('portal.clientTotal')}</div>
              <div className="text-sm font-medium mt-0.5">{detail?.customerName || '—'}</div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {permissions.renew && (
              <div className="flex items-center gap-2 border border-border p-1.5">
                {credit.find((c) => c.planId === target?.planId)?.plan?.allowCustomDuration && (
                  <input
                    type="number"
                    min={1}
                    max={730}
                    placeholder={t('portal.customDays')}
                    className="w-28 h-9 border border-border bg-background px-2 text-sm"
                    value={customDays}
                    onChange={(e) => setCustomDays(e.target.value)}
                    dir="ltr"
                  />
                )}
                <button
                  onClick={() => doAction('renew')}
                  disabled={busy === 'renew'}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-2 border border-primary/40 text-primary hover:bg-primary/5 disabled:opacity-50"
                >
                  {busy === 'renew' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {t('portal.renew')}
                </button>
              </div>
            )}
            {permissions.changePackage && (
              <div className="flex items-center gap-2 border border-border p-1.5">
                <select
                  className="h-9 border border-border bg-background px-2 text-sm max-w-36"
                  value={newPlanId}
                  onChange={(e) => setNewPlanId(e.target.value)}
                >
                  <option value="">{t('portal.changePlan')}…</option>
                  {credit
                    .filter((c) => c.planId !== currentPlanId && c.quantity > 0)
                    .map((c) => (
                      <option key={c.planId} value={c.planId}>
                        {c.plan.name} — {c.plan.durationDays} {t('portal.days')}
                      </option>
                    ))}
                </select>
                <button
                  onClick={() => doAction('change-plan')}
                  disabled={busy === 'change-plan' || !newPlanId}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-2 border border-primary/40 text-primary hover:bg-primary/5 disabled:opacity-50"
                >
                  {busy === 'change-plan' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}
                  {t('portal.changePlan')}
                </button>
              </div>
            )}
            {permissions.suspend && subStatus === 'ACTIVE' && (
              <button
                onClick={() => doAction('suspend')}
                disabled={busy === 'suspend'}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-2 border border-destructive/40 text-destructive hover:bg-destructive/5 disabled:opacity-50"
              >
                {busy === 'suspend' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                {t('portal.suspend')}
              </button>
            )}
            {permissions.suspend && subStatus === 'SUSPENDED' && (
              <button
                onClick={() => doAction('reactivate')}
                disabled={busy === 'reactivate'}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-2 border border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/5 disabled:opacity-50"
              >
                {busy === 'reactivate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                {t('portal.reactivate')}
              </button>
            )}
            {permissions.exportM3U && (
              <button
                onClick={downloadM3U}
                disabled={busy === 'm3u' || !detail?.subscription}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-2 border border-border hover:bg-muted disabled:opacity-50"
              >
                {busy === 'm3u' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {t('portal.m3u')}
              </button>
            )}
          </div>

          {/* Devices / history */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              <History className="h-3.5 w-3.5" /> {t('portal.codeDetail')}
            </div>
            <div className="divide-y divide-border/60">
              {(detail?.devices || []).length > 0 && (
                <div className="px-3 py-2 space-y-1">
                  {detail!.devices.map((d) => (
                    <div key={d.deviceId} className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono" dir="ltr">{d.deviceId}</span>
                      <span className="text-muted-foreground">
                        {d.name || d.platform || '—'}
                        {d.lastSeenAt ? ` · ${new Date(d.lastSeenAt).toLocaleString()}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {(detail?.redemptions || []).length > 0 && (
                <div className="px-3 py-2 space-y-1">
                  {detail!.redemptions.map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-xs">
                      <span className={r.result === 'SUCCESS' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}>
                        {r.result === 'SUCCESS' ? <Check className="h-3 w-3 inline ml-1" /> : <X className="h-3 w-3 inline ml-1" />}
                        {r.result === 'SUCCESS' ? 'Activation' : r.failureReason || 'Failed'}
                      </span>
                      <span className="text-muted-foreground" dir="ltr">{new Date(r.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
              {(detail?.devices || []).length === 0 && (detail?.redemptions || []).length === 0 && (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">—</div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
