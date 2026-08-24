'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Plus,
  Search,
  KeyRound,
  Copy,
  Check,
  Download,
  Ban,
  Eye,
  EyeOff,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';
import Modal from '@/components/ui/modal';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import Pagination from '@/components/ui/pagination';
import DataTable, { type DataTableColumn } from '@/components/ui/data-table';
import { useLocale } from '@/components/locale-provider';

interface CodeData {
  _id: string;
  prefix: string;
  codeLast4: string;
  planId: { _id: string; name: string; durationDays: number; maxDevices: number } | string;
  resellerId?: { _id: string; name: string; city?: string } | string | null;
  batchId?: { _id: string; batchNumber: number; receiptDate?: string | null } | string | null;
  status: 'UNUSED' | 'ACTIVATED' | 'REVOKED' | 'EXPIRED';
  activatedAt?: string | null;
  activatedBy?: { _id: string; username: string } | null;
  codeExpiresAt?: string | null;
  notes?: string | null;
  createdAt?: string;
}

interface StatsData {
  total: number;
  byStatus: { UNUSED: number; ACTIVATED: number; REVOKED: number; EXPIRED: number };
}

interface PlanOption {
  _id: string;
  name: string;
  durationDays: number;
}

interface ResellerOption {
  _id: string;
  name: string;
  city?: string;
  status: 'Active' | 'Inactive';
}

const inputClass =
  'flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary';

const STATUS_KEYS: Record<CodeData['status'], string> = {
  UNUSED: 'codes.unused',
  ACTIVATED: 'codes.activated',
  REVOKED: 'codes.revoked',
  EXPIRED: 'codes.expired',
};

function statusBadge(status: CodeData['status'], t: (k: string) => string) {
  const map: Record<CodeData['status'], string> = {
    UNUSED: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    ACTIVATED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    REVOKED: 'bg-destructive/15 text-destructive',
    EXPIRED: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-medium ${map[status]}`}>
      {t(STATUS_KEYS[status])}
    </span>
  );
}

function displayCode(prefix: string, last4: string) {
  return `${prefix}-••••-••••-${last4}`;
}

export default function CodesPage() {
  const { toast } = useToast();
  const { t, locale } = useLocale();
  const [codes, setCodes] = useState<CodeData[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [resellers, setResellers] = useState<ResellerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [planFilter, setPlanFilter] = useState('ALL');
  const [resellerFilter, setResellerFilter] = useState('ALL');
  const { search, debouncedSearch, handleSearchChange } = useDebouncedSearch('', 300);

  // Reveal state: map of codeId -> plaintext, plus per-row reveal loading
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Generate modal
  const [genOpen, setGenOpen] = useState(false);
  const [genPlanId, setGenPlanId] = useState('');
  const [genQuantity, setGenQuantity] = useState('100');
  const [genPrefix, setGenPrefix] = useState('DZHF');
  const [genExpiry, setGenExpiry] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');
  const [generated, setGenerated] = useState<string[] | null>(null);

  // Edit modal
  const [editTarget, setEditTarget] = useState<CodeData | null>(null);
  const [editPlanId, setEditPlanId] = useState('');
  const [editExpiry, setEditExpiry] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  // Confirm dialogs
  const [revokeTarget, setRevokeTarget] = useState<CodeData | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<CodeData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CodeData | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Bulk selection
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Clear selection when the visible page or filters change.
  useEffect(() => {
    setSelectedCodes(new Set());
  }, [page, debouncedSearch, statusFilter, planFilter, resellerFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/admin/activation-codes/stats');
      setStats(res.data?.data ?? null);
    } catch {
      // stats are decorative; ignore
    }
  }, []);

  const fetchCodes = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (planFilter !== 'ALL') params.set('planId', planFilter);
      if (resellerFilter !== 'ALL') params.set('resellerId', resellerFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await api.get(`/admin/activation-codes?${params.toString()}`);
      const body = res.data;
      setCodes(body.data || []);
      setTotalCount(body.totalCount ?? 0);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || t('codes.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, planFilter, resellerFilter, debouncedSearch, toast, t]);

  useEffect(() => {
    fetchCodes();
    fetchStats();
  }, [fetchCodes, fetchStats]);

  // Load plan options for the generate form + filter
  useEffect(() => {
    api
      .get('/admin/plans')
      .then((res) => {
        const data = res.data?.data || [];
        setPlans(data);
        if (data.length > 0) setGenPlanId(data[0]._id);
      })
      .catch(() => {});
  }, []);

  // Load reseller options for the filter
  useEffect(() => {
    api
      .get('/admin/resellers')
      .then((res) => {
        setResellers(res.data?.data || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, planFilter, resellerFilter, debouncedSearch]);

  function copyText(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 1500);
  }

  async function handleReveal(c: CodeData) {
    if (revealed[c._id]) {
      // toggle off
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[c._id];
        return next;
      });
      return;
    }
    setRevealingId(c._id);
    try {
      const res = await api.get(`/admin/activation-codes/${c._id}/reveal`);
      const plain = res.data?.data?.code;
      if (plain) {
        setRevealed((prev) => ({ ...prev, [c._id]: plain }));
      } else {
        toast(t('codes.revealUnavailable'), 'error');
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || t('codes.revealUnavailable'), 'error');
    } finally {
      setRevealingId(null);
    }
  }

  async function handleGenerate() {
    setGenLoading(true);
    setGenError('');
    try {
      const res = await api.post('/admin/activation-codes/generate', {
        planId: genPlanId,
        quantity: Number(genQuantity),
        prefix: genPrefix || 'DZHF',
        codeExpiresInDays: genExpiry ? Number(genExpiry) : null,
      });
      const data = res.data?.data;
      setGenerated(data?.codes || []);
      setGenOpen(false);
      setGenQuantity('100');
      fetchCodes();
      fetchStats();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setGenError(axiosErr.response?.data?.error || t('codes.generateError'));
    } finally {
      setGenLoading(false);
    }
  }

  function openEdit(c: CodeData) {
    setEditTarget(c);
    setEditPlanId(typeof c.planId === 'object' ? c.planId._id : String(c.planId));
    setEditExpiry(c.codeExpiresAt ? c.codeExpiresAt.slice(0, 10) : '');
    setEditNotes(c.notes || '');
    setEditError('');
  }

  async function handleEditSave() {
    if (!editTarget) return;
    setEditLoading(true);
    setEditError('');
    try {
      await api.patch(`/admin/activation-codes/${editTarget._id}`, {
        planId: editPlanId,
        codeExpiresAt: editExpiry ? editExpiry : null,
        notes: editNotes || null,
      });
      toast(t('codes.updateSuccess'), 'success');
      setEditTarget(null);
      fetchCodes();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setEditError(axiosErr.response?.data?.error || t('codes.updateError'));
    } finally {
      setEditLoading(false);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setActionLoading(true);
    try {
      await api.post(`/admin/activation-codes/${revokeTarget._id}/revoke`);
      toast(t('codes.revokeSuccess'), 'success');
      setRevokeTarget(null);
      fetchCodes();
      fetchStats();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || t('codes.revokeError'), 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRestore() {
    if (!restoreTarget) return;
    setActionLoading(true);
    try {
      await api.post(`/admin/activation-codes/${restoreTarget._id}/restore`);
      toast(t('codes.restoreSuccess'), 'success');
      setRestoreTarget(null);
      fetchCodes();
      fetchStats();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || t('codes.restoreError'), 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await api.delete(`/admin/activation-codes/${deleteTarget._id}`);
      toast(t('codes.deleteSuccess'), 'success');
      setDeleteTarget(null);
      fetchCodes();
      fetchStats();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || t('codes.deleteError'), 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleBulkCodeAction(action: 'revoke' | 'restore') {
    if (selectedCodes.size === 0) return;
    const ids = Array.from(selectedCodes);
    if (action === 'revoke') {
      const ok = window.confirm(
        locale === 'ar'
          ? `سيتم إلغاء ${ids.length} كود (الأكواد المفعّلة تُستثنى). هل تريد المتابعة؟`
          : locale === 'fr'
            ? `${ids.length} codes seront révoqués (les codes activés sont exclus). Continuer ?`
            : `${ids.length} codes will be revoked (activated codes are excluded). Continue?`,
      );
      if (!ok) return;
    }
    setBulkActionLoading(true);
    try {
      const endpoint =
        action === 'revoke' ? '/admin/activation-codes/bulk-revoke' : '/admin/activation-codes/bulk-restore';
      const res = await api.post(endpoint, { ids, confirmed: action === 'revoke' });
      const count = action === 'revoke' ? res.data?.revokedCount : res.data?.restoredCount;
      toast(
        locale === 'ar'
          ? action === 'revoke'
            ? `تم إلغاء ${count ?? ids.length} كود`
            : `تمت استعادة ${count ?? ids.length} كود`
          : locale === 'fr'
            ? action === 'revoke'
              ? `${count ?? ids.length} codes révoqués`
              : `${count ?? ids.length} codes restaurés`
            : action === 'revoke'
              ? `Revoked ${count ?? ids.length} codes`
              : `Restored ${count ?? ids.length} codes`,
        'success',
      );
      setSelectedCodes(new Set());
      await Promise.all([fetchCodes(), fetchStats()]);
    } catch {
      toast(t('codes.revokeError'), 'error');
    } finally {
      setBulkActionLoading(false);
    }
  }

  async function handleExportCsv() {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (planFilter !== 'ALL') params.set('planId', planFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await api.get(`/admin/activation-codes/export/csv?${params.toString()}`, {
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'activation-codes.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast(t('codes.exportSuccess'), 'success');
    } catch {
      toast(t('codes.exportError'), 'error');
    }
  }

  function downloadGeneratedCsv() {
    if (!generated) return;
    const csv = ['code', ...generated].map((c) => `"${c}"`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'activation-codes.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const columns: DataTableColumn<CodeData>[] = [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          aria-label={
            locale === 'ar'
              ? 'تحديد كل الأكواد في هذه الصفحة'
              : locale === 'fr'
                ? 'Sélectionner tous les codes de cette page'
                : 'Select all codes on this page'
          }
          checked={codes.length > 0 && codes.every((c) => selectedCodes.has(c._id))}
          onChange={(e) => {
            const next = new Set(selectedCodes);
            if (e.target.checked) codes.forEach((c) => next.add(c._id));
            else codes.forEach((c) => next.delete(c._id));
            setSelectedCodes(next);
          }}
          className="accent-primary"
        />
      ),
      cell: (c) => (
        <input
          type="checkbox"
          aria-label={`Select ${c.codeLast4}`}
          checked={selectedCodes.has(c._id)}
          onChange={(e) => {
            const next = new Set(selectedCodes);
            if (e.target.checked) next.add(c._id);
            else next.delete(c._id);
            setSelectedCodes(next);
          }}
          className="accent-primary"
        />
      ),
    },
    {
      key: 'code',
      header: t('codes.code'),
      cell: (c) => {
        const plain = revealed[c._id];
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sm" dir="ltr">
                {plain || displayCode(c.prefix, c.codeLast4)}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleReveal(c);
                }}
                className="p-1 text-muted-foreground hover:text-foreground"
                title={plain ? t('codes.hide') : t('codes.reveal')}
                disabled={revealingId === c._id}
              >
                {revealingId === c._id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : plain ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
              {plain && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copyText(plain);
                  }}
                  className="p-1 text-muted-foreground hover:text-foreground"
                  title={t('codes.copy')}
                >
                  {copiedCode === plain ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
            {c.notes && (
              <div className="text-xs text-muted-foreground truncate mt-0.5">{c.notes}</div>
            )}
          </div>
        );
      },
    },
    {
      key: 'plan',
      header: t('codes.plan'),
      cell: (c) => {
        const plan = typeof c.planId === 'object' ? c.planId : null;
        return <span>{plan ? plan.name : '—'}</span>;
      },
    },
    {
      key: 'reseller',
      mobileHidden: true,
      header: t('codes.reseller'),
      cell: (c) => {
        const reseller = typeof c.resellerId === 'object' && c.resellerId ? c.resellerId : null;
        return reseller ? (
          <div className="min-w-0">
            <div className="truncate">{reseller.name}</div>
            {reseller.city && (
              <div className="text-xs text-muted-foreground truncate">{reseller.city}</div>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      key: 'batch',
      header: t('codes.batch'),
      cell: (c) => {
        const batch = typeof c.batchId === 'object' && c.batchId ? c.batchId : null;
        return batch ? (
          <span className="text-sm whitespace-nowrap">#{batch.batchNumber}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
      mobileHidden: true,
    },
    {
      key: 'status',
      header: t('codes.status'),
      cell: (c) => statusBadge(c.status, t),
    },
    {
      key: 'activatedBy',
      header: t('codes.activatedBy'),
      cell: (c) =>
        typeof c.activatedBy === 'object' && c.activatedBy ? (
          <span>{c.activatedBy.username}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'codeExpiresAt',
      mobileHidden: true,
      header: t('codes.expiresAt'),
      cell: (c) =>
        c.codeExpiresAt ? (
          <span className="text-xs">{new Date(c.codeExpiresAt).toLocaleDateString()}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      cell: (c) => (
        <div className="flex items-center gap-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEdit(c);
            }}
            className="inline-flex items-center p-1.5 text-muted-foreground hover:text-foreground"
            title={t('codes.edit')}
          >
            <Pencil className="h-4 w-4" />
          </button>
          {(c.status === 'UNUSED' || c.status === 'EXPIRED') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setRevokeTarget(c);
              }}
              className="inline-flex items-center p-1.5 text-muted-foreground hover:text-destructive"
              title={t('codes.revoke')}
            >
              <Ban className="h-4 w-4" />
            </button>
          )}
          {(c.status === 'REVOKED' || c.status === 'EXPIRED') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setRestoreTarget(c);
              }}
              className="inline-flex items-center p-1.5 text-muted-foreground hover:text-emerald-500"
              title={t('codes.restore')}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          {c.status !== 'ACTIVATED' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(c);
              }}
              className="inline-flex items-center p-1.5 text-muted-foreground hover:text-destructive"
              title={t('codes.delete')}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const statChips =
    stats && stats.byStatus
      ? [
          { label: t('codes.total'), value: stats.total, cls: '' },
          { label: t('codes.unused'), value: stats.byStatus.UNUSED, cls: 'text-sky-600 dark:text-sky-400' },
          {
            label: t('codes.activated'),
            value: stats.byStatus.ACTIVATED,
            cls: 'text-emerald-600 dark:text-emerald-400',
          },
          { label: t('codes.revoked'), value: stats.byStatus.REVOKED, cls: 'text-destructive' },
          { label: t('codes.expired'), value: stats.byStatus.EXPIRED, cls: 'text-muted-foreground' },
        ]
      : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">
            {t('codes.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalCount} {t('codes.code')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.1em] border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            <Download className="h-4 w-4" />
            {t('codes.exportCsv')}
          </button>
          <button
            onClick={() => {
              setGenOpen(true);
              setGenError('');
              setGenerated(null);
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t('codes.generate')}
          </button>
        </div>
      </div>

      {statChips.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {statChips.map((s) => (
            <div key={s.label} className="border border-border bg-card px-4 py-3">
              <div className={`text-2xl font-bold ${s.cls}`}>{s.value}</div>
              <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground mt-0.5">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            className="w-full h-10 ps-10 pe-4 border border-border bg-card text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
            placeholder={t('codes.searchPlaceholder')}
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <select
          className={`${inputClass} sm:w-44`}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="ALL">{t('codes.allStatuses')}</option>
          <option value="UNUSED">{t('codes.unused')}</option>
          <option value="ACTIVATED">{t('codes.activated')}</option>
          <option value="REVOKED">{t('codes.revoked')}</option>
          <option value="EXPIRED">{t('codes.expired')}</option>
        </select>
        <select
          className={`${inputClass} sm:w-52`}
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
        >
          <option value="ALL">{t('codes.allPlans')}</option>
          {plans.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className={`${inputClass} sm:w-48`}
          value={resellerFilter}
          onChange={(e) => setResellerFilter(e.target.value)}
        >
          <option value="ALL">{t('codes.allResellers')}</option>
          {resellers.map((r) => (
            <option key={r._id} value={r._id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {selectedCodes.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border border-primary/40 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium">
            {locale === 'ar'
              ? `${selectedCodes.size} كود محدد`
              : locale === 'fr'
                ? `${selectedCodes.size} codes sélectionnés`
                : `${selectedCodes.size} codes selected`}
          </span>
          <span className="flex-1" />
          <button
            onClick={() => handleBulkCodeAction('revoke')}
            disabled={bulkActionLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-destructive/40 text-destructive hover:bg-destructive/5 disabled:opacity-50 transition-colors"
          >
            {locale === 'ar' ? 'إلغاء جماعي' : locale === 'fr' ? 'Révoquer' : 'Bulk revoke'}
          </button>
          <button
            onClick={() => handleBulkCodeAction('restore')}
            disabled={bulkActionLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-signal-green/40 text-signal-green hover:bg-signal-green/5 disabled:opacity-50 transition-colors"
          >
            {locale === 'ar' ? 'استعادة جماعية' : locale === 'fr' ? 'Restaurer' : 'Bulk restore'}
          </button>
          <button
            onClick={() => setSelectedCodes(new Set())}
            disabled={bulkActionLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            {locale === 'ar' ? 'إلغاء التحديد' : locale === 'fr' ? 'Désélectionner' : 'Clear selection'}
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={codes}
        gridTemplate="40px minmax(220px,1.6fr) minmax(110px,0.8fr) minmax(120px,0.9fr) 90px 110px 140px 110px 130px"
        ariaLabel={t('codes.title')}
        emptyMessage={t('codes.empty')}
        rowKey={(c) => c._id}
      />

      <Pagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={setPage}
      />

      {/* Generate modal */}
      <Modal open={genOpen} onClose={() => setGenOpen(false)} title={t('codes.generate')}>
        <div className="p-5 space-y-4">
          {genError && (
            <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {genError}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('codes.plan')} *
            </label>
            <select
              className={inputClass}
              value={genPlanId}
              onChange={(e) => setGenPlanId(e.target.value)}
            >
              {plans.length === 0 && <option value="">{t('codes.noPlans')}</option>}
              {plans.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} ({p.durationDays} {t('codes.days')})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {t('codes.quantity')} *
              </label>
              <input
                className={inputClass}
                type="number"
                min={1}
                max={10000}
                value={genQuantity}
                onChange={(e) => setGenQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {t('codes.prefix')}
              </label>
              <input
                className={inputClass}
                value={genPrefix}
                maxLength={8}
                onChange={(e) => setGenPrefix(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('codes.expiryDays')}
            </label>
            <input
              className={inputClass}
              type="number"
              min={1}
              value={genExpiry}
              onChange={(e) => setGenExpiry(e.target.value)}
              placeholder={t('codes.expiryDaysPlaceholder')}
            />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleGenerate}
              disabled={genLoading || !genPlanId || !Number(genQuantity)}
              className="inline-flex items-center px-6 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {genLoading ? t('codes.generating') : t('codes.create')}
            </button>
            <button
              onClick={() => setGenOpen(false)}
              disabled={genLoading}
              className="px-6 py-2.5 text-sm font-medium border border-border uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Generated codes (shown once) */}
      <Modal
        open={!!generated}
        onClose={() => setGenerated(null)}
        title={`${generated?.length ?? 0} ${t('codes.generatedTitle')}`}
        size="lg"
      >
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={downloadGeneratedCsv}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Download className="h-4 w-4" />
              {t('codes.downloadCsv')}
            </button>
            <p className="text-xs text-muted-foreground">{t('codes.generatedNote')}</p>
          </div>
          <div className="max-h-80 overflow-y-auto border border-border divide-y divide-border">
            {generated?.map((code) => (
              <div
                key={code}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <code className="font-mono text-sm" dir="ltr">
                  {code}
                </code>
                <button
                  onClick={() => copyText(code)}
                  className="p-1.5 text-muted-foreground hover:text-foreground"
                  title={t('codes.copy')}
                >
                  {copiedCode === code ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{t('codes.generatedHelp')}</p>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={t('codes.editTitle')}
      >
        <div className="p-5 space-y-4">
          {editError && (
            <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {editError}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('codes.code')}
            </label>
            <div className="font-mono text-sm border border-border bg-muted/40 px-3 py-2" dir="ltr">
              {editTarget
                ? revealed[editTarget._id] ||
                  displayCode(editTarget.prefix, editTarget.codeLast4)
                : ''}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('codes.plan')}
            </label>
            <select
              className={inputClass}
              value={editPlanId}
              onChange={(e) => setEditPlanId(e.target.value)}
            >
              {plans.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} ({p.durationDays} {t('codes.days')})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('codes.expiresAt')}
            </label>
            <input
              className={inputClass}
              type="date"
              value={editExpiry}
              onChange={(e) => setEditExpiry(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('codes.expiryEditHint')}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('codes.notes')}
            </label>
            <textarea
              className="flex min-h-[80px] w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
              value={editNotes}
              maxLength={500}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder={t('codes.notesPlaceholder')}
            />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleEditSave}
              disabled={editLoading}
              className="inline-flex items-center px-6 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {editLoading ? t('common.saving') : t('common.save')}
            </button>
            <button
              onClick={() => setEditTarget(null)}
              disabled={editLoading}
              className="px-6 py-2.5 text-sm font-medium border border-border uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!revokeTarget}
        title={t('codes.revokeTitle')}
        message={`${t('codes.revokeConfirm')} ${
          revokeTarget ? displayCode(revokeTarget.prefix, revokeTarget.codeLast4) : ''
        }`}
        confirmLabel={t('codes.revoke')}
        variant="destructive"
        loading={actionLoading}
        onConfirm={handleRevoke}
        onCancel={() => setRevokeTarget(null)}
      />

      <ConfirmDialog
        open={!!restoreTarget}
        title={t('codes.restoreTitle')}
        message={`${t('codes.restoreConfirm')} ${
          restoreTarget ? displayCode(restoreTarget.prefix, restoreTarget.codeLast4) : ''
        }`}
        confirmLabel={t('codes.restore')}
        loading={actionLoading}
        onConfirm={handleRestore}
        onCancel={() => setRestoreTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('codes.deleteTitle')}
        message={`${t('codes.deleteConfirm')} ${
          deleteTarget ? displayCode(deleteTarget.prefix, deleteTarget.codeLast4) : ''
        }`}
        confirmLabel={t('codes.delete')}
        variant="destructive"
        loading={actionLoading}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
