'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  Loader2,
  Trash2,
  Plus,
  Upload,
  X,
  Download,
  Check,
  Zap,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Flag,
  Heart,
  Ban,
} from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';
import { useLocale } from '@/components/locale-provider';
import { useToast } from '@/hooks/use-toast';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';
import { useClientSideTable } from '@/hooks/use-client-side-table';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import Pagination from '@/components/ui/pagination';
import Modal from '@/components/ui/modal';
import { useStreamPlayer } from '@/components/stream-player-context';
import ColumnFilter from '@/components/ui/column-filter';
import SearchInput from '@/components/ui/search-input';
import StatusDot from '@/components/ui/status-dot';
import ChannelLogo from '@/components/ui/channel-logo';
import ChannelDetailModal, { type ChannelField } from '@/components/channel-detail-modal';
import ChannelDataTable from '@/components/ui/channel-data-table';
import { type DataTableColumn } from '@/components/ui/data-table';
import type { FlaggedBad, AlternateStream } from '@/types';

interface Channel {
  _id: string;
  channelId?: string;
  channelName?: string;
  name?: string;
  channelUrl?: string;
  url?: string;
  channelImg?: string;
  tvgLogo?: string;
  logo?: string;
  channelGroup?: string;
  channelDrmKey?: string;
  channelDrmType?: string;
  order?: number;
  epgId?: string;
  isActive?: boolean;
  catchup?: {
    type?: string | null;
    days?: number | null;
  };
  metadata?: {
    isWorking?: boolean;
    lastTested?: string;
    responseTime?: number;
    country?: string;
    language?: string;
    quality?: string;
    network?: string;
    website?: string;
  };
  flaggedBad?: FlaggedBad;
  alternateStreams?: AlternateStream[];
  metrics?: {
    deadCount?: number;
    aliveCount?: number;
    unresponsiveCount?: number;
    playCount?: number;
    proxyPlayCount?: number;
    lastDeadAt?: string;
    lastAliveAt?: string;
    lastPlayedAt?: string;
    lastUnresponsiveAt?: string;
  };
}

function getName(c: Channel) {
  return c.channelName || c.name || 'Unnamed';
}

function getLogo(c: Channel) {
  return c.tvgLogo || c.channelImg || c.logo;
}

function getUrl(c: Channel) {
  return c.channelUrl || c.url || '';
}

const PAGE_SIZE = 50;

interface ChannelsPageShellProps {
  mode: 'admin' | 'user';
}

type SortField = 'name' | 'group';
type SortDir = 'asc' | 'desc';

export default function ChannelsPageShell({ mode }: ChannelsPageShellProps) {
  const isAdmin = mode === 'admin';
  const { toast } = useToast();
  const { t, locale } = useLocale();
  const L = (ar: string, fr: string, en: string) => (locale === 'ar' ? ar : locale === 'fr' ? fr : en);
  const { user } = useAuthStore();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const { search, debouncedSearch, handleSearchChange } = useDebouncedSearch('', 300);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [healthStats, setHealthStats] = useState<{
    working: number;
    notWorking: number;
    untested: number;
  } | null>(null);

  // Column filter state
  const [filterOptions, setFilterOptions] = useState<{
    group: string[];
    status: string[];
    language: string[];
    country: string[];
  }>({ group: [], status: [], language: [], country: [] });
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);

  // Admin: Add channel form
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    channelName: '',
    channelUrl: '',
    channelGroup: '',
    tvgLogo: '',
    channelDrmKey: '',
    channelDrmType: '',
    order: 0,
  });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');

  // Admin: Edit channel
  const [editChannel, setEditChannel] = useState<Channel | null>(null);
  const [editForm, setEditForm] = useState({
    channelName: '',
    channelUrl: '',
    channelGroup: '',
    tvgLogo: '',
    channelDrmKey: '',
    channelDrmType: '',
    order: 0,
    country: '',
    language: '',
    quality: '',
    network: '',
    website: '',
    alternateUrls: '',
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  // Details preview
  const [detailChannel, setDetailChannel] = useState<Channel | null>(null);

  // Flag bad stream
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagTarget, setFlagTarget] = useState<{
    channelId: string;
    alternateIndex?: number;
  } | null>(null);
  const [flagReason, setFlagReason] = useState('looping');

  // Bulk delete
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  // Admin: row selection for bulk enable/disable/delete
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkSelectionLoading, setBulkSelectionLoading] = useState(false);

  // Clear row selection whenever the visible page changes (bulk actions apply
  // only to rows the admin can see, keeping destructive ops predictable).
  useEffect(() => {
    setSelectedRows(new Set());
  }, [page, debouncedSearch, isAdmin]);

  // Admin: M3U Import
  const [showImport, setShowImport] = useState(false);
  const [importContent, setImportContent] = useState('');
  const [importClear, setImportClear] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState('');
  const [importSuccess, setImportSuccess] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Stream testing
  const [testing, setTesting] = useState<string | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [testResults, setTestResults] = useState<{ working: number; failed: number } | null>(null);

  // User: Add from system (server-side paginated catalog browse)
  const [allChannels, setAllChannels] = useState<Channel[]>([]);
  const [allChannelsTotal, setAllChannelsTotal] = useState(0);
  const [addPage, setAddPage] = useState(1);
  const [allChannelsLoading, setAllChannelsLoading] = useState(false);
  const [addChannelsError, setAddChannelsError] = useState('');
  const {
    search: addSearch,
    debouncedSearch: addDebouncedSearch,
    handleSearchChange: handleAddSearchChange,
  } = useDebouncedSearch('', 300);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // User: M3U copy
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);

  // User: Sort
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const { playStream } = useStreamPlayer();

  // Favorites
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const favoriteIdsRef = useRef<Set<string>>(new Set());
  const [favSyncing, setFavSyncing] = useState<Set<string>>(new Set());

  function updateFavoriteIds(next: Set<string>) {
    favoriteIdsRef.current = next;
    setFavoriteIds(next);
  }

  async function fetchFavorites() {
    try {
      const res = await api.get('/favorites');
      const ids: string[] = res.data.channel_ids || [];
      updateFavoriteIds(new Set(ids));
    } catch {
      // silent — favorites are non-critical
    }
  }

  async function toggleFavorite(channelId: string) {
    setFavSyncing((prev) => new Set(prev).add(channelId));
    const wasFav = favoriteIdsRef.current.has(channelId);
    const next = new Set(favoriteIdsRef.current);
    if (wasFav) next.delete(channelId);
    else next.add(channelId);
    updateFavoriteIds(next);
    try {
      await api.post('/favorites', { channel_ids: Array.from(favoriteIdsRef.current) });
    } catch {
      // revert just this channel
      const reverted = new Set(favoriteIdsRef.current);
      if (wasFav) reverted.add(channelId);
      else reverted.delete(channelId);
      updateFavoriteIds(reverted);
      toast('تعذر تحديث المفضلة', 'error');
    } finally {
      setFavSyncing((prev) => {
        const s = new Set(prev);
        s.delete(channelId);
        return s;
      });
    }
  }

  // --- Admin: Server-side data fetching ---
  const fetchChannels = useCallback(
    async (signal?: AbortSignal) => {
      if (!isAdmin) return;
      try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('pageSize', String(PAGE_SIZE));
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (selectedGroups.length > 0 && selectedGroups.length < filterOptions.group.length) {
          params.set('group', selectedGroups.join(','));
        }
        if (selectedStatuses.length > 0 && selectedStatuses.length < filterOptions.status.length) {
          params.set('status', selectedStatuses.join(','));
        }
        if (
          selectedLanguages.length > 0 &&
          selectedLanguages.length < filterOptions.language.length
        ) {
          params.set('language', selectedLanguages.join(','));
        }
        if (
          selectedCountries.length > 0 &&
          selectedCountries.length < filterOptions.country.length
        ) {
          params.set('country', selectedCountries.join(','));
        }
        const res = await api.get(`/admin/channels?${params.toString()}`, { signal });
        const body = res.data;
        setChannels(Array.isArray(body) ? body : body.data || body.channels || []);
        setTotalCount(body.totalCount ?? (Array.isArray(body) ? body.length : body.count || 0));
        setHealthStats(body.health ?? null);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === 'ERR_CANCELED'
        )
          return;
        setError('تعذر تحميل القنوات');
      } finally {
        setLoading(false);
      }
    },
    [
      isAdmin,
      page,
      debouncedSearch,
      selectedGroups,
      selectedStatuses,
      selectedLanguages,
      selectedCountries,
      filterOptions,
    ],
  );

  async function refreshFilterOptions() {
    if (!isAdmin) return;
    try {
      const res = await api.get('/admin/channels/filter-options');
      setFilterOptions(res.data.data || { group: [], status: [], language: [], country: [] });
    } catch {
      /* ignore */
    }
  }

  // --- User: Client-side data fetching ---
  function isCanceled(err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') return true;
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'ERR_CANCELED'
    );
  }

  async function fetchMyChannels(signal?: AbortSignal) {
    try {
      const res = await api.get('/user-playlist/me/channels', { signal });
      const body = res.data;
      setChannels(Array.isArray(body) ? body : body.data || body.channels || []);
      setError('');
    } catch (err: unknown) {
      if (isCanceled(err)) return;
      setError('تعذر تحميل القنوات');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  async function fetchAvailableChannels(page: number, search: string, signal?: AbortSignal) {
    setAllChannelsLoading(true);
    setAddChannelsError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', '50');
      if (search) params.set('search', search);
      const res = await api.get(`/channels?${params.toString()}`, { signal });
      const body = res.data;
      setAllChannels(Array.isArray(body) ? body : body.data || body.channels || []);
      setAllChannelsTotal(body.totalCount ?? (Array.isArray(body) ? body.length : body.count || 0));
    } catch (err: unknown) {
      if (isCanceled(err)) return;
      setAddChannelsError(L('تعذر تحميل القنوات', 'Impossible de charger les chaînes', 'Failed to load channels'));
    } finally {
      if (!signal?.aborted) setAllChannelsLoading(false);
    }
  }

  // Init
  useEffect(() => {
    setOrigin(window.location.origin);
    fetchFavorites();
    const controller = new AbortController();
    if (isAdmin) {
      refreshFilterOptions();
    } else {
      fetchMyChannels(controller.signal);
    }
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // User: fetch the first page when the "Add from system" panel opens
  useEffect(() => {
    if (isAdmin || !showAdd) return;
    setAddPage(1);
    const controller = new AbortController();
    fetchAvailableChannels(1, addDebouncedSearch, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, showAdd]);

  // User: refetch on page change or debounced search change
  useEffect(() => {
    if (isAdmin || !showAdd) return;
    const controller = new AbortController();
    fetchAvailableChannels(addPage, addDebouncedSearch, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, showAdd, addPage, addDebouncedSearch]);

  // Admin: track prev filters and reset page
  const prevFiltersRef = useRef({
    debouncedSearch,
    selectedGroups,
    selectedStatuses,
    selectedLanguages,
    selectedCountries,
  });

  useEffect(() => {
    if (!isAdmin) return;
    const prev = prevFiltersRef.current;
    const filtersChanged =
      prev.debouncedSearch !== debouncedSearch ||
      prev.selectedGroups !== selectedGroups ||
      prev.selectedStatuses !== selectedStatuses ||
      prev.selectedLanguages !== selectedLanguages ||
      prev.selectedCountries !== selectedCountries;
    prevFiltersRef.current = {
      debouncedSearch,
      selectedGroups,
      selectedStatuses,
      selectedLanguages,
      selectedCountries,
    };

    if (filtersChanged && page !== 1) {
      setPage(1);
      return;
    }
    const controller = new AbortController();
    fetchChannels(controller.signal);
    return () => controller.abort();
  }, [
    fetchChannels,
    isAdmin,
    page,
    debouncedSearch,
    selectedGroups,
    selectedStatuses,
    selectedLanguages,
    selectedCountries,
  ]);

  // User: Client-side filtering/sorting
  const groupOptions = useMemo(() => {
    if (isAdmin) return [];
    const set = new Set<string>();
    channels.forEach((c) => {
      if (c.channelGroup) set.add(c.channelGroup);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [channels, isAdmin]);

  const statusOptions = useMemo(() => ['Working', 'Not Working', 'Untested'], []);

  const searchFields = useMemo(
    () => [(c: Channel) => getName(c), (c: Channel) => c.channelGroup],
    [],
  );

  const sortAccessor = useCallback(
    (ch: Channel) => {
      switch (sortField) {
        case 'name':
          return getName(ch);
        case 'group':
          return ch.channelGroup || '';
      }
    },
    [sortField],
  );

  const userFilters = useMemo(
    () => [
      {
        accessor: (c: Channel) => c.channelGroup || '',
        selected: selectedGroups,
        allOptions: groupOptions,
      },
      {
        accessor: (c: Channel) =>
          c.metadata?.isWorking === true
            ? 'Working'
            : c.metadata?.isWorking === false
              ? 'Not Working'
              : 'Untested',
        selected: selectedStatuses,
        allOptions: statusOptions,
      },
    ],
    [selectedGroups, groupOptions, selectedStatuses, statusOptions],
  );

  const { filtered, paginated: userPaginated } = useClientSideTable({
    data: isAdmin ? [] : channels,
    search: isAdmin ? '' : debouncedSearch,
    searchFields,
    filters: userFilters,
    sortAccessor,
    sortDir,
    page,
    pageSize: PAGE_SIZE,
  });

  // Reset page on filter/search change (user mode)
  useEffect(() => {
    if (isAdmin) return;
    setPage(1);
  }, [debouncedSearch, selectedGroups, selectedStatuses, isAdmin]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(1);
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  }

  const displayData = isAdmin ? channels : userPaginated;
  const displayTotalCount = isAdmin ? totalCount : filtered.length;
  const workingCount =
    isAdmin && healthStats
      ? healthStats.working
      : channels.filter((c) => c.metadata?.isWorking === true).length;
  const deadCount =
    isAdmin && healthStats
      ? healthStats.notWorking
      : channels.filter((c) => c.metadata?.isWorking === false).length;
  const untestedCount =
    isAdmin && healthStats ? healthStats.untested : Math.max(channels.length - workingCount - deadCount, 0);
  const flaggedPrimaryCount = channels.filter((c) => c.flaggedBad?.isFlagged).length;
  const alternateReadyCount = channels.filter(
    (c) => (c.alternateStreams?.filter((alt) => !alt.flaggedBad?.isFlagged).length ?? 0) > 0,
  ).length;
  const catchupReadyCount = channels.filter((c) => Boolean(c.catchup?.type)).length;
  const epgLinkedCount = channels.filter((c) => Boolean(c.epgId)).length;
  const channelsReadinessLabel =
    deadCount > 0
      ? L('تحتاج معالجة تشغيلية', 'Assainissement opérationnel requis', 'Operational cleanup needed')
      : untestedCount > 0
        ? L('جاهزة جزئيًا', 'Partiellement prête', 'Partially ready')
        : L('جاهزة تشغيليًا', 'Operationally ready', 'Operationally ready');
  const channelsReadinessTone =
    deadCount > 0
      ? 'border-destructive/30 bg-destructive/5 text-destructive'
      : untestedCount > 0
        ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'
        : 'border-signal-green/30 bg-signal-green/5 text-signal-green';
  const channelsReadinessMessage =
    deadCount > 0
      ? L('هناك قنوات متعطلة تحتاج اختبارًا أو استبدالًا قبل الاعتماد على الكتالوج تجاريًا.', 'Certaines chaînes sont en panne et doivent être testées ou remplacées avant un usage commercial.', 'Some channels are broken and need testing or replacement before relying on the catalog commercially.')
      : untestedCount > 0
        ? L('الكتالوج جيد، لكن ما زالت هناك قنوات غير مختبرة تستحق فحصًا جماعيًا.', 'Le catalogue est bon, mais certaines chaînes non testées méritent une vérification groupée.', 'The catalog looks good, but some untested channels still need a bulk check.')
        : L('الكتالوج الحالي نظيف نسبيًا ويمكن استخدامه كأساس للاستيراد والتوزيع.', 'Le catalogue actuel est propre et peut servir de base à l’import et à la distribution.', 'The current catalog is clean enough to support import and distribution.');

  // --- Admin actions ---
  async function handleAddChannel(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    setAddLoading(true);
    try {
      const channelId = addForm.channelName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      await api.post('/admin/channels', {
        channelId,
        channelName: addForm.channelName,
        channelUrl: addForm.channelUrl,
        channelGroup: addForm.channelGroup || 'Uncategorized',
        tvgLogo: addForm.tvgLogo || '',
        channelDrmKey: addForm.channelDrmKey || '',
        channelDrmType: addForm.channelDrmType || '',
        order: addForm.order || 0,
      });
      setShowAdd(false);
      setAddForm({
        channelName: '',
        channelUrl: '',
        channelGroup: '',
        tvgLogo: '',
        channelDrmKey: '',
        channelDrmType: '',
        order: 0,
      });
      fetchChannels();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setAddError(axiosErr.response?.data?.error || 'Failed to create channel');
    } finally {
      setAddLoading(false);
    }
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editChannel) return;
    setEditError('');
    setEditLoading(true);
    try {
      await api.put(`/admin/channels/${editChannel._id}`, {
        channelName: editForm.channelName,
        channelUrl: editForm.channelUrl,
        channelGroup: editForm.channelGroup || 'Uncategorized',
        tvgLogo: editForm.tvgLogo || '',
        channelDrmKey: editForm.channelDrmKey || '',
        channelDrmType: editForm.channelDrmType || '',
        order: editForm.order || 0,
        metadata: {
          country: editForm.country || '',
          language: editForm.language || '',
          quality: editForm.quality || '',
          network: editForm.network || '',
          website: editForm.website || '',
        },
        alternateStreams: editForm.alternateUrls
          .split('\n')
          .map((u) => u.trim())
          .filter(Boolean)
          .map((url) => {
            const existing = editChannel.alternateStreams?.find((a) => a.streamUrl === url);
            return existing || { streamUrl: url };
          }),
      });
      setEditChannel(null);
      fetchChannels();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setEditError(axiosErr.response?.data?.error || 'Failed to update channel');
    } finally {
      setEditLoading(false);
    }
  }

  function openEdit(ch: Channel) {
    setEditChannel(ch);
    setEditForm({
      channelName: getName(ch),
      channelUrl: getUrl(ch),
      channelGroup: ch.channelGroup || '',
      tvgLogo: getLogo(ch) || '',
      channelDrmKey: ch.channelDrmKey || '',
      channelDrmType: ch.channelDrmType || '',
      order: ch.order || 0,
      country: ch.metadata?.country || '',
      language: ch.metadata?.language || '',
      quality: ch.metadata?.quality || '',
      network: ch.metadata?.network || '',
      website: ch.metadata?.website || '',
      alternateUrls: (ch.alternateStreams || []).map((a) => a.streamUrl).join('\n'),
    });
    setEditError('');
  }

  async function handleDelete(id: string) {
    if (isAdmin) {
      if (!window.confirm(t('channels.confirmDelete'))) return;
      try {
        await api.delete(`/admin/channels/${id}`);
        // Refetch so totalCount/health/pagination stay accurate after a delete
        // (locally filtering leaves stale totals behind).
        await fetchChannels();
      } catch {
        toast(t('channels.deleteFailed'), 'error');
      }
    } else {
      try {
        await api.post('/user-playlist/me/channels/remove', { channelIds: [id] });
        setChannels((prev) => prev.filter((c) => c._id !== id));
      } catch {
        toast(t('channels.removeFailed'), 'error');
      }
    }
  }

  async function handleBulkDelete() {
    if (isAdmin) {
      setBulkDeleteLoading(true);
      try {
        await api.delete('/admin/channels', { data: { confirmed: true } });
        setChannels([]);
        setTotalCount(0);
        setShowBulkDelete(false);
        refreshFilterOptions();
      } catch {
        toast(t('channels.deleteAllFailed'), 'error');
      } finally {
        setBulkDeleteLoading(false);
      }
    } else {
      if (!window.confirm(t('channels.confirmRemoveAll'))) return;
      try {
        await api.put('/user-playlist/me/channels', { channelIds: [] });
        setChannels([]);
      } catch {
        toast(t('channels.clearFailed'), 'error');
      }
    }
  }

  // Admin: purge only dead or untested catalog channels (keeps working ones).
  const [purgeStatus, setPurgeStatus] = useState<null | 'dead' | 'untested'>(null);
  const [purgeLoading, setPurgeLoading] = useState(false);
  async function handlePurgeByStatus() {
    if (!purgeStatus) return;
    setPurgeLoading(true);
    try {
      const res = await api.delete('/admin/channels/bulk-by-status', {
        data: { confirmed: true, status: purgeStatus },
      });
      const n = res.data?.deletedCount ?? 0;
      toast(t('channels.purgeDone').replace('{count}', String(n)), 'success');
      setPurgeStatus(null);
      await fetchChannels();
      refreshFilterOptions();
    } catch {
      toast(t('channels.purgeFailed'), 'error');
    } finally {
      setPurgeLoading(false);
    }
  }

  // Admin: bulk enable/disable/delete selected rows (PATCH/DELETE /admin/channels/bulk).
  async function handleBulkSelection(action: 'enable' | 'disable' | 'delete') {
    if (selectedRows.size === 0) return;
    if (action === 'disable') {
      const ok = window.confirm(
        locale === 'ar'
          ? `سيتم تعطيل ${selectedRows.size} قناة من الكتالوج (تختفي من قوائم المستخدمين مؤقتًا). هل تريد المتابعة؟`
          : locale === 'fr'
            ? `${selectedRows.size} chaînes seront désactivées du catalogue (masquées temporairement des listes des utilisateurs). Continuer ?`
            : `${selectedRows.size} channels will be disabled in the catalog (temporarily hidden from user lists). Continue?`,
      );
      if (!ok) return;
    }
    if (action === 'delete') {
      const ok = window.confirm(
        locale === 'ar'
          ? `سيتم حذف ${selectedRows.size} قناة نهائيًا من الكتالوج وإزالتها من قوائم المستخدمين. لا يمكن التراجع.`
          : locale === 'fr'
            ? `${selectedRows.size} chaînes seront supprimées définitivement du catalogue et retirées des listes des utilisateurs. Irréversible.`
            : `${selectedRows.size} channels will be permanently deleted from the catalog and removed from user lists. This cannot be undone.`,
      );
      if (!ok) return;
    }

    setBulkSelectionLoading(true);
    const ids = Array.from(selectedRows);
    try {
      if (action === 'delete') {
        const res = await api.delete('/admin/channels/bulk', {
          data: { confirmed: true, ids },
        });
        toast(
          locale === 'ar'
            ? `تم حذف ${res.data?.deletedCount ?? ids.length} قناة`
            : locale === 'fr'
              ? `${res.data?.deletedCount ?? ids.length} chaînes supprimées`
              : `Deleted ${res.data?.deletedCount ?? ids.length} channels`,
          'success',
        );
      } else {
        const res = await api.patch('/admin/channels/bulk', {
          ids,
          isActive: action === 'enable',
          confirmed: action === 'disable',
        });
        toast(
          locale === 'ar'
            ? action === 'enable'
              ? `تم تفعيل ${res.data?.updatedCount ?? ids.length} قناة`
              : `تم تعطيل ${res.data?.updatedCount ?? ids.length} قناة`
            : locale === 'fr'
              ? action === 'enable'
                ? `${res.data?.updatedCount ?? ids.length} chaînes activées`
                : `${res.data?.updatedCount ?? ids.length} chaînes désactivées`
              : action === 'enable'
                ? `Enabled ${res.data?.updatedCount ?? ids.length} channels`
                : `Disabled ${res.data?.updatedCount ?? ids.length} channels`,
          'success',
        );
      }
      setSelectedRows(new Set());
      await fetchChannels();
      refreshFilterOptions();
    } catch {
      toast(
        locale === 'ar'
          ? 'فشلت العملية الجماعية'
          : locale === 'fr'
            ? 'Échec de l’opération groupée'
            : 'Bulk operation failed',
        'error',
      );
    } finally {
      setBulkSelectionLoading(false);
    }
  }

  // Admin: export the full catalog (all pages) as an M3U file — the old
  // "Export M3U" copied the admin's own channel-list code, which admins
  // usually don't have (dead button).
  const [exportingCatalog, setExportingCatalog] = useState(false);
  const [exportingCatalogCsv, setExportingCatalogCsv] = useState(false);

  async function fetchAllCatalogChannels(): Promise<Channel[]> {
    const all: Channel[] = [];
    let cursor = 1;
    const pageSize = 200;
    let hasMore = true;
    while (hasMore && cursor <= 250) {
      const res = await api.get('/admin/channels', {
        params: { page: cursor, pageSize, ownerId: 'null' },
      });
      const body = res.data?.data || res.data;
      const rows: Channel[] = Array.isArray(body) ? body : body?.channels || body?.items || [];
      all.push(...rows);
      const total = body?.totalCount ?? body?.total ?? rows.length;
      hasMore = rows.length > 0 && cursor * pageSize < total;
      cursor += 1;
    }
    return all;
  }

  async function handleExportCatalogM3U() {
    if (exportingCatalog) return;
    setExportingCatalog(true);
    try {
      const all = await fetchAllCatalogChannels();
      if (all.length === 0) {
        toast(t('channels.noChannelsYet'), 'error');
        return;
      }
      const lines = ['#EXTM3U'];
      for (const ch of all) {
        const name = getName(ch).replace(/,/g, '');
        const url = getUrl(ch);
        if (!url) continue;
        lines.push(`#EXTINF:-1 tvg-id="${ch.epgId || ''}" tvg-logo="${getLogo(ch) || ''}",${name}`);
        lines.push(url);
      }
      const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dzhoof-catalog-${new Date().toISOString().slice(0, 10)}.m3u`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(
        locale === 'ar'
          ? `تم تصدير ${all.length} قناة`
          : locale === 'fr'
            ? `${all.length} chaînes exportées`
            : `Exported ${all.length} channels`,
        'success',
      );
    } catch {
      toast(
        locale === 'ar'
          ? 'فشل تصدير M3U'
          : locale === 'fr'
            ? 'Échec de l’export M3U'
            : 'Failed to export M3U',
        'error',
      );
    } finally {
      setExportingCatalog(false);
    }
  }

  async function handleExportCatalogCsv() {
    if (exportingCatalogCsv) return;
    setExportingCatalogCsv(true);
    try {
      const all = await fetchAllCatalogChannels();
      if (all.length === 0) {
        toast(t('channels.noChannelsYet'), 'error');
        return;
      }
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [
        ['id', 'name', 'group', 'url', 'country', 'language', 'status', 'plays', 'last_tested'].join(','),
      ];
      for (const ch of all) {
        rows.push([
          esc(ch._id),
          esc(getName(ch)),
          esc(ch.channelGroup || ''),
          esc(getUrl(ch)),
          esc(ch.metadata?.country || ''),
          esc(ch.metadata?.language || ''),
          esc(
            ch.metadata?.isWorking === false
              ? 'dead'
              : ch.metadata?.isWorking === true
                ? 'working'
                : 'untested',
          ),
          esc(ch.metrics?.playCount ?? 0),
          esc(ch.metadata?.lastTested ? new Date(ch.metadata.lastTested).toISOString() : ''),
        ].join(','));
      }
      const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dzhoof-catalog-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(
        locale === 'ar'
          ? `تم تصدير ${all.length} قناة`
          : locale === 'fr'
            ? `${all.length} chaînes exportées`
            : `Exported ${all.length} channels`,
        'success',
      );
    } catch {
      toast(
        locale === 'ar'
          ? 'فشل تصدير CSV'
          : locale === 'fr'
            ? 'Échec de l’export CSV'
            : 'Failed to export CSV',
        'error',
      );
    } finally {
      setExportingCatalogCsv(false);
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importContent.trim()) return;
    setImportLoading(true);
    setImportResult('');
    setImportSuccess(false);
    try {
      const endpoint = isAdmin ? '/admin/channels/import-m3u' : '/user-playlist/me/import-m3u';
      const payload = isAdmin
        ? { m3uContent: importContent, clearExisting: importClear }
        : { m3uContent: importContent };
      const res = await api.post(endpoint, payload);
      const data = res.data;
      const importedCount = data.imported || data.added || data.count || 0;
      setImportSuccess(true);
      setImportResult(
        isAdmin
          ? t('channels.imported').replace('{count}', String(importedCount))
          : t('channels.addedToList').replace('{count}', String(importedCount)),
      );
      setImportContent('');
      setImportClear(false);
      if (isAdmin) {
        fetchChannels();
        refreshFilterOptions();
      } else {
        fetchMyChannels();
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setImportSuccess(false);
      setImportResult(axiosErr.response?.data?.error || t('channels.importFailed'));
    } finally {
      setImportLoading(false);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImportContent((ev.target?.result as string) || '');
    reader.readAsText(file);
  }

  async function handleTestOne(ch: Channel) {
    setTesting(ch._id);
    try {
      const res = await api.post(`/channels/${ch._id}/test`);
      const result = res.data.data || res.data;
      setChannels((prev) =>
        prev.map((c) =>
          c._id === ch._id
            ? {
                ...c,
                metadata: {
                  ...c.metadata,
                  isWorking: result.isWorking ?? result.working,
                  lastTested: new Date().toISOString(),
                  responseTime: result.responseTime,
                },
              }
            : c,
        ),
      );
    } catch {
      /* ignore */
    } finally {
      setTesting(null);
    }
  }

  async function handleTestAll() {
    setTestingAll(true);
    setTestResults(null);
    try {
      // The endpoint tests at most 500 channels per run — say so upfront so a
      // "complete" result is not mistaken for the whole catalog.
      if (totalCount > 500) {
        toast(t('channels.testAllLimit').replace('{count}', '500'), 'info');
      }
      const res = await api.post('/test/test-all', { limit: 500, skip: 0 });
      const data = res.data;
      setTestResults({ working: data.working || 0, failed: data.notWorking || 0 });
      fetchChannels();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number } };
      if (axiosErr.response?.status === 409)
        toast(t('channels.testBusy'), 'error');
    } finally {
      setTestingAll(false);
    }
  }

  async function handleTestAllUser() {
    const toTest = filtered.length > 0 ? filtered : channels.slice(0, PAGE_SIZE);
    if (toTest.length === 0) return;
    setTestingAll(true);
    setTestResults(null);
    let working = 0;
    let failed = 0;
    const BATCH_SIZE = 5;

    for (let i = 0; i < toTest.length; i += BATCH_SIZE) {
      const batch = toTest.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (ch) => {
          const res = await api.post(`/channels/${ch._id}/test`);
          return { ch, result: res.data.data || res.data };
        }),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { ch, result } = r.value;
          const isWorking = result.isWorking ?? result.working;
          if (isWorking) working++;
          else failed++;
          setChannels((prev) =>
            prev.map((c) =>
              c._id === ch._id
                ? {
                    ...c,
                    metadata: {
                      ...c.metadata,
                      isWorking,
                      lastTested: new Date().toISOString(),
                      responseTime: result.responseTime,
                    },
                  }
                : c,
            ),
          );
        } else {
          failed++;
        }
      }
    }

    setTestResults({ working, failed });
    setTestingAll(false);
  }

  // User: Add from system
  async function handleAddChannels() {
    if (selectedIds.size === 0) return;
    try {
      await api.post('/user-playlist/me/channels/add', {
        channelIds: Array.from(selectedIds),
      });
      setSelectedIds(new Set());
      setShowAdd(false);
      fetchMyChannels();
    } catch {
      toast(t('channels.addFailed'), 'error');
    }
  }

  function handleCopyM3U() {
    if (!user?.channelListCode || !origin) return;
    navigator.clipboard.writeText(`${origin}/api/v1/tv/playlist/${user.channelListCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Add-from-system panel: exclude already-owned channels (search is server-side now)
  const myIds = new Set(channels.map((c) => c._id));
  const availableChannels = allChannels.filter((c) => !myIds.has(c._id));

  // Detail modal fields
  const detailFields: ChannelField[] = detailChannel
    ? [
        { label: t('sources.streamUrl'), value: getUrl(detailChannel) },
        ...(isAdmin
          ? [
              { label: t('channels.channelId'), value: detailChannel.channelId },
              { label: t('sources.country'), value: detailChannel.metadata?.country },
              { label: t('sources.language'), value: detailChannel.metadata?.language },
              { label: t('channels.quality'), value: detailChannel.metadata?.quality },
              { label: t('channels.network'), value: detailChannel.metadata?.network },
              { label: t('channels.website'), value: detailChannel.metadata?.website },
              { label: t('channels.drmType'), value: detailChannel.channelDrmType },
              { label: t('channels.sortOrder'), value: detailChannel.order?.toString() },
            ]
          : [{ label: t('channels.group'), value: detailChannel.channelGroup }]),
        {
          label: t('common.status'),
          value:
            detailChannel.metadata?.isWorking === false
              ? t('channels.notWorkingStatus')
              : detailChannel.metadata?.isWorking === true
                ? t('channels.workingStatus')
                : t('channels.untestedStatus'),
        },
        {
          label: t('channels.responseTime'),
          value: detailChannel.metadata?.responseTime
            ? `${detailChannel.metadata.responseTime}ms`
            : undefined,
        },
        {
          label: t('channels.lastTested'),
          value: detailChannel.metadata?.lastTested
            ? new Date(detailChannel.metadata.lastTested).toLocaleString()
            : undefined,
        },
        ...(isAdmin && detailChannel.metrics
          ? [
              { label: t('channels.playCount'), value: String(detailChannel.metrics.playCount ?? 0) },
              { label: t('channels.proxyPlays'), value: String(detailChannel.metrics.proxyPlayCount ?? 0) },
              { label: t('channels.aliveCount'), value: String(detailChannel.metrics.aliveCount ?? 0) },
              { label: t('channels.deadCount'), value: String(detailChannel.metrics.deadCount ?? 0) },
              {
                label: t('channels.unresponsiveCount'),
                value: String(detailChannel.metrics.unresponsiveCount ?? 0),
              },
              {
                label: t('channels.lastPlayed'),
                value: detailChannel.metrics.lastPlayedAt
                  ? new Date(detailChannel.metrics.lastPlayedAt).toLocaleString()
                  : undefined,
              },
              {
                label: t('channels.lastDead'),
                value: detailChannel.metrics.lastDeadAt
                  ? new Date(detailChannel.metrics.lastDeadAt).toLocaleString()
                  : undefined,
              },
            ]
          : []),
        ...(!isAdmin && detailChannel.metrics
          ? [
              { label: t('channels.playCount'), value: String(detailChannel.metrics.playCount ?? 0) },
              { label: t('channels.proxyPlays'), value: String(detailChannel.metrics.proxyPlayCount ?? 0) },
              { label: t('channels.aliveCount'), value: String(detailChannel.metrics.aliveCount ?? 0) },
              { label: t('channels.deadCount'), value: String(detailChannel.metrics.deadCount ?? 0) },
              {
                label: t('channels.unresponsiveCount'),
                value: String(detailChannel.metrics.unresponsiveCount ?? 0),
              },
              {
                label: t('channels.lastPlayed'),
                value: detailChannel.metrics.lastPlayedAt
                  ? new Date(detailChannel.metrics.lastPlayedAt).toLocaleString()
                  : undefined,
              },
              {
                label: t('channels.lastDead'),
                value: detailChannel.metrics.lastDeadAt
                  ? new Date(detailChannel.metrics.lastDeadAt).toLocaleString()
                  : undefined,
              },
            ]
          : []),
      ]
    : [];

  // Table columns based on mode
  const favColumn: DataTableColumn<Channel> = {
    key: 'fav',
    header: (
      <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
        <Heart className="h-3.5 w-3.5 inline" />
      </span>
    ),
    cell: (c) => {
      const isFav = favoriteIds.has(c._id);
      return (
        <button
          onClick={() => toggleFavorite(c._id)}
          disabled={favSyncing.has(c._id)}
          className="flex items-center justify-center h-7 w-7 transition-colors disabled:opacity-50"
          title={isFav ? t('channels.removeFavorite') : t('channels.addFavorite')}
          aria-label={isFav ? t('channels.removeFavorite') : t('channels.addFavorite')}
        >
          <Heart
            className={`h-4 w-4 transition-colors ${isFav ? 'fill-red-500 text-red-500' : 'text-muted-foreground hover:text-red-400'}`}
          />
        </button>
      );
    },
  };

  const tableColumns: DataTableColumn<Channel>[] = isAdmin
    ? [
        favColumn,
        {
          key: 'group',
          header: (
            <ColumnFilter
              label={L('المجموعة', 'Groupe', 'Group')}
              options={filterOptions.group}
              selected={selectedGroups}
              onChange={setSelectedGroups}
              searchable
            />
          ),
          cell: (c) => (
            <span className="text-sm text-muted-foreground truncate">{c.channelGroup || '—'}</span>
          ),
        },
        {
          key: 'country',
          header: (
            <ColumnFilter
              label={L('الدولة', 'Pays', 'Country')}
              options={filterOptions.country}
              selected={selectedCountries}
              onChange={setSelectedCountries}
              searchable
            />
          ),
          cell: (c) => (
            <span className="text-xs text-muted-foreground truncate">
              {c.metadata?.country || '—'}
            </span>
          ),
        },
        {
          key: 'language',
          header: (
            <ColumnFilter
              label={L('اللغة', 'Langue', 'Language')}
              options={filterOptions.language}
              selected={selectedLanguages}
              onChange={setSelectedLanguages}
              searchable
            />
          ),
          cell: (c) => {
            const lang = c.metadata?.language || '';
            const langs = lang
              ? lang
                  .split(',')
                  .map((l: string) => l.trim())
                  .filter(Boolean)
              : [];
            if (langs.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
            return (
              <span
                className="text-xs text-muted-foreground flex items-center gap-1 whitespace-nowrap"
                title={lang}
              >
                {langs[0]}
                {langs.length > 1 && (
                  <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                    +{langs.length - 1}
                  </span>
                )}
              </span>
            );
          },
        },
        {
          key: 'status',
          header: (
            <ColumnFilter
              label={L('الحالة', 'Statut', 'Status')}
              options={filterOptions.status}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
            />
          ),
          cell: (c) => (
            <div className="inline-flex items-center gap-1.5">
              {testing === c._id ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : (
                <StatusDot
                  status={
                    c.metadata?.isWorking === true
                      ? 'alive'
                      : c.metadata?.isWorking === false
                        ? 'dead'
                        : 'untested'
                  }
                  size="sm"
                />
              )}
              <button
                onClick={() => handleTestOne(c)}
                disabled={testing === c._id}
                className="flex items-center justify-center h-6 w-6 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                title={L('اختبار البث', 'Tester le flux', 'Test stream')} aria-label={L('اختبار البث', 'Tester le flux', 'Test stream')}
              >
                <Zap className="h-3 w-3" />
              </button>
              {(() => {
                const viable = c.alternateStreams?.filter((a) => !a.flaggedBad?.isFlagged) ?? [];
                return viable.length > 0 ? (
                  <span
                    className="inline-flex items-center px-1 py-0.5 text-[9px] font-mono font-medium bg-primary/10 text-primary border border-primary/20"
                    title={L(`${viable.length} بث بديل`, `${viable.length} flux alternatif${viable.length > 1 ? 's' : ''}`, `${viable.length} alternate stream${viable.length > 1 ? 's' : ''}`)}
                  >
                    +{viable.length}
                  </span>
                ) : null;
              })()}
            </div>
          ),
        },
        {
          key: 'plays',
          header: (
            <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
              {L('المشاهدات', 'Lectures', 'Plays')}
            </span>
          ),
          cell: (c: Channel) => (
            <span className="text-xs tabular-nums font-display">{c.metrics?.playCount || 0}</span>
          ),
        },
      ]
    : [
        { ...favColumn, mobileHidden: true },
        {
          key: 'group',
          mobileHidden: true,
          ariaSort:
            sortField === 'group' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none',
          header: (
            <div className="relative inline-flex items-center gap-1.5">
              <button
                onClick={() => handleSort('group')}
                className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hover:text-foreground transition-colors text-left"
              >
                {L('المجموعة', 'Groupe', 'Group')} <SortIcon field="group" />
              </button>
              <ColumnFilter
                label=""
                options={groupOptions}
                selected={selectedGroups}
                onChange={(v) => setSelectedGroups(v)}
                searchable
              />
            </div>
          ),
          cell: (c) => (
            <span className="text-sm text-muted-foreground truncate">{c.channelGroup || '—'}</span>
          ),
        },
        {
          key: 'status',
          mobileHidden: true,
          header: (
            <ColumnFilter
              label={L('الحالة', 'Statut', 'Status')}
              options={statusOptions}
              selected={selectedStatuses}
              onChange={(v) => setSelectedStatuses(v)}
            />
          ),
          cell: (c) => (
            <div className="inline-flex items-center gap-1.5">
              {testing === c._id ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : (
                <StatusDot
                  status={
                    c.metadata?.isWorking === true
                      ? 'working'
                      : c.metadata?.isWorking === false
                        ? 'not-working'
                        : 'untested'
                  }
                  size="sm"
                />
              )}
              <button
                onClick={() => handleTestOne(c)}
                disabled={testing === c._id}
                className="flex items-center justify-center h-6 w-6 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                title={L('اختبار البث', 'Tester le flux', 'Test stream')} aria-label={L('اختبار البث', 'Tester le flux', 'Test stream')}
              >
                <Zap className="h-3 w-3" />
              </button>
              {(() => {
                const viable = c.alternateStreams?.filter((a) => !a.flaggedBad?.isFlagged) ?? [];
                return viable.length > 0 ? (
                  <span
                    className="inline-flex items-center px-1 py-0.5 text-[9px] font-mono font-medium bg-primary/10 text-primary border border-primary/20"
                    title={L(`${viable.length} بث بديل`, `${viable.length} flux alternatif${viable.length > 1 ? 's' : ''}`, `${viable.length} alternate stream${viable.length > 1 ? 's' : ''}`)}
                  >
                    +{viable.length}
                  </span>
                ) : null;
              })()}
            </div>
          ),
        },
        {
          key: 'plays',
          mobileHidden: true,
          header: (
            <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
              {L('المشاهدات', 'Lectures', 'Plays')}
            </span>
          ),
          cell: (c: Channel) => (
            <span className="text-xs tabular-nums font-display">{c.metrics?.playCount || 0}</span>
          ),
        },
      ];

  async function handleFlagSubmit() {
    if (!flagTarget) return;
    try {
      const url =
        flagTarget.alternateIndex !== undefined
          ? `/channels/${flagTarget.channelId}/alternates/${flagTarget.alternateIndex}/flag`
          : `/channels/${flagTarget.channelId}/flag`;
      await api.post(url, { reason: flagReason });
      toast(t('channels.streamFlagged'), 'success');
      setShowFlagModal(false);
      setFlagTarget(null);
      fetchChannels();
    } catch {
      toast(t('channels.flagFailed'), 'error');
    }
  }

  async function handleUnflagPrimary(channelId: string) {
    try {
      await api.post(`/channels/${channelId}/unflag`);
      toast(t('channels.flagCleared'), 'success');
      fetchChannels();
    } catch {
      toast(t('channels.flagFailed'), 'error');
    }
  }

  async function handleUnflagAlternate(channelId: string, index: number) {
    try {
      await api.post(`/channels/${channelId}/alternates/${index}/unflag`);
      toast(t('channels.alternateFlagCleared'), 'success');
      fetchChannels();
    } catch {
      toast(t('channels.flagFailed'), 'error');
    }
  }

  async function handlePromoteAlternate(channelId: string, index: number) {
    try {
      const channel = channels.find((c) => c._id === channelId);
      if (!channel?.alternateStreams?.[index]) return;
      const alt = channel.alternateStreams[index];
      const currentUrl = getUrl(channel);
      const newAlternates = [...channel.alternateStreams];
      newAlternates[index] = {
        ...newAlternates[index],
        streamUrl: currentUrl,
        demotedAt: new Date().toISOString(),
      };
      await api.put(`/admin/channels/${channelId}`, {
        channelUrl: alt.streamUrl,
        alternateStreams: newAlternates,
      });
      toast(t('channels.promoteSuccess'), 'success');
      fetchChannels();
    } catch {
      toast(t('channels.promoteFailed'), 'error');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">
              {t('channels.myChannels')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isAdmin
                ? t('channels.totalCount').replace('{count}', String(totalCount))
                : t('channels.channelCount').replace('{count}', String(channels.length))}
            </p>
          </div>
          {/* Primary actions */}
          <div className="flex items-center gap-2">
            <Link
              href={isAdmin ? '/admin/quick-pick' : '/user/quick-pick'}
              className="inline-flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium border-2 border-primary bg-primary/10 text-primary uppercase tracking-[0.1em] transition-colors hover:bg-primary/20"
            >
              <Zap className="h-4 w-4" /> {t('nav.quickPick')}
            </Link>
            <button
              onClick={() => {
                if (isAdmin) {
                  setShowAdd(true);
                  setAddError('');
                } else {
                  setShowAdd(!showAdd);
                }
              }}
              className="inline-flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> {t('channels.addStream')}
            </button>
          </div>
        </div>
        {/* Secondary actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium border-2 border-border bg-card shadow-sm transition-colors hover:border-primary/40 uppercase tracking-[0.1em]"
          >
            <Upload className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {t('channels.importM3u')}
          </button>
          {channels.length > 0 && (
            <button
              onClick={isAdmin ? handleExportCatalogM3U : handleCopyM3U}
              disabled={isAdmin && exportingCatalog}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium border-2 border-border bg-card shadow-sm transition-colors hover:border-primary/40 uppercase tracking-[0.1em] disabled:opacity-50"
            >
              {exportingCatalog ? (
                <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" />
              ) : copied && !isAdmin ? (
                <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-signal-green" />
              ) : (
                <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              )}
              {t('channels.exportM3u')}
            </button>
          )}
          {isAdmin && channels.length > 0 && (
            <button
              onClick={handleExportCatalogCsv}
              disabled={exportingCatalogCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium border-2 border-border bg-card shadow-sm transition-colors hover:border-primary/40 uppercase tracking-[0.1em] disabled:opacity-50"
            >
              {exportingCatalogCsv ? (
                <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              )}
              {locale === 'ar' ? 'تصدير CSV' : locale === 'fr' ? 'Exporter CSV' : 'Export CSV'}
            </button>
          )}
          <button
            onClick={isAdmin ? handleTestAll : handleTestAllUser}
            disabled={testingAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium border-2 border-border bg-card shadow-sm transition-colors hover:border-primary/40 uppercase tracking-[0.1em] disabled:opacity-50"
          >
            {testingAll ? (
              <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            )}
            {t('channels.testAll')}
          </button>
          {channels.length > 0 && (
            <button
              onClick={() => (isAdmin ? setShowBulkDelete(true) : handleBulkDelete())}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium border-2 border-destructive/30 bg-card shadow-sm transition-colors hover:border-destructive/60 text-destructive uppercase tracking-[0.1em]"
            >
              <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {t('channels.deleteAll')}
            </button>
          )}
          {isAdmin && healthStats && healthStats.notWorking > 0 && (
            <button
              onClick={() => setPurgeStatus('dead')}
              title={t('channels.purgeDeadTitle')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium border-2 border-destructive/30 bg-card shadow-sm transition-colors hover:border-destructive/60 text-destructive uppercase tracking-[0.1em]"
            >
              <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {t('channels.purgeDead')} ({healthStats.notWorking})
            </button>
          )}
          {isAdmin && healthStats && healthStats.untested > 0 && (
            <button
              onClick={() => setPurgeStatus('untested')}
              title={t('channels.purgeUntestedTitle')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium border-2 border-border bg-card shadow-sm transition-colors hover:border-primary/40 uppercase tracking-[0.1em]"
            >
              <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {t('channels.purgeUntested')} ({healthStats.untested})
            </button>
          )}
        </div>
      </div>

      <section className={`rounded-lg border px-4 py-3 ${channelsReadinessTone}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em]">{L('ملخص تشغيلي للكتالوج', 'Résumé opérationnel du catalogue', 'Catalog operational summary')}</p>
            <p className="mt-2 text-lg font-bold">{channelsReadinessLabel}</p>
            <p className="mt-1 text-sm opacity-90">{channelsReadinessMessage}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
            <div>
              <div className="text-xs opacity-70">{L('إجمالي القنوات', 'Total chaînes', 'Total channels')}</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{displayTotalCount}</div>
            </div>
            <div>
              <div className="text-xs opacity-70">{L('سليمة', 'Saines', 'Working')}</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{workingCount}</div>
            </div>
            <div>
              <div className="text-xs opacity-70">{L('متعطلة', 'En panne', 'Broken')}</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{deadCount}</div>
            </div>
            <div>
              <div className="text-xs opacity-70">{L('غير مختبرة', 'Non testées', 'Untested')}</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{untestedCount}</div>
            </div>
            <div>
              <div className="text-xs opacity-70">{L('بث بديل جاهز', 'Alternatives prêtes', 'Channels with alternates')}</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{alternateReadyCount}</div>
            </div>
          </div>
        </div>
        {(flaggedPrimaryCount > 0 || selectedRows.size > 0 || (isAdmin && catchupReadyCount > 0) || (isAdmin && epgLinkedCount > 0)) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs opacity-90">
            {isAdmin && catchupReadyCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-background/70 px-2.5 py-1">
                {L('جاهزة لـ Catch-up', 'Prêtes pour le catch-up', 'Catch-up ready')}: <strong className="ms-1">{catchupReadyCount}</strong>
              </span>
            )}
            {isAdmin && epgLinkedCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-background/70 px-2.5 py-1">
                {L('مرتبطة بـ EPG', 'Liées à l’EPG', 'EPG linked')}: <strong className="ms-1">{epgLinkedCount}</strong>
              </span>
            )}
            {flaggedPrimaryCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-background/70 px-2.5 py-1">
                {L('قنوات مُعلّمة كمشكلة', 'Chaînes signalées', 'Flagged channels')}: <strong className="ms-1">{flaggedPrimaryCount}</strong>
              </span>
            )}
            {isAdmin && selectedRows.size > 0 && (
              <span className="inline-flex items-center rounded-full bg-background/70 px-2.5 py-1">
                {L('محددة للعمل الجماعي', 'Sélectionnées pour action groupée', 'Selected for bulk action')}: <strong className="ms-1">{selectedRows.size}</strong>
              </span>
            )}
          </div>
        )}
      </section>

      {/* Test results banner */}
      {testResults && (
        <div className="border border-border bg-muted/50 px-4 py-3 text-sm flex items-center justify-between">
          <span>
            {t('channels.testComplete')
              .replace('{working}', String(testResults.working))
              .replace('{failed}', String(testResults.failed))}
          </span>
          <button
            onClick={() => setTestResults(null)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* User: Add from system panel */}
      {!isAdmin && showAdd && (
        <div className="border-2 border-primary/30 bg-card p-5 space-y-4">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">
            {t('channels.addToMyList')}
          </h2>
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t('channels.searchAvailable')}
              value={addSearch}
              onChange={(e) => {
                handleAddSearchChange(e.target.value);
                setAddPage(1);
              }}
              className="w-full h-10 ps-10 pe-4 border border-border bg-background text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
              aria-label={t('channels.searchAvailable')}
            />
          </div>
          <div className="max-h-64 overflow-y-auto border border-border divide-y divide-border">
            {availableChannels.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                {addChannelsError ? (
                  <span className="text-destructive">{addChannelsError}</span>
                ) : allChannelsLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> {L('جارٍ تحميل القنوات...', 'Chargement des chaînes…', 'Loading channels...')}
                  </span>
                ) : (
                  t('channels.noAvailable')
                )}
              </div>
            ) : (
              availableChannels.map((ch) => (
                <label
                  key={ch._id}
                  className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(ch._id)}
                    onChange={(e) => {
                      const next = new Set(selectedIds);
                      if (e.target.checked) next.add(ch._id);
                      else next.delete(ch._id);
                      setSelectedIds(next);
                    }}
                    className="accent-primary"
                  />
                  <ChannelLogo src={getLogo(ch)} alt={getName(ch)} size="sm" />
                  <span className="text-sm font-medium flex-1 truncate">{getName(ch)}</span>
                  <span className="text-xs text-muted-foreground">{ch.channelGroup || ''}</span>
                </label>
              ))
            )}
          </div>
          {allChannelsTotal > 50 && (
            <div className="flex justify-center border-t border-border pt-3">
              <Pagination
                page={addPage}
                pageSize={50}
                totalCount={allChannelsTotal}
                onPageChange={setAddPage}
              />
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={handleAddChannels}
              disabled={selectedIds.size === 0}
              className="px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
            >
              {t('channels.addSelected')
                .replace('{count}', String(selectedIds.size))
                .replace('{plural}', selectedIds.size !== 1 ? 's' : '')}
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setSelectedIds(new Set());
              }}
              className="px-6 py-2.5 text-sm font-medium border border-border uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <SearchInput
        value={search}
        onChange={handleSearchChange}
        placeholder={isAdmin ? t('channels.search') : t('channels.searchMine')}
        ariaLabel={t('channels.search')}
      />

      {/* Stream health stats — admins can click a stat to filter the list by it */}
      {(() => {
        const list = isAdmin ? channels : filtered;
        const working =
          isAdmin && healthStats
            ? healthStats.working
            : list.filter((c) => c.metadata?.isWorking === true).length;
        const notWorking =
          isAdmin && healthStats
            ? healthStats.notWorking
            : list.filter((c) => c.metadata?.isWorking === false).length;
        const untested =
          isAdmin && healthStats ? healthStats.untested : list.length - working - notWorking;
        const statusFilterActive = isAdmin && selectedStatuses.length > 0;
        const toggleStatusQuickFilter = (value: string) => {
          setSelectedStatuses((prev) =>
            prev.length === 1 && prev[0] === value ? [] : [value],
          );
        };
        const quickBtn = (
          value: string,
          count: number,
          label: string,
          colorClass: string,
        ) => {
          const active = statusFilterActive && selectedStatuses.includes(value);
          return (
            <button
              type="button"
              onClick={() => toggleStatusQuickFilter(value)}
              aria-pressed={active}
              title={label}
              className={`font-medium transition-all rounded-sm px-1 -mx-1 ${colorClass} ${
                active
                  ? 'underline underline-offset-4 decoration-2 bg-background/60'
                  : 'hover:underline hover:underline-offset-4 opacity-90 hover:opacity-100'
              }`}
            >
              {label.replace('{count}', String(count))}
            </button>
          );
        };
        return (
          <div className="flex items-center gap-4 px-4 py-2.5 bg-muted/50 border border-border text-xs">
            <Zap className="h-4 w-4 text-muted-foreground shrink-0" />
            {isAdmin ? (
              <>
                {quickBtn('Live', working, t('channels.working'), 'text-signal-green')}
                {quickBtn('Dead', notWorking, t('channels.notWorking'), 'text-signal-red')}
                {quickBtn('Untested', untested, t('channels.untested'), 'text-muted-foreground')}
                {statusFilterActive && (
                  <button
                    type="button"
                    onClick={() => setSelectedStatuses([])}
                    className="ms-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3 w-3" />
                    {t('channels.showAll')}
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="text-signal-green font-medium">{t('channels.working').replace('{count}', String(working))}</span>
                <span className="text-signal-red font-medium">{t('channels.notWorking').replace('{count}', String(notWorking))}</span>
                <span className="text-muted-foreground font-medium">{t('channels.untested').replace('{count}', String(untested))}</span>
                {filtered.length !== channels.length && (
                  <span className="text-muted-foreground">
                    {t('channels.showing')
                      .replace('{shown}', String(filtered.length))
                      .replace('{total}', String(channels.length))}
                  </span>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* Channel List */}
      {isAdmin && selectedRows.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border border-primary/40 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium">
            {locale === 'ar'
              ? `${selectedRows.size} قناة محددة`
              : locale === 'fr'
                ? `${selectedRows.size} chaînes sélectionnées`
                : `${selectedRows.size} channels selected`}
          </span>
          <span className="flex-1" />
          <button
            onClick={() => handleBulkSelection('enable')}
            disabled={bulkSelectionLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-signal-green/40 text-signal-green hover:bg-signal-green/5 disabled:opacity-50 transition-colors"
          >
            <Check className="h-3.5 w-3.5" />
            {locale === 'ar' ? 'تفعيل' : locale === 'fr' ? 'Activer' : 'Enable'}
          </button>
          <button
            onClick={() => handleBulkSelection('disable')}
            disabled={bulkSelectionLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-signal-amber/40 text-signal-amber hover:bg-signal-amber/5 disabled:opacity-50 transition-colors"
          >
            <Ban className="h-3.5 w-3.5" />
            {locale === 'ar' ? 'تعطيل' : locale === 'fr' ? 'Désactiver' : 'Disable'}
          </button>
          <button
            onClick={() => handleBulkSelection('delete')}
            disabled={bulkSelectionLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-destructive/40 text-destructive hover:bg-destructive/5 disabled:opacity-50 transition-colors"
          >
            {bulkSelectionLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {locale === 'ar' ? 'حذف' : locale === 'fr' ? 'Supprimer' : 'Delete'}
          </button>
          <button
            onClick={() => setSelectedRows(new Set())}
            disabled={bulkSelectionLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            {locale === 'ar' ? 'إلغاء التحديد' : locale === 'fr' ? 'Désélectionner' : 'Clear selection'}
          </button>
        </div>
      )}

      <ChannelDataTable<Channel>
        data={displayData}
        gridTemplate={
          isAdmin
            ? `40px 1fr 40px 1fr 100px 100px 120px 70px 110px`
            : '1fr 40px 180px 130px 60px 110px'
        }
        ariaLabel={isAdmin ? t('channels.tableAria') : t('channels.myTableAria')}
        emptyMessage={
          debouncedSearch
            ? t('channels.noSearchMatch')
            : isAdmin
              ? t('channels.noChannelsYet')
              : t('channels.noMineYet')
        }
        rowKey={(c) => c._id}
        getName={getName}
        getLogo={getLogo}
        onDetail={(c) => setDetailChannel(c)}
        selectableHeader={
          isAdmin ? (
            <input
              type="checkbox"
              aria-label={
                locale === 'ar'
                  ? 'تحديد كل قنوات هذه الصفحة'
                  : locale === 'fr'
                    ? 'Sélectionner toutes les chaînes de cette page'
                    : 'Select all channels on this page'
              }
              checked={displayData.length > 0 && displayData.every((c) => selectedRows.has(c._id))}
              onChange={(e) => {
                const next = new Set(selectedRows);
                if (e.target.checked) displayData.forEach((c) => next.add(c._id));
                else displayData.forEach((c) => next.delete(c._id));
                setSelectedRows(next);
              }}
              className="accent-primary"
            />
          ) : undefined
        }
        renderSelectCell={
          isAdmin
            ? (c) => (
                <input
                  type="checkbox"
                  aria-label={
                    locale === 'ar'
                      ? `تحديد ${getName(c)}`
                      : locale === 'fr'
                        ? `Sélectionner ${getName(c)}`
                        : `Select ${getName(c)}`
                  }
                  checked={selectedRows.has(c._id)}
                  onChange={(e) => {
                    const next = new Set(selectedRows);
                    if (e.target.checked) next.add(c._id);
                    else next.delete(c._id);
                    setSelectedRows(next);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="accent-primary"
                />
              )
            : undefined
        }
        nameHeader={
          !isAdmin ? (
            <button
              onClick={() => handleSort('name')}
              className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hover:text-foreground transition-colors text-left"
            >
              {t('common.name')} <SortIcon field="name" />
            </button>
          ) : undefined
        }
        nameAriaSort={
          !isAdmin
            ? sortField === 'name'
              ? sortDir === 'asc'
                ? 'ascending'
                : 'descending'
              : 'none'
            : undefined
        }
        columns={tableColumns}
        getActions={(c) => ({
          onDetail: () => setDetailChannel(c),
          onPlay: () =>
            playStream(
              {
                name: getName(c),
                url: getUrl(c),
                id: c._id,
                channelId: c.channelId,
                alternateUrls: c.alternateStreams
                  ?.filter((a) => !a.flaggedBad?.isFlagged)
                  .map((a) => a.streamUrl),
              },
              { mode: 'proxy' },
            ),
          onEdit: isAdmin ? () => openEdit(c) : undefined,
          onDelete: () => handleDelete(c._id),
        })}
      />

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={displayTotalCount}
        onPageChange={setPage}
      />

      {/* Admin: إضافة قناة Modal */}
      {isAdmin && (
        <Modal
          open={showAdd}
          onClose={() => {
            setShowAdd(false);
            setAddError('');
          }}
          title="إضافة قناة جديدة"
          size="lg"
        >
          <form onSubmit={handleAddChannel} className="p-5 space-y-4">
            {addError && (
              <div
                role="alert"
                className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {addError}
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              {(
                [
                  {
                    id: 'add-name',
                    label: t('channels.channelName'),
                    key: 'channelName' as const,
                    required: true,
                    placeholder: t('channels.namePlaceholder'),
                  },
                  {
                    id: 'add-url',
                    label: t('sources.streamUrl'),
                    key: 'channelUrl' as const,
                    required: true,
                    placeholder: 'https://...',
                    type: 'url',
                  },
                  {
                    id: 'add-group',
                    label: t('channels.group'),
                    key: 'channelGroup' as const,
                    placeholder: t('channels.groupPlaceholder'),
                  },
                  {
                    id: 'add-logo',
                    label: t('sources.logoUrl'),
                    key: 'tvgLogo' as const,
                    placeholder: t('channels.logoPlaceholder'),
                  },
                  {
                    id: 'add-drm-key',
                    label: t('channels.drmKey'),
                    key: 'channelDrmKey' as const,
                    placeholder: t('channels.drmKeyPlaceholder'),
                  },
                  {
                    id: 'add-drm-type',
                    label: t('channels.drmType'),
                    key: 'channelDrmType' as const,
                    placeholder: t('channels.drmTypePlaceholder'),
                  },
                ] as const
              ).map((f) => (
                <div key={f.id} className="space-y-1.5">
                  <label
                    htmlFor={f.id}
                    className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground"
                  >
                    {f.label}
                  </label>
                  <input
                    id={f.id}
                    type={'type' in f ? f.type : 'text'}
                    required={'required' in f && f.required}
                    value={addForm[f.key] as string}
                    onChange={(e) => setAddForm((p) => ({ ...p, [f.key]: e.target.value }))}
                    className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
                    placeholder={f.placeholder}
                  />
                </div>
              ))}
              <div className="space-y-1.5">
                <label
                  htmlFor="add-order"
                  className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground"
                >
                  {t('channels.sortOrder')}
                </label>
                <input
                  id="add-order"
                  type="number"
                  value={addForm.order}
                  onChange={(e) =>
                    setAddForm((p) => ({ ...p, order: parseInt(e.target.value) || 0 }))
                  }
                  className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('channels.sortHint')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={addLoading}
                aria-busy={addLoading}
                className="inline-flex items-center px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
              >
                {addLoading ? t('channels.creating') : t('channels.create')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAdd(false);
                  setAddError('');
                }}
                className="px-6 py-2.5 text-sm font-medium border border-border uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Admin: Edit Channel Modal */}
      {isAdmin && (
        <Modal
          open={!!editChannel}
          onClose={() => setEditChannel(null)}
          title="تعديل القناة"
          size="lg"
        >
          <form onSubmit={handleEditSave} className="p-5 space-y-4">
            {editError && (
              <div
                role="alert"
                className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {editError}
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              {(
                [
                  {
                    id: 'edit-name',
                    label: t('channels.channelName'),
                    key: 'channelName' as const,
                    required: true,
                  },
                  {
                    id: 'edit-url',
                    label: t('sources.streamUrl'),
                    key: 'channelUrl' as const,
                    required: true,
                    type: 'url',
                  },
                  { id: 'edit-group', label: t('channels.group'), key: 'channelGroup' as const },
                  { id: 'edit-logo', label: t('sources.logoUrl'), key: 'tvgLogo' as const },
                  { id: 'edit-drm-key', label: t('channels.drmKey'), key: 'channelDrmKey' as const },
                  { id: 'edit-drm-type', label: t('channels.drmType'), key: 'channelDrmType' as const },
                  { id: 'edit-country', label: t('sources.country'), key: 'country' as const },
                  { id: 'edit-language', label: t('sources.language'), key: 'language' as const },
                  { id: 'edit-quality', label: t('channels.quality'), key: 'quality' as const },
                  { id: 'edit-network', label: t('channels.network'), key: 'network' as const },
                  { id: 'edit-website', label: t('channels.website'), key: 'website' as const },
                ] as const
              ).map((f) => (
                <div key={f.id} className="space-y-1.5">
                  <label
                    htmlFor={f.id}
                    className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground"
                  >
                    {f.label}
                  </label>
                  <input
                    id={f.id}
                    type={'type' in f ? f.type : 'text'}
                    required={'required' in f && f.required}
                    value={editForm[f.key] as string}
                    onChange={(e) => setEditForm((p) => ({ ...p, [f.key]: e.target.value }))}
                    className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
                  />
                </div>
              ))}
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-order"
                  className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground"
                >
                  {t('channels.sortOrder')}
                </label>
                <input
                  id="edit-order"
                  type="number"
                  value={editForm.order}
                  onChange={(e) =>
                    setEditForm((p) => ({ ...p, order: parseInt(e.target.value) || 0 }))
                  }
                  className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('channels.sortHint')}
                </p>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-alternates"
                  className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground"
                >
                  {t('channels.alternateUrls')}
                </label>
                <textarea
                  id="edit-alternates"
                  rows={4}
                  value={editForm.alternateUrls}
                  onChange={(e) => setEditForm((p) => ({ ...p, alternateUrls: e.target.value }))}
                  placeholder={t('channels.oneUrlPerLine')}
                  className="flex w-full border border-border bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary resize-y min-h-[80px]"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('channels.alternateHint')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={editLoading}
                aria-busy={editLoading}
                className="inline-flex items-center px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {editLoading ? t('channels.saving') : 'حفظ التغييرات'}
              </button>
              <button
                type="button"
                onClick={() => setEditChannel(null)}
                className="px-6 py-2.5 text-sm font-medium border border-border uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <ChannelDetailModal
        open={!!detailChannel}
        onClose={() => setDetailChannel(null)}
        channel={
          detailChannel
            ? {
                channelName: getName(detailChannel),
                channelId: detailChannel.channelId,
                tvgLogo: getLogo(detailChannel),
                channelUrl: getUrl(detailChannel),
                summary: detailChannel.channelGroup || 'Uncategorized',
                flaggedBad: detailChannel.flaggedBad,
                alternateStreams: detailChannel.alternateStreams,
              }
            : null
        }
        fields={detailFields}
        isAdmin={mode === 'admin'}
        onPlay={
          detailChannel
            ? () => {
                playStream(
                  {
                    name: getName(detailChannel),
                    url: getUrl(detailChannel),
                    channelId: detailChannel._id,
                    alternateUrls: detailChannel.alternateStreams
                      ?.filter((a) => !a.flaggedBad?.isFlagged)
                      .map((a) => a.streamUrl),
                  },
                  { mode: 'direct-fallback' },
                );
                setDetailChannel(null);
              }
            : undefined
        }
        onFlagPrimary={
          detailChannel
            ? () => {
                setFlagTarget({ channelId: detailChannel._id });
                setFlagReason('looping');
                setShowFlagModal(true);
              }
            : undefined
        }
        onUnflagPrimary={detailChannel ? () => handleUnflagPrimary(detailChannel._id) : undefined}
        onFlagAlternate={
          detailChannel
            ? (index: number) => {
                setFlagTarget({ channelId: detailChannel._id, alternateIndex: index });
                setFlagReason('looping');
                setShowFlagModal(true);
              }
            : undefined
        }
        onUnflagAlternate={
          detailChannel
            ? (index: number) => handleUnflagAlternate(detailChannel._id, index)
            : undefined
        }
        onPromoteAlternate={
          isAdmin && detailChannel
            ? (index: number) => handlePromoteAlternate(detailChannel._id, index)
            : undefined
        }
        actions={
          isAdmin && detailChannel ? (
            <button
              onClick={() => {
                openEdit(detailChannel);
                setDetailChannel(null);
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium border border-border uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
            >
              Edit
            </button>
          ) : undefined
        }
      />

      {/* Admin: Bulk Delete Confirmation */}
      {isAdmin && (
        <ConfirmDialog
          open={showBulkDelete}
          title="حذف جميع القنوات"
          message={t('channels.deleteAllConfirm').replace('{count}', String(totalCount))}
          confirmLabel={t('channels.deleteAll')}
          variant="destructive"
          loading={bulkDeleteLoading}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowBulkDelete(false)}
        />
      )}

      {/* Admin: Purge dead/untested Confirmation */}
      {isAdmin && (
        <ConfirmDialog
          open={purgeStatus !== null}
          title={purgeStatus === 'dead' ? t('channels.purgeDeadTitle') : t('channels.purgeUntestedTitle')}
          message={
            purgeStatus === 'dead'
              ? t('channels.purgeDeadConfirm').replace('{count}', String(healthStats?.notWorking ?? 0))
              : t('channels.purgeUntestedConfirm').replace('{count}', String(healthStats?.untested ?? 0))
          }
          confirmLabel={purgeStatus === 'dead' ? t('channels.purgeDead') : t('channels.purgeUntested')}
          variant="destructive"
          loading={purgeLoading}
          onConfirm={handlePurgeByStatus}
          onCancel={() => setPurgeStatus(null)}
        />
      )}

      {/* M3U Import Modal */}
      <Modal
        open={showImport}
        onClose={() => setShowImport(false)}
        title={t('channels.importTitle')}
        size="lg"
      >
        <form onSubmit={handleImport} className="p-5 space-y-4">
          {importResult && (
            <div
              className={`border px-3 py-2 text-sm ${importSuccess ? 'border-signal-green/40 bg-signal-green/10 text-signal-green' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}
            >
              {importResult}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
              {t('channels.m3uContent')}
            </label>
            <textarea
              value={importContent}
              onChange={(e) => setImportContent(e.target.value)}
              rows={10}
              required
              className="w-full border border-border bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary resize-y"
              placeholder={
                '#EXTM3U\n#EXTINF:-1 tvg-name="Channel" group-title="Group",Channel Name\nhttp://stream.url/live'
              }
            />
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
            >
              <Upload className="h-4 w-4" /> {t('channels.uploadFile')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".m3u,.m3u8"
              onChange={handleFileUpload}
              className="hidden"
            />
            {isAdmin && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={importClear}
                  onChange={(e) => setImportClear(e.target.checked)}
                  className="accent-primary"
                />
                {t('channels.clearBeforeImport')}
              </label>
            )}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={importLoading || !importContent.trim()}
              className="inline-flex items-center px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {importLoading ? t('channels.importing') : t('channels.importAction')}
            </button>
            <button
              type="button"
              onClick={() => setShowImport(false)}
              className="px-6 py-2.5 text-sm font-medium border border-border uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Flag Bad Stream Modal */}
      <Modal
        open={showFlagModal}
        onClose={() => {
          setShowFlagModal(false);
          setFlagTarget(null);
        }}
        title={mode === 'admin' ? t('channels.flagBadTitle') : t('channels.reportBadTitle')}
        size="default"
      >
        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            {mode === 'admin' ? t('channels.reportBadDescription') : t('channels.reportDescription')}
          </p>
          <div className="space-y-2">
            {[
              { value: 'looping', label: t('channels.looping') },
              { value: 'frozen', label: t('channels.frozen') },
              { value: 'wrong-content', label: t('channels.wrongContent') },
              { value: 'other', label: t('channels.other') },
            ].map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="flagReason"
                  value={opt.value}
                  checked={flagReason === opt.value}
                  onChange={() => setFlagReason(opt.value)}
                  className="accent-primary"
                />
                {opt.label}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleFlagSubmit}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-signal-red text-white uppercase tracking-[0.1em] transition-colors hover:bg-signal-red/90"
            >
              <Flag className="h-4 w-4" />
              {mode === 'admin' ? t('channels.flagStream') : t('channels.report')}
            </button>
            <button
              onClick={() => {
                setShowFlagModal(false);
                setFlagTarget(null);
              }}
              className="px-5 py-2.5 text-sm font-medium border border-border uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
