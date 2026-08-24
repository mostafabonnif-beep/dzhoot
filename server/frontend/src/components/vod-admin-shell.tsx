'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  LayoutGrid,
  List,
  RefreshCw,
  CheckSquare,
  Square,
  Power,
  PowerOff,
  Trash2,
  Pencil,
  X,
} from 'lucide-react';
import api from '@/lib/api';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';
import Pagination from '@/components/ui/pagination';
import SearchInput from '@/components/ui/search-input';
import Modal from '@/components/ui/modal';
import { useLocale } from '@/components/locale-provider';

interface VodItem {
  _id: string;
  title: string;
  category: string;
  poster?: string;
  backdrop?: string;
  description?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  year?: number;
  duration?: number;
  rating?: number;
  sourceId?: string;
  isActive: boolean;
}

interface EditField {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'textarea';
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  nullable?: boolean;
}

interface VodAdminShellProps {
  kind: 'movies' | 'series';
  title: string;
  totalLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  loadErrorLabel: string;
  icon: React.ReactNode;
}

const PAGE_SIZE = 24;

// Shared admin VOD management shell (movies + series). Read-only browsing was
// the old behaviour; this adds per-item + bulk enable/disable/delete, plus
// category-wide operations — all wired to /api/v1/admin/vod/*.
export default function VodAdminShell({
  kind,
  title,
  totalLabel,
  searchPlaceholder,
  emptyLabel,
  loadErrorLabel,
  icon,
}: VodAdminShellProps) {
  const isMovies = kind === 'movies';
  const { locale } = useLocale();
  const L = (ar: string, fr: string, en: string) => (locale === 'ar' ? ar : locale === 'fr' ? fr : en);
  const [items, setItems] = useState<VodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('All');
  const [categories, setCategories] = useState<string[]>([]);
  const [sources, setSources] = useState<{ _id: string; name: string }[]>([]);
  const [sourceId, setSourceId] = useState('All');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const { search: searchTerm, debouncedSearch, handleSearchChange: setSearchTerm } = useDebouncedSearch('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Selection (bulk ops)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Metadata editing (per-item edit modal)
  const [editing, setEditing] = useState<VodItem | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/${kind}`, {
        params: {
          page,
          limit: PAGE_SIZE,
          category: category === 'All' ? undefined : category,
          search: debouncedSearch || undefined,
          sourceId: sourceId === 'All' ? undefined : sourceId,
          status,
        },
      });
      if (res.data.success) {
        setItems(res.data.data);
        setTotal(res.data.pagination.total);
      }
    } catch (err) {
      console.error(`Error fetching ${kind}:`, err);
      setError(loadErrorLabel);
    } finally {
      setLoading(false);
    }
  }, [kind, category, debouncedSearch, page, sourceId, status, loadErrorLabel]);

  const fetchSources = async () => {
    try {
      const res = await api.get('/admin/xtream-sources');
      if (res.data.success) {
        setSources(
          (res.data.data || []).map((s: { _id: string; name: string }) => ({ _id: s._id, name: s.name })),
        );
      }
    } catch (err) {
      console.error('Error fetching Xtream sources:', err);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await api.get(`/${kind}/categories`);
      if (res.data.success) setCategories(['All', ...res.data.data]);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Clear selection when the underlying page/filter changes.
  useEffect(() => {
    setSelected(new Set());
    setNotice(null);
  }, [page, debouncedSearch, category, sourceId, status]);

  const allOnPageSelected = useMemo(
    () => items.length > 0 && items.every((it) => selected.has(it._id)),
    [items, selected],
  );

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllOnPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        items.forEach((it) => next.delete(it._id));
      } else {
        items.forEach((it) => next.add(it._id));
      }
      return next;
    });
  };

  const runBulk = async (
    action: 'enable' | 'disable' | 'delete',
    scope: 'selected' | 'category',
  ) => {
    const payload: Record<string, unknown> = { confirmed: true };
    let endpoint = '';
    if (scope === 'selected') {
      if (selected.size === 0) return;
      payload.ids = Array.from(selected);
      endpoint = `/admin/vod/${kind}/bulk`;
    } else {
      if (category === 'All') return;
      payload.categories = [category];
      if (sourceId !== 'All') payload.sourceId = sourceId;
      endpoint = `/admin/vod/${kind}/bulk-by-category`;
    }
    if (action !== 'delete') payload.isActive = action === 'enable';

    setBusy(true);
    setNotice(null);
    try {
      const res =
        action === 'delete'
          ? await api.delete(endpoint, { data: payload })
          : await api.patch(endpoint, payload);
      if (res.data.success) {
        const n = res.data.updatedCount ?? res.data.deletedCount ?? 0;
        setNotice(
          action === 'enable'
            ? `تم تفعيل ${n} عنصراً.`
            : action === 'disable'
              ? `تم تعطيل ${n} عنصراً.`
              : `تم حذف ${n} عنصراً.`,
        );
        setSelected(new Set());
        await fetchItems();
      } else {
        setNotice(res.data.error || 'فشلت العملية.');
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'فشلت العملية.';
      setNotice(msg);
    } finally {
      setBusy(false);
    }
  };

  const confirmAndRun = (action: 'enable' | 'disable' | 'delete', scope: 'selected' | 'category') => {
    const target =
      scope === 'selected' ? `${selected.size} عنصراً محدداً` : `كل عناصر تصنيف «${category}»`;
    const verb =
      action === 'enable' ? 'تفعيل' : action === 'disable' ? 'تعطيل' : 'حذف نهائي';
    const extra = action === 'delete' && !isMovies ? ' (سيُحذف أيضاً المواسم والحلقات التابعة)' : '';
    if (window.confirm(`تأكيد: ${verb} ${target}${extra}؟`)) {
      void runBulk(action, scope);
    }
  };

  const runSingle = async (item: VodItem, action: 'toggle' | 'delete') => {
    if (action === 'delete') {
      const extra = !isMovies ? ' ومواسمه وحلقاته' : '';
      if (!window.confirm(`تأكيد: حذف «${item.title}»${extra} نهائياً؟`)) return;
    } else if (item.isActive) {
      if (!window.confirm(`تأكيد: تعطيل «${item.title}»؟`)) return;
    }
    setBusy(true);
    setNotice(null);
    try {
      if (action === 'toggle') {
        await api.patch(`/admin/vod/${kind}/${item._id}`, {
          isActive: !item.isActive,
          confirmed: true,
        });
      } else {
        await api.delete(`/admin/vod/${kind}/${item._id}`, { data: { confirmed: true } });
      }
      await fetchItems();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'فشلت العملية.';
      setNotice(msg);
    } finally {
      setBusy(false);
    }
  };

  // Edit form fields depend on the kind. Labels are localized (Arabic-first).
  const editFields: EditField[] = isMovies
    ? [
        { name: 'title', label: L('العنوان', 'Titre', 'Title'), required: true },
        { name: 'category', label: L('التصنيف', 'Catégorie', 'Category') },
        { name: 'year', label: L('السنة', 'Année', 'Year'), type: 'number', min: 1800, max: 2100, step: 1, integer: true, nullable: true },
        { name: 'duration', label: L('المدة (بالدقائق)', 'Durée (minutes)', 'Duration (minutes)'), type: 'number', min: 1, step: 1, integer: true, nullable: true },
        { name: 'rating', label: L('التقييم', 'Note', 'Rating'), type: 'number', min: 0, max: 10, step: 0.1, nullable: true },
        { name: 'poster', label: L('رابط الملصق', 'Affiche (URL)', 'Poster URL') },
        { name: 'backdrop', label: L('رابط الخلفية', 'Fond (URL)', 'Backdrop URL') },
        { name: 'description', label: L('الوصف', 'Description', 'Description'), type: 'textarea' },
      ]
    : [
        { name: 'title', label: L('العنوان', 'Titre', 'Title'), required: true },
        { name: 'category', label: L('التصنيف', 'Catégorie', 'Category') },
        { name: 'rating', label: L('التقييم', 'Note', 'Rating'), type: 'number', min: 0, max: 10, step: 0.1, nullable: true },
        { name: 'poster', label: L('رابط الملصق', 'Affiche (URL)', 'Poster URL') },
        { name: 'backdrop', label: L('رابط الخلفية', 'Fond (URL)', 'Backdrop URL') },
        { name: 'plot', label: L('القصة', 'Synopsis', 'Plot'), type: 'textarea' },
        { name: 'cast', label: L('طاقم التمثيل', 'Casting', 'Cast'), type: 'textarea' },
        { name: 'director', label: L('المخرج', 'Réalisateur', 'Director') },
        { name: 'genre', label: L('النوع', 'Genre', 'Genre') },
        { name: 'releaseDate', label: L('تاريخ الإصدار', 'Date de sortie', 'Release date') },
      ];

  const fieldDisplayValue = (item: VodItem, name: string): string => {
    const value = item[name as keyof VodItem];
    return value === null || value === undefined ? '' : String(value);
  };

  const openEdit = (item: VodItem) => {
    const initial: Record<string, string> = {};
    for (const field of editFields) {
      initial[field.name] = fieldDisplayValue(item, field.name);
    }
    setForm(initial);
    setFormError(null);
    setEditing(item);
  };

  const closeEdit = () => {
    setEditing(null);
    setFormError(null);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;

    // Send only fields the user actually changed (non-empty, or null to clear
    // a nullable numeric like year/duration/rating).
    const payload: Record<string, unknown> = {};
    for (const field of editFields) {
      const value = (form[field.name] ?? '').trim();
      const original = fieldDisplayValue(editing, field.name);

      if (field.type === 'number') {
        if (value === '') {
          if (original !== '' && field.nullable) payload[field.name] = null;
          continue;
        }
        const num = Number(value);
        if (!Number.isFinite(num) || (field.integer && !Number.isInteger(num))) {
          setFormError(`${field.label}: ${L('يجب أن يكون رقمًا صحيحًا', 'Doit être un nombre entier', 'Must be a whole number')}`);
          return;
        }
        if (field.min !== undefined && num < field.min) {
          setFormError(`${field.label}: ${L(`يجب أن يكون ${field.min} على الأقل`, `Doit être au moins ${field.min}`, `Must be at least ${field.min}`)}`);
          return;
        }
        if (field.max !== undefined && num > field.max) {
          setFormError(`${field.label}: ${L(`يجب ألا يتجاوز ${field.max}`, `Doit être au plus ${field.max}`, `Must be at most ${field.max}`)}`);
          return;
        }
        if (value !== original) payload[field.name] = num;
        continue;
      }

      if (field.required && value === '') {
        setFormError(L('العنوان مطلوب', 'Le titre est requis', 'Title is required'));
        return;
      }
      if (value !== '' && value !== original) payload[field.name] = value;
    }

    if (Object.keys(payload).length === 0) {
      setFormError(L('لا توجد تغييرات لحفظها', 'Aucune modification à enregistrer', 'No changes to save'));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await api.patch(`/admin/vod/${kind}/${editing._id}`, payload);
      setNotice(L('تم تحديث البيانات بنجاح', 'Données mises à jour avec succès', 'Data updated successfully'));
      setEditing(null);
      await fetchItems();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        L('فشل تحديث البيانات', 'Échec de la mise à jour des données', 'Failed to update data');
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {icon}
            {title}
          </h1>
          <p className="text-muted-foreground mt-1">
            {totalLabel}: {total}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('grid')}
            aria-label="عرض شبكي"
            className={`p-2 rounded-md ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground'}`}
          >
            <LayoutGrid className="h-5 w-5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            aria-label="عرض قائمة"
            className={`p-2 rounded-md ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground'}`}
          >
            <List className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2">
          <SearchInput value={searchTerm} onChange={(value) => setSearchTerm(value)} placeholder={searchPlaceholder} />
        </div>
        <select
          value={sourceId}
          onChange={(e) => {
            setSourceId(e.target.value);
            setPage(1);
          }}
          aria-label="فلترة حسب المصدر"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="All">جميع المصادر</option>
          {sources.map((source) => (
            <option key={source._id} value={source._id}>
              {source.name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as 'active' | 'inactive' | 'all');
            setPage(1);
          }}
          aria-label="فلترة حسب الحالة"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="active">نشط</option>
          <option value="inactive">غير نشط</option>
          <option value="all">كل الحالات</option>
        </select>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
          aria-label="فلترة حسب التصنيف"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'All' ? 'جميع التصنيفات' : c}
            </option>
          ))}
        </select>
      </div>

      {notice && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-sm" role="status">
          {notice}
        </div>
      )}

      {/* Bulk toolbar — appears when rows are selected */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-3">
          <span className="text-sm font-medium">{selected.size} محدد</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => confirmAndRun('enable', 'selected')}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Power className="h-3.5 w-3.5" /> تفعيل
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => confirmAndRun('disable', 'selected')}
            className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            <PowerOff className="h-3.5 w-3.5" /> تعطيل
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => confirmAndRun('delete', 'selected')}
            className="inline-flex items-center gap-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> حذف
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setSelected(new Set())}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium hover:bg-accent/80"
          >
            <X className="h-3.5 w-3.5" /> إلغاء التحديد
          </button>
        </div>
      )}

      {/* Category-wide ops — appears when a specific category is chosen */}
      {category !== 'All' && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <span className="font-medium">عمليات على تصنيف «{category}» بأكمله:</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => confirmAndRun('enable', 'category')}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Power className="h-3.5 w-3.5" /> تفعيل الكل
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => confirmAndRun('disable', 'category')}
            className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            <PowerOff className="h-3.5 w-3.5" /> تعطيل الكل
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => confirmAndRun('delete', 'category')}
            className="inline-flex items-center gap-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> حذف الكل
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="sr-only">جارٍ التحميل</span>
        </div>
      ) : error ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 text-center">
          {icon}
          <p className="text-sm text-destructive">{error}</p>
          <button
            type="button"
            onClick={fetchItems}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <RefreshCw className="h-4 w-4" />
            إعادة المحاولة
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center border-2 border-dashed rounded-lg">
          {icon}
          <p className="text-muted-foreground">{emptyLabel}</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {items.map((item) => (
            <div
              key={item._id}
              className={`group relative rounded-lg overflow-hidden border bg-card hover:shadow-lg transition-all ${selected.has(item._id) ? 'ring-2 ring-primary' : ''} ${!item.isActive ? 'opacity-60' : ''}`}
            >
              <button
                type="button"
                onClick={() => toggleOne(item._id)}
                aria-label={selected.has(item._id) ? 'إلغاء تحديد' : 'تحديد'}
                className="absolute top-2 left-2 z-10 rounded bg-black/60 p-1 text-white hover:bg-black/80"
              >
                {selected.has(item._id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              </button>
              <div className="aspect-[2/3] bg-muted relative">
                {item.poster ? (
                  <Image
                    src={item.poster}
                    alt={item.title}
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
                    unoptimized
                    className="object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">{icon}</div>
                )}
                <div className="absolute top-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded">
                  {item.category}
                </div>
                {!item.isActive && (
                  <div className="absolute bottom-2 right-2 bg-destructive text-destructive-foreground text-[10px] px-2 py-0.5 rounded">
                    معطّل
                  </div>
                )}
              </div>
              <div className="p-2">
                <h3 className="font-semibold text-sm truncate" title={item.title}>
                  {item.title}
                </h3>
                <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
                  <span>{item.year || 'N/A'}</span>
                  {item.duration ? <span>{Math.floor(item.duration / 60)}د</span> : null}
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runSingle(item, 'toggle')}
                    title={item.isActive ? 'تعطيل' : 'تفعيل'}
                    className={`flex-1 inline-flex items-center justify-center gap-1 rounded px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
                      item.isActive
                        ? 'bg-amber-600/10 text-amber-700 hover:bg-amber-600/20'
                        : 'bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600/20'
                    }`}
                  >
                    {item.isActive ? <PowerOff className="h-3 w-3" /> : <Power className="h-3 w-3" />}
                    {item.isActive ? 'تعطيل' : 'تفعيل'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openEdit(item)}
                    title={L('تعديل', 'Modifier', 'Edit')}
                    className="inline-flex items-center justify-center rounded bg-accent px-2 py-1 text-[11px] font-medium hover:bg-accent/70 disabled:opacity-50"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runSingle(item, 'delete')}
                    title="حذف"
                    className="inline-flex items-center justify-center rounded bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="p-3 w-10">
                  <button type="button" onClick={toggleAllOnPage} aria-label="تحديد الكل">
                    {allOnPageSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  </button>
                </th>
                <th className="p-3 font-medium">{isMovies ? 'الفيلم' : 'المسلسل'}</th>
                <th className="p-3 font-medium">التصنيف</th>
                <th className="p-3 font-medium text-center">{isMovies ? 'السنة' : 'التقييم'}</th>
                <th className="p-3 font-medium text-center">الحالة</th>
                <th className="p-3 font-medium text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) => (
                <tr key={item._id} className={`hover:bg-accent/50 transition-colors ${!item.isActive ? 'opacity-60' : ''}`}>
                  <td className="p-3">
                    <button type="button" onClick={() => toggleOne(item._id)} aria-label="تحديد">
                      {selected.has(item._id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="p-3 flex items-center gap-3">
                    <div className="relative h-10 w-7 bg-muted rounded overflow-hidden flex-shrink-0">
                      <Image
                        src={item.poster || 'https://placehold.co/400x600?text=No+Poster'}
                        alt={item.title}
                        fill
                        sizes="28px"
                        unoptimized
                        className="object-cover"
                      />
                    </div>
                    <span className="font-medium">{item.title}</span>
                  </td>
                  <td className="p-3 text-muted-foreground">{item.category}</td>
                  <td className="p-3 text-center">{isMovies ? item.year || '-' : item.rating || '-'}</td>
                  <td className="p-3 text-center">
                    {item.isActive ? (
                      <span className="text-emerald-600 text-xs font-medium">نشط</span>
                    ) : (
                      <span className="text-destructive text-xs font-medium">معطّل</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => runSingle(item, 'toggle')}
                        title={item.isActive ? 'تعطيل' : 'تفعيل'}
                        className={`rounded p-1.5 disabled:opacity-50 ${
                          item.isActive
                            ? 'text-amber-700 hover:bg-amber-600/10'
                            : 'text-emerald-700 hover:bg-emerald-600/10'
                        }`}
                      >
                        {item.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openEdit(item)}
                        title={L('تعديل', 'Modifier', 'Edit')}
                        className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => runSingle(item, 'delete')}
                        title="حذف"
                        className="rounded p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-center py-4">
        <Pagination page={page} pageSize={PAGE_SIZE} totalCount={total} onPageChange={setPage} />
      </div>

      {/* Per-item metadata edit modal */}
      <Modal
        open={editing !== null}
        onClose={closeEdit}
        title={L(isMovies ? 'تعديل الفيلم' : 'تعديل المسلسل', isMovies ? 'Modifier le film' : 'Modifier la série', isMovies ? 'Edit movie' : 'Edit series')}
        size="lg"
        ariaLabelledBy="vod-edit-modal-title"
      >
        {editing && (
          <form onSubmit={handleEditSubmit} className="p-4 sm:p-5 space-y-4" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {editFields.map((field) => (
                <div key={field.name} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
                  <label htmlFor={`edit-${field.name}`} className="block text-sm font-medium mb-1">
                    {field.label}
                    {field.required ? <span className="text-destructive"> *</span> : null}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      id={`edit-${field.name}`}
                      value={form[field.name] ?? ''}
                      onChange={(e) => setForm((prev) => ({ ...prev, [field.name]: e.target.value }))}
                      rows={4}
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                  ) : (
                    <input
                      id={`edit-${field.name}`}
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={form[field.name] ?? ''}
                      onChange={(e) => setForm((prev) => ({ ...prev, [field.name]: e.target.value }))}
                      min={field.type === 'number' ? field.min : undefined}
                      max={field.type === 'number' ? field.max : undefined}
                      step={field.type === 'number' ? (field.step ?? 1) : undefined}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                  )}
                </div>
              ))}
            </div>

            {formError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive" role="alert">
                {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={closeEdit}
                disabled={saving}
                className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium hover:bg-accent/80 disabled:opacity-50"
              >
                {L('إلغاء', 'Annuler', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? L('جارٍ الحفظ...', 'Enregistrement…', 'Saving…') : L('حفظ', 'Enregistrer', 'Save')}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
