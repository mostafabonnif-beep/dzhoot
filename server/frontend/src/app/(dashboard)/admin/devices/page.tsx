'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Monitor, Smartphone, Trash2, RefreshCw, Ban } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useLocale } from '@/components/locale-provider';
import Pagination from '@/components/ui/pagination';
import SearchInput from '@/components/ui/search-input';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';

interface AdminDevice {
  _id: string;
  deviceId: string;
  name: string;
  platform: string;
  appVersion: string;
  lastSeenAt: string | null;
  createdAt: string | null;
  user: { _id: string; username: string; email: string; isActive: boolean } | null;
}

interface PairingRequest {
  _id: string;
  pin?: string;
  deviceName?: string;
  deviceModel?: string;
  status: string;
  createdAt: string | null;
  expiresAt?: string | null;
  user?: { _id: string; username: string; email: string } | null;
}

export default function DevicesPage() {
  const { locale } = useLocale();
  const { toast } = useToast();
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [devicesTotal, setDevicesTotal] = useState(0);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesPage, setDevicesPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [stats, setStats] = useState({ active7d: 0, platforms: 0, pendingPairings: 0 });
  const [unpairingId, setUnpairingId] = useState<string | null>(null);

  const [pairings, setPairings] = useState<PairingRequest[]>([]);
  const [pairingsTotal, setPairingsTotal] = useState(0);
  const [pairingsLoading, setPairingsLoading] = useState(true);
  const [pairingsPage, setPairingsPage] = useState(1);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [error, setError] = useState('');
  const PAGE_SIZE = 50;

  const L = (ar: string, fr: string, en: string) => (locale === 'ar' ? ar : locale === 'fr' ? fr : en);

  const { search, debouncedSearch, handleSearchChange } = useDebouncedSearch('', 300);

  const handleSearchInputChange = useCallback(
    (value: string) => {
      setDevicesPage(1);
      handleSearchChange(value);
    },
    [handleSearchChange],
  );

  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value);
    setDevicesPage(1);
  }, []);

  const fetchDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const res = await api.get('/admin/devices', {
        params: {
          page: devicesPage,
          pageSize: PAGE_SIZE,
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
        },
      });
      const body = res.data;
      setDevices(Array.isArray(body) ? body : body.data || []);
      setDevicesTotal(body.totalCount ?? (Array.isArray(body) ? body.length : 0));
      if (body.stats) setStats(body.stats);
    } catch {
      setError(L('فشل تحميل الأجهزة', 'Échec du chargement des appareils', 'Failed to load devices'));
    } finally {
      setDevicesLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devicesPage, debouncedSearch, statusFilter]);

  const fetchPairings = useCallback(async () => {
    setPairingsLoading(true);
    try {
      const res = await api.get('/admin/pairing-requests', { params: { page: pairingsPage, pageSize: PAGE_SIZE } });
      const body = res.data;
      setPairings(Array.isArray(body) ? body : body.data || []);
      setPairingsTotal(body.totalCount ?? (Array.isArray(body) ? body.length : 0));
    } catch {
      // Pairings endpoint is auxiliary — don't block the page on it.
    } finally {
      setPairingsLoading(false);
    }
  }, [pairingsPage]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  useEffect(() => {
    fetchPairings();
  }, [fetchPairings]);

  async function handleUnpair(device: AdminDevice) {
    const confirmed = window.confirm(
      L(
        `سيتم إلغاء اقتران الجهاز «${device.name || device.deviceId}» وحرر حصة جهاز لصاحبه. هل تريد المتابعة؟`,
        `L’appareil «${device.name || device.deviceId}» sera désassocié et libérera une place pour son propriétaire. Continuer ?`,
        `Device "${device.name || device.deviceId}" will be unpaired and free a device slot for its owner. Continue?`,
      ),
    );
    if (!confirmed) return;
    setUnpairingId(device._id);
    try {
      await api.delete(`/admin/devices/${device._id}`, { data: { confirmed: true } });
      toast(L('تم إلغاء اقتران الجهاز', 'Appareil désassocié', 'Device unpaired'), 'success');
      await fetchDevices();
    } catch {
      toast(L('فشل إلغاء اقتران الجهاز', 'Échec de la désassociation', 'Failed to unpair device'), 'error');
    } finally {
      setUnpairingId(null);
    }
  }

  async function handleRevokePairing(req: PairingRequest) {
    const confirmed = window.confirm(
      L(
        `سيتم إنهاء طلب الاقتران PIN «${req.pin || ''}» (${req.deviceName || req.deviceModel || '—'}). هل تريد المتابعة؟`,
        `La demande d’association PIN «${req.pin || ''}» (${req.deviceName || req.deviceModel || '—'}) sera expirée. Continuer ?`,
        `Pairing request PIN "${req.pin || ''}" (${req.deviceName || req.deviceModel || '—'}) will be expired. Continue?`,
      ),
    );
    if (!confirmed) return;
    setRevokingId(req._id);
    try {
      await api.delete(`/admin/pairing-requests/${req._id}`, { data: { confirmed: true } });
      toast(L('تم إنهاء طلب الاقتران', 'Demande expirée', 'Pairing request expired'), 'success');
      await fetchPairings();
    } catch {
      toast(L('فشل إنهاء الطلب', 'Échec', 'Failed to expire request'), 'error');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">
            {L('الأجهزة', 'Appareils', 'Devices')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {L('الأجهزة المقترنة وطلبات الاقتران', 'Appareils associés et demandes d’association', 'Paired devices and pairing requests')}
          </p>
        </div>
        <button
          onClick={() => {
            fetchDevices();
            fetchPairings();
          }}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-[0.1em] font-medium border border-border hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {L('تحديث', 'Actualiser', 'Refresh')}
        </button>
      </div>

      {error && (
        <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 border border-border">
        {[
          { label: L('الإجمالي', 'Total', 'Total'), value: devicesTotal },
          { label: L('طلبات معلقة', 'Demandes en attente', 'Pending requests'), value: stats.pendingPairings },
          { label: L('الأجهزة النشطة (7 أيام)', 'Actifs (7 j)', 'Active (7d)'), value: stats.active7d },
          { label: L('المنصات', 'Plateformes', 'Platforms'), value: stats.platforms },
        ].map((m, i) => (
          <div key={m.label} className={`p-4 ${i > 0 ? 'border-l border-border' : ''}`}>
            <dl>
              <dt className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{m.label}</dt>
              <dd className="text-2xl font-display font-bold mt-1.5 tabular-nums">{m.value}</dd>
            </dl>
          </div>
        ))}
      </div>

      {/* Registered devices */}
      <div className="border border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-muted/50">
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            {L('الأجهزة المقترنة', 'Appareils associés', 'Registered devices')}
            <span className="ms-2 text-muted-foreground/70">({devicesTotal})</span>
          </h2>
        </div>

        {/* Search + status filter */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 border-b border-border">
          <div className="w-full sm:max-w-xs">
            <SearchInput
              value={search}
              onChange={handleSearchInputChange}
              placeholder={L('بحث بالاسم أو المعرف أو المنصة…', 'Rechercher par nom, ID ou plateforme…', 'Search by name, ID or platform…')}
              ariaLabel={L('بحث في الأجهزة', 'Rechercher des appareils', 'Search devices')}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            aria-label={L('حالة الجهاز', 'Statut de l’appareil', 'Device status')}
            className="h-10 w-full sm:w-48 border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
          >
            <option value="">{L('الكل', 'Tous', 'All')}</option>
            <option value="active">{L('النشطون (7 أيام)', 'Actifs (7 j)', 'Active (7d)')}</option>
            <option value="stale">{L('خامل', 'Inactifs', 'Stale')}</option>
          </select>
        </div>

        {devicesLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : devices.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            <Monitor className="h-8 w-8 mx-auto mb-2 opacity-30" />
            {L('لا توجد أجهزة مقترنة بعد.', 'Aucun appareil associé.', 'No paired devices yet.')}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {devices.map((d) => (
              <div key={d._id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Smartphone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{d.name || d.deviceId}</p>
                    <p className="text-xs text-muted-foreground truncate" dir="ltr">
                      {d.deviceId}
                      {d.platform ? ` · ${d.platform}` : ''}
                      {d.appVersion ? ` · v${d.appVersion}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-end">
                    <p className="text-xs text-muted-foreground">
                      {d.user ? d.user.username : L('مستخدم محذوف', 'Utilisateur supprimé', 'Deleted user')}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70">
                      {d.lastSeenAt
                        ? `${L('آخر ظهور', 'Vu', 'Last seen')}: ${new Date(d.lastSeenAt).toLocaleString()}`
                        : '—'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleUnpair(d)}
                    disabled={unpairingId === d._id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-destructive/40 text-destructive hover:bg-destructive/5 disabled:opacity-50 transition-colors"
                    title={L('إلغاء الاقتران', 'Désassocier', 'Unpair')}
                  >
                    {unpairingId === d._id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Ban className="h-3.5 w-3.5" />
                    )}
                    {L('إلغاء الاقتران', 'Désassocier', 'Unpair')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {devicesTotal > PAGE_SIZE && (
          <div className="border-t border-border px-4 py-3">
            <Pagination page={devicesPage} pageSize={PAGE_SIZE} totalCount={devicesTotal} onPageChange={setDevicesPage} />
          </div>
        )}
      </div>

      {/* Pairing requests */}
      <div className="border border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-muted/50">
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            {L('طلبات الاقتران', 'Demandes d’association', 'Pairing requests')}
            <span className="ms-2 text-muted-foreground/70">({pairingsTotal})</span>
          </h2>
        </div>

        {pairingsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : pairings.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {L('لا توجد طلبات اقتران.', 'Aucune demande d’association.', 'No pairing requests.')}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {pairings.map((r) => (
              <div key={r._id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                      r.status === 'completed'
                        ? 'bg-signal-green'
                        : r.status === 'pending'
                          ? 'bg-primary'
                          : 'bg-signal-red'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {r.deviceName || L('جهاز غير معروف', 'Appareil inconnu', 'Unknown device')}
                      {r.deviceModel ? ` — ${r.deviceModel}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      PIN: <code className="font-mono" dir="ltr">{r.pin || '—'}</code>
                      {r.user ? ` · ${r.user.username}` : ''}
                      {r.createdAt ? ` · ${new Date(r.createdAt).toLocaleString()}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-[11px] uppercase tracking-wide px-1.5 py-0.5 border ${
                      r.status === 'completed'
                        ? 'border-signal-green/30 text-signal-green'
                        : r.status === 'pending'
                          ? 'border-primary/40 text-primary'
                          : 'border-border text-muted-foreground'
                    }`}
                  >
                    {r.status === 'completed'
                      ? L('مكتملة', 'Terminée', 'Completed')
                      : r.status === 'pending'
                        ? L('معلقة', 'En attente', 'Pending')
                        : L('منتهية', 'Expirée', 'Expired')}
                  </span>
                  {r.status === 'pending' && (
                    <button
                      onClick={() => handleRevokePairing(r)}
                      disabled={revokingId === r._id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-destructive/40 text-destructive hover:bg-destructive/5 disabled:opacity-50 transition-colors"
                      title={L('إنهاء الطلب', 'Expirer', 'Expire request')}
                    >
                      {revokingId === r._id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      {L('إنهاء', 'Expirer', 'Expire')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {pairingsTotal > PAGE_SIZE && (
          <div className="border-t border-border px-4 py-3">
            <Pagination page={pairingsPage} pageSize={PAGE_SIZE} totalCount={pairingsTotal} onPageChange={setPairingsPage} />
          </div>
        )}
      </div>
    </div>
  );
}
