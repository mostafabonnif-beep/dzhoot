'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldOff, Trash2 } from 'lucide-react';
import api from '@/lib/api';

interface Device {
  _id: string;
  deviceId: string;
  name?: string;
  platform?: string;
  appVersion?: string;
  lastSeenAt?: string;
  createdAt: string;
  credentialExpiresAt?: string | null;
  credentialRevokedAt?: string | null;
  userId?: { username?: string; email?: string };
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    try {
      setLoading(true);
      const res = await api.get('/admin/devices?limit=200');
      setDevices(res.data?.data || []);
      setError('');
    } catch {
      setError('Failed to load devices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function revoke(id: string) {
    if (!window.confirm('Revoke this device credential? The device will stop authenticating immediately.')) return;
    await api.post(`/admin/devices/${encodeURIComponent(id)}/revoke`);
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this device record?')) return;
    await api.delete(`/admin/devices/${encodeURIComponent(id)}`);
    await load();
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">Devices</h1>
        <p className="text-sm text-muted-foreground mt-1">Registered device credentials and lifecycle management</p>
      </div>
      {error && <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
      <div className="border border-border divide-y divide-border">
        {devices.length === 0 ? <div className="px-4 py-10 text-center text-sm text-muted-foreground">No registered devices</div> : devices.map((d) => (
          <div key={d._id} className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="font-medium truncate">{d.name || d.deviceId}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {d.userId?.username || d.userId?.email || 'Unknown user'} · {d.platform || 'unknown'} · {d.appVersion || 'unknown'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Last seen: {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}
                {' · '}Credential: {d.credentialRevokedAt ? 'REVOKED' : 'ACTIVE'}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {!d.credentialRevokedAt && <button onClick={() => void revoke(d._id)} className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs hover:bg-muted"><ShieldOff className="h-4 w-4" />Revoke</button>}
              <button onClick={() => void remove(d._id)} className="inline-flex items-center gap-2 border border-destructive/40 px-3 py-2 text-xs text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" />Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
