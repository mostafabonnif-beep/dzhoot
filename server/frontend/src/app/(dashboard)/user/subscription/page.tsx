'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, KeyRound, Trash2, Smartphone, CheckCircle2 } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

interface SubscriptionView {
  subscription: {
    _id: string;
    status: string;
    startsAt: string;
    expiresAt: string;
  } | null;
  plan: {
    _id: string;
    name: string;
    durationDays: number;
    maxDevices: number;
  } | null;
  devicesUsed: number;
  maxDevices: number;
  devices: {
    _id: string;
    deviceId: string;
    name?: string;
    platform?: string;
    lastSeenAt?: string;
  }[];
}

const inputClass =
  'flex h-11 w-full border border-border bg-background px-3 py-2 text-sm font-mono uppercase focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary';

export default function SubscriptionPage() {
  const { toast } = useToast();
  const [data, setData] = useState<SubscriptionView | null>(null);
  const [loading, setLoading] = useState(true);

  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get('/me/subscription');
      setData(res.data?.data ?? null);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || 'Failed to load subscription', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleRedeem() {
    if (!code.trim()) return;
    setRedeeming(true);
    setRedeemError('');
    setSuccessMsg('');
    try {
      const res = await api.post('/activation/redeem', { code: code.trim() });
      const d = res.data?.data;
      setSuccessMsg(
        `Subscription activated${d?.plan?.name ? ` — ${d.plan.name}` : ''}${
          d?.subscription?.expiresAt
            ? `, expires ${new Date(d.subscription.expiresAt).toLocaleDateString()}`
            : ''
        }`,
      );
      setCode('');
      fetchData();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setRedeemError(axiosErr.response?.data?.error || 'Failed to redeem code');
    } finally {
      setRedeeming(false);
    }
  }

  async function handleRemoveDevice(deviceId: string) {
    try {
      await api.delete(`/me/devices/${encodeURIComponent(deviceId)}`);
      toast('تمت إزالة الجهاز', 'success');
      fetchData();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || 'Failed to remove device', 'error');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasSubscription = !!data?.subscription && data.subscription.status === 'ACTIVE';
  const daysLeft = hasSubscription
    ? Math.max(0, Math.ceil((new Date(data!.subscription!.expiresAt).getTime() - Date.now()) / 86400000))
    : 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">Subscription</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Redeem your activation code and manage your devices.
        </p>
      </div>

      {/* Redeem */}
      <div className="border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium uppercase tracking-[0.15em]">
            Activate code
          </h2>
        </div>
        {successMsg && (
          <div className="flex items-center gap-2 border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {successMsg}
          </div>
        )}
        {redeemError && (
          <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {redeemError}
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            className={inputClass}
            placeholder="DZHF-XXXX-XXXX-XXXX"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRedeem()}
          />
          <button
            onClick={handleRedeem}
            disabled={redeeming || !code.trim()}
            className="inline-flex items-center justify-center px-6 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none sm:w-auto"
          >
            {redeeming ? 'Activating...' : 'Activate'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          The subscription duration starts when the code is activated. Redeeming another code
          before expiry extends your current subscription.
        </p>
      </div>

      {/* Status */}
      <div className="border border-border bg-card p-5">
        {hasSubscription ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm text-muted-foreground uppercase tracking-[0.15em]">
                  Current plan
                </div>
                <div className="text-xl font-bold">{data!.plan?.name ?? '—'}</div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                ACTIVE
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Expires</div>
                <div className="font-medium">
                  {new Date(data!.subscription!.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Days left</div>
                <div className="font-medium">{daysLeft}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Devices</div>
                <div className="font-medium">
                  {data!.devicesUsed} / {data!.maxDevices}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Plan duration</div>
                <div className="font-medium">{data!.plan?.durationDays} days</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <div className="text-sm font-medium">No active subscription</div>
            <p className="text-sm text-muted-foreground mt-1">
              Enter an activation code above to get started.
            </p>
          </div>
        )}
      </div>

      {/* Devices */}
      <div className="border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium uppercase tracking-[0.15em]">Devices</h2>
        </div>
        {data?.devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No devices registered yet. Devices register when you activate a code or start
            watching.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {data?.devices.map((d) => (
              <li key={d._id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {d.name || d.deviceId}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {d.platform || 'device'} · {d.deviceId}
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveDevice(d.deviceId)}
                  className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                  title="Remove device"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
