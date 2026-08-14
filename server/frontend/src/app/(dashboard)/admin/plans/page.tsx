'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Pencil, Copy, Check } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import Modal from '@/components/ui/modal';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import DataTable, { type DataTableColumn } from '@/components/ui/data-table';
import { useLocale } from '@/components/locale-provider';

interface ContentScope {
  mode?: 'all' | 'selected';
  channelIds?: string[];
  movieIds?: string[];
  seriesIds?: string[];
}

interface PlanData {
  _id: string;
  name: string;
  description?: string;
  durationDays: number;
  maxDevices: number;
  price?: number;
  currency?: string;
  status: 'Active' | 'Inactive';
  features?: { contentScope?: ContentScope };
  codeCount?: number;
  usedCodeCount?: number;
  activeSubs?: number;
  createdAt?: string;
}

interface PlanForm {
  name: string;
  description: string;
  durationDays: string;
  maxDevices: string;
  price: string;
  currency: string;
  status: 'Active' | 'Inactive';
  contentMode: 'all' | 'selected';
  channelIds: string[];
  movieIds: string[];
  seriesIds: string[];
}

const emptyForm: PlanForm = {
  name: '',
  description: '',
  durationDays: '30',
  maxDevices: '1',
  price: '0',
  currency: 'DZD',
  status: 'Active',
  contentMode: 'all',
  channelIds: [],
  movieIds: [],
  seriesIds: [],
};

const inputClass =
  'flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary';

export default function PlansPage() {
  const { toast } = useToast();
  const { t } = useLocale();
  const [plans, setPlans] = useState<PlanData[]>([]);
  const [contentOptions, setContentOptions] = useState<{ channels: { _id: string; channelName?: string }[]; movies: { _id: string; title?: string }[]; series: { _id: string; title?: string }[] }>({ channels: [], movies: [], series: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<PlanData | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchPlans = useCallback(async () => {
    try {
      const res = await api.get('/admin/plans');
      const body = res.data;
      setPlans(body.data || []);
      setTotalCount(body.totalCount ?? 0);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr.response?.data?.error || 'Failed to load plans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
    Promise.all([
      api.get('/channels'),
      api.get('/catalog/movies?limit=100'),
      api.get('/catalog/series?limit=100'),
    ]).then(([channelsRes, moviesRes, seriesRes]) => {
      setContentOptions({
        channels: channelsRes.data?.data || [],
        movies: moviesRes.data?.data || [],
        series: seriesRes.data?.data || [],
      });
    }).catch(() => {
      // Content selection remains optional; the plan can still use the full catalog.
    });
  }, [fetchPlans]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(plan: PlanData) {
    setEditingId(plan._id);
    setForm({
      name: plan.name,
      description: plan.description || '',
      durationDays: String(plan.durationDays),
      maxDevices: String(plan.maxDevices),
      price: String(plan.price ?? 0),
      currency: plan.currency || 'DZD',
      status: plan.status,
      contentMode: plan.features?.contentScope?.mode === 'selected' ? 'selected' : 'all',
      channelIds: plan.features?.contentScope?.channelIds || [],
      movieIds: plan.features?.contentScope?.movieIds || [],
      seriesIds: plan.features?.contentScope?.seriesIds || [],
    });
    setFormError('');
    setFormOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description,
        durationDays: Number(form.durationDays),
        maxDevices: Number(form.maxDevices) || 1,
        price: Number(form.price) || 0,
        currency: form.currency.toUpperCase(),
        status: form.status,
        features: {
          contentScope: {
            mode: form.contentMode,
            channelIds: form.contentMode === 'selected' ? form.channelIds : [],
            movieIds: form.contentMode === 'selected' ? form.movieIds : [],
            seriesIds: form.contentMode === 'selected' ? form.seriesIds : [],
          },
        },
      };
      if (editingId) {
        await api.patch(`/admin/plans/${editingId}`, payload);
        toast('Plan updated', 'success');
      } else {
        await api.post('/admin/plans', payload);
        toast('Plan created', 'success');
      }
      setFormOpen(false);
      fetchPlans();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setFormError(axiosErr.response?.data?.error || 'Failed to save plan');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api.delete(`/admin/plans/${deleteTarget._id}`);
      const data = res.data?.data;
      toast(
        data?.deactivated
          ? `Plan has codes — deactivated instead of deleted`
          : 'Plan deleted',
        'success',
      );
      setDeleteTarget(null);
      fetchPlans();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || 'Failed to delete plan', 'error');
    } finally {
      setDeleting(false);
    }
  }

  function handleCopyId(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    navigator.clipboard.writeText(id).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  const columns: DataTableColumn<PlanData>[] = [
    {
      key: 'name',
      header: 'Plan',
      cell: (p) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{p.name}</div>
          {p.description && (
            <div className="text-xs text-muted-foreground truncate">{p.description}</div>
          )}
        </div>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      cell: (p) => <span>{p.durationDays} days</span>,
    },
    {
      key: 'devices',
      header: 'Devices',
      cell: (p) => <span>{p.maxDevices}</span>,
    },
    {
      key: 'price',
      header: 'Price',
      cell: (p) => (
        <span>
          {p.price ?? 0} {p.currency}
        </span>
      ),
    },
    {
      key: 'codes',
      header: 'Codes',
      cell: (p) => (
        <span>
          {p.usedCodeCount ?? 0}/{p.codeCount ?? 0} used
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (p) =>
        p.status === 'Active' ? (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted" />
            غير نشطة
          </span>
        ),
    },
    {
      key: 'actions',
      header: '',
      cell: (p) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => handleCopyId(e, p._id)}
            className="p-1.5 text-muted-foreground hover:text-foreground"
            title="نسخ معرّف الباقة"
          >
            {copiedId === p._id ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEdit(p);
            }}
            className="p-1.5 text-muted-foreground hover:text-foreground"
            title="تعديل الباقة"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(p);
            }}
            className="p-1.5 text-muted-foreground hover:text-destructive"
            title="حذف أو تعطيل"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

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
          <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">{t('admin.plans')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalCount} باقة اشتراك
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          {t('admin.newPlan')}
        </button>
      </div>

      {error && (
        <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={plans}
        gridTemplate="minmax(180px,1.6fr) 100px 80px 110px 110px 100px 120px"
        ariaLabel="الباقات"
        emptyMessage={t('common.noData')}
        rowKey={(p) => p._id}
      />

      {/* Create / edit modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? t('common.edit') : t('admin.newPlan')}
      >
        <div className="p-5 space-y-4">
          {formError && (
            <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              الاسم *
            </label>
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="3 أشهر / 3 Months"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              الوصف
            </label>
            <textarea
              className={`${inputClass} h-auto py-2`}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="وصف الباقة / Plan description"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                المدة (بالأيام) *
              </label>
              <input
                className={inputClass}
                type="number"
                min={1}
                value={form.durationDays}
                onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                الحد الأقصى للأجهزة *
              </label>
              <input
                className={inputClass}
                type="number"
                min={1}
                value={form.maxDevices}
                onChange={(e) => setForm({ ...form, maxDevices: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                السعر
              </label>
              <input
                className={inputClass}
                type="number"
                min={0}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                العملة
              </label>
              <input
                className={inputClass}
                value={form.currency}
                maxLength={10}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              الحالة
            </label>
            <select
              className={inputClass}
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as 'Active' | 'Inactive' })
              }
            >
              <option value="Active">نشطة</option>
              <option value="Inactive">غير نشطة</option>
            </select>
          </div>
          <div className="space-y-3 border border-border p-3">
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                محتوى الزبون
              </label>
              <select
                className={inputClass}
                value={form.contentMode}
                onChange={(e) => setForm({ ...form, contentMode: e.target.value as 'all' | 'selected' })}
              >
                <option value="all">كل الكتالوج المتاح</option>
                <option value="selected">محتوى محدد لهذه الباقة</option>
              </select>
            </div>
            {form.contentMode === 'selected' && (
              <div className="grid gap-3 md:grid-cols-3">
                {([
                  ['القنوات', 'channels', 'channelName'],
                  ['الأفلام', 'movies', 'title'],
                  ['المسلسلات', 'series', 'title'],
                ] as const).map(([label, key, textKey]) => (
                  <label key={key} className="space-y-1.5 text-xs text-muted-foreground">
                    <span>{label}</span>
                    <select
                      multiple
                      className={`${inputClass} h-32`}
                      value={form[`${key.slice(0, -1)}Ids` as 'channelIds' | 'movieIds' | 'seriesIds']}
                      onChange={(e) => {
                        const values = Array.from(e.target.selectedOptions).map((option) => option.value);
                        const field = `${key.slice(0, -1)}Ids` as 'channelIds' | 'movieIds' | 'seriesIds';
                        setForm({ ...form, [field]: values });
                      }}
                    >
                      {contentOptions[key].map((item) => (
                        <option key={item._id} value={item._id}>
                          {(item as { channelName?: string; title?: string })[textKey] || item._id}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
              className="inline-flex items-center px-6 py-2.5 text-sm font-medium uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {saving ? t('common.loading') : t('common.save')}
            </button>
            <button
              onClick={() => setFormOpen(false)}
              disabled={saving}
              className="px-6 py-2.5 text-sm font-medium border border-border uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="حذف الباقة"
        message={`هل تريد حذف "${deleteTarget?.name}"؟ سيتم تعطيل الباقات المرتبطة بأكواد تفعيل بدلًا من حذفها.`}
        confirmLabel="حذف"
        variant="destructive"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
