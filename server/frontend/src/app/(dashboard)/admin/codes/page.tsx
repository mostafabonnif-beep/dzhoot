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
  status: 'UNUSED' | 'ACTIVATED' | 'REVOKED' | 'EXPIRED';
  activatedAt?: string | null;
  activatedBy?: { _id: string; username: string } | null;
  codeExpiresAt?: string | null;
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

const inputClass =
  'flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary';

function statusBadge(status: CodeData['status']) {
  const map: Record<CodeData['status'], string> = {
    UNUSED: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    ACTIVATED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    REVOKED: 'bg-destructive/15 text-destructive',
    EXPIRED: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-medium ${map[status]}`}>
      {status}
    </span>
  );
}

function displayCode(prefix: string, last4: string) {
  return `${prefix}-••••-••••-${last4}`;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CodesPage() {
  const { toast } = useToast();
  const { t } = useLocale();
  const [codes, setCodes] = useState<CodeData[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [planFilter, setPlanFilter] = useState('ALL');
  const { search, debouncedSearch, handleSearchChange } = useDebouncedSearch('', 300);

  const [genOpen, setGenOpen] = useState(false);
  const [genPlanId, setGenPlanId] = useState('');
  const [genQuantity, setGenQuantity] = useState('100');
  const [genPrefix, setGenPrefix] = useState('DZHF');
  const [genExpiry, setGenExpiry] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');
  const [generated, setGenerated] = useState<string[] | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<CodeData | null>(null);
  const [revoking, setRevoking] = useState(false);

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
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await api.get(`/admin/activation-codes?${params.toString()}`);
      const body = res.data;
      setCodes(body.data || []);
      setTotalCount(body.totalCount ?? 0);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || 'Failed to load codes', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, planFilter, debouncedSearch, toast]);

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

  useEffect(() => {
    setPage(1);
  }, [statusFilter, planFilter, debouncedSearch]);

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
      setGenError(axiosErr.response?.data?.error || 'Failed to generate codes');
    } finally {
      setGenLoading(false);
    }
  }

  function handleCopyCode(code: string) {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1500);
  }

  function handleDownloadCodes() {
    if (!generated) return;
    downloadCsv('activation-codes.csv', [['code'], ...generated.map((c) => [c])]);
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await api.post(`/admin/activation-codes/${revokeTarget._id}/revoke`);
      toast('Code revoked', 'success');
      setRevokeTarget(null);
      fetchCodes();
      fetchStats();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || 'Failed to revoke code', 'error');
    } finally {
      setRevoking(false);
    }
  }

  const columns: DataTableColumn<CodeData>[] = [
    {
      key: 'code',
      header: 'Code',
      cell: (c) => (
        <div className="min-w-0">
          <div className="font-mono text-sm">{displayCode(c.prefix, c.codeLast4)}</div>
          <div className="text-xs text-muted-foreground truncate">{c._id}</div>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      cell: (c) => {
        const plan = typeof c.planId === 'object' ? c.planId : null;
        return <span>{plan ? plan.name : '—'}</span>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      cell: (c) => statusBadge(c.status),
    },
    {
      key: 'activatedBy',
      header: 'Activated by',
      cell: (c) =>
        typeof c.activatedBy === 'object' && c.activatedBy ? (
          <span>{c.activatedBy.username}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'activatedAt',
      header: 'Activated',
      cell: (c) =>
        c.activatedAt ? (
          <span className="text-xs">{new Date(c.activatedAt).toLocaleString()}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      cell: (c) =>
        c.status === 'UNUSED' || c.status === 'EXPIRED' ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRevokeTarget(c);
            }}
            className="inline-flex items-center gap-1 p-1.5 text-muted-foreground hover:text-destructive"
            title="إلغاء الكود"
          >
            <Ban className="h-4 w-4" />
          </button>
        ) : null,
    },
  ];

  const statChips = stats
    ? [
        { label: 'الإجمالي', value: stats.total, cls: '' },
        { label: 'غير مستخدمة', value: stats.byStatus.UNUSED, cls: 'text-sky-600 dark:text-sky-400' },
        {
          label: 'مفعلة',
          value: stats.byStatus.ACTIVATED,
          cls: 'text-emerald-600 dark:text-emerald-400',
        },
        { label: 'ملغاة', value: stats.byStatus.REVOKED, cls: 'text-destructive' },
        { label: 'منتهية', value: stats.byStatus.EXPIRED, cls: 'text-muted-foreground' },
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">
            أكواد التفعيل
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{totalCount} كود</p>
        </div>
        <button
          onClick={() => {
            setGenOpen(true);
            setGenError('');
            setGenerated(null);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          إنشاء أكواد
        </button>
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            className="w-full h-10 pl-10 pr-4 border border-border bg-card text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
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
      </div>

      <DataTable
        columns={columns}
        data={codes}
        gridTemplate="minmax(200px,1.6fr) minmax(120px,0.8fr) 110px 130px 150px 60px"
        ariaLabel="أكواد التفعيل"
        emptyMessage="لم يتم العثور على أكواد."
        rowKey={(c) => c._id}
      />

      <Pagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={setPage}
      />

      {/* Generate modal */}
      <Modal open={genOpen} onClose={() => setGenOpen(false)} title="إنشاء أكواد">
        <div className="p-5 space-y-4">
          {genError && (
            <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {genError}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              الباقة *
            </label>
            <select
              className={inputClass}
              value={genPlanId}
              onChange={(e) => setGenPlanId(e.target.value)}
            >
              {plans.length === 0 && <option value="">لا توجد باقات متاحة</option>}
              {plans.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} ({p.durationDays} days)
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                الكمية *
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
                البادئة
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
              انتهاء الكود بعدد الأيام — اختياري
            </label>
            <input
              className={inputClass}
              type="number"
              min={1}
              value={genExpiry}
              onChange={(e) => setGenExpiry(e.target.value)}
              placeholder="e.g. 30 — codes must be redeemed before this"
            />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleGenerate}
              disabled={genLoading || !genPlanId || !Number(genQuantity)}
              className="inline-flex items-center px-6 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {genLoading ? 'جارٍ الإنشاء...' : 'إنشاء'}
            </button>
            <button
              onClick={() => setGenOpen(false)}
              disabled={genLoading}
              className="px-6 py-2.5 text-sm font-medium border border-border uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground transition-colors"
            >
              إلغاء
            </button>
          </div>
        </div>
      </Modal>

      {/* Generated codes (shown once) */}
      <Modal
        open={!!generated}
        onClose={() => setGenerated(null)}
        title={`${generated?.length ?? 0} codes generated`}
        size="lg"
      >
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={handleDownloadCodes}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Download className="h-4 w-4" />
              تنزيل CSV
            </button>
            <p className="text-xs text-muted-foreground">
              Codes are shown only once — save them now. The database stores hashes only.
            </p>
          </div>
          <div className="max-h-80 overflow-y-auto border border-border divide-y divide-border">
            {generated?.map((code) => (
              <div
                key={code}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <code className="font-mono text-sm">{code}</code>
                <button
                  onClick={() => handleCopyCode(code)}
                  className="p-1.5 text-muted-foreground hover:text-foreground"
                  title="نسخ الكود"
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
            <p className="text-xs text-muted-foreground">
              Give these codes to customers — they redeem them in the app under
              “Activation Code”.
            </p>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!revokeTarget}
        title="إلغاء الكود"
        message={`Revoke ${revokeTarget ? displayCode(revokeTarget.prefix, revokeTarget.codeLast4) : ''}? It can no longer be redeemed.`}
        confirmLabel="إلغاء"
        variant="destructive"
        loading={revoking}
        onConfirm={handleRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
