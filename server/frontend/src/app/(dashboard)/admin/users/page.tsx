'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  Search,
  Trash2,
  Shield,
  User,
  UserPlus,
  Copy,
  Check,
  ToggleLeft,
  ToggleRight,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Download,
} from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useLocale } from '@/components/locale-provider';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';
import Pagination from '@/components/ui/pagination';
import Modal from '@/components/ui/modal';
import ColumnFilter from '@/components/ui/column-filter';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import DataTable, { type DataTableColumn } from '@/components/ui/data-table';

interface UserData {
  _id: string;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLogin?: string;
  createdAt?: string;
  channelListCode?: string;
  channelCount?: number;
  lastActivity?: string;
  devicesInUse?: number;
  subscription?: {
    planId?: string;
    planName?: string;
    status?: string;
    startsAt?: string | null;
    expiresAt?: string | null;
  } | null;
}

export default function UsersPage() {
  const { toast } = useToast();
  const { t, locale } = useLocale();
  const router = useRouter();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const { search, debouncedSearch, handleSearchChange } = useDebouncedSearch('', 300);
  const [error, setError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; username: string } | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 50;

  // Column filter state
  const [filterOptions, setFilterOptions] = useState<{ role: string[]; status: string[] }>({
    role: [],
    status: [],
  });
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);

  // Sort state
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Add user form state
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('User');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');

  const fetchUsers = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (selectedRoles.length > 0 && selectedRoles.length < filterOptions.role.length) {
          params.set('role', selectedRoles.join(','));
        }
        if (selectedStatuses.length > 0 && selectedStatuses.length < filterOptions.status.length) {
          params.set('status', selectedStatuses.join(','));
        }
        if (sortBy) {
          params.set('sortBy', sortBy);
          params.set('sortOrder', sortOrder);
        }
        const res = await api.get(`/users?${params.toString()}`, { signal });
        const body = res.data;
        setUsers(Array.isArray(body) ? body : body.data || body.users || []);
        setTotalCount(body.totalCount ?? (Array.isArray(body) ? body.length : body.count || 0));
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const axiosErr = err as { code?: string };
        if (axiosErr.code === 'ERR_CANCELED') return;
        setError('فشل تحميل المستخدمين');
      } finally {
        setLoading(false);
      }
    },
    [page, debouncedSearch, selectedRoles, selectedStatuses, filterOptions, sortBy, sortOrder],
  );

  // Fetch filter options once
  useEffect(() => {
    async function loadFilterOptions() {
      try {
        const res = await api.get('/users/filter-options');
        setFilterOptions(res.data.data || { role: [], status: [] });
      } catch {
        /* ignore */
      }
    }
    loadFilterOptions();
  }, []);

  // Fetch users when filters/page/search change
  useEffect(() => {
    const controller = new AbortController();
    fetchUsers(controller.signal);
    return () => controller.abort();
  }, [fetchUsers]);

  function handleDelete(e: React.MouseEvent, id: string, username: string) {
    e.stopPropagation();
    setDeleteConfirm({ id, username });
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    try {
      await api.delete(`/users/${deleteConfirm.id}`);
      // Refetch so totalCount and pagination stay accurate after a delete.
      await fetchUsers();
    } catch {
      toast('فشل حذف المستخدم', 'error');
    } finally {
      setDeleteConfirm(null);
    }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    setAddLoading(true);
    try {
      await api.post('/users', {
        username: newUsername,
        email: newEmail,
        password: newPassword,
        role: newRole,
      });
      setShowAddForm(false);
      setNewUsername('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('User');
      fetchUsers();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setAddError(
        axiosErr.response?.data?.error ||
          (locale === 'ar'
            ? 'فشل إنشاء المستخدم'
            : locale === 'fr'
              ? 'Échec de la création de l’utilisateur'
              : 'Failed to create user'),
      );
    } finally {
      setAddLoading(false);
    }
  }

  function handleCopyCode(e: React.MouseEvent, code: string) {
    e.stopPropagation();
    navigator.clipboard.writeText(code).catch(() => {});
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1500);
  }

  // Export current filtered user list as CSV (respects search + filters).
  const [exportingCsv, setExportingCsv] = useState(false);
  async function handleExportCsv() {
    if (exportingCsv) return;
    setExportingCsv(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (selectedRoles.length > 0 && selectedRoles.length < filterOptions.role.length) {
        params.set('role', selectedRoles.join(','));
      }
      if (selectedStatuses.length > 0 && selectedStatuses.length < filterOptions.status.length) {
        params.set('status', selectedStatuses.join(','));
      }
      const res = await api.get(`/users/export/csv?${params.toString()}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dzhoof-users-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(
        locale === 'ar' ? 'تم تصدير المستخدمين' : locale === 'fr' ? 'Utilisateurs exportés' : 'Users exported',
        'success',
      );
    } catch {
      toast(
        locale === 'ar' ? 'فشل تصدير المستخدمين' : locale === 'fr' ? 'Échec de l’export' : 'Failed to export users',
        'error',
      );
    } finally {
      setExportingCsv(false);
    }
  }

  async function handleToggleActive(e: React.MouseEvent, user: UserData) {
    e.stopPropagation();
    try {
      await api.put(`/users/${user._id}`, { isActive: !user.isActive });
      setUsers((prev) =>
        prev.map((u) => (u._id === user._id ? { ...u, isActive: !user.isActive } : u)),
      );
    } catch {
      toast('فشل تحديث حالة المستخدم', 'error');
    }
  }

  // Reset to page 1 when search, filters, or sort change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, selectedRoles, selectedStatuses, sortBy, sortOrder]);

  function handleSort(column: string) {
    if (sortBy === column) {
      if (sortOrder === 'desc') {
        setSortOrder('asc');
      } else {
        setSortBy(null);
        setSortOrder('desc');
      }
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  }

  // Data is already filtered & paginated server-side
  const paginated = users;

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
          <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">{t('admin.users')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{totalCount} {t('admin.registeredUsers')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={exportingCsv}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-2 border-border bg-card uppercase tracking-[0.1em] transition-colors hover:border-primary/40 disabled:opacity-50"
          >
            {exportingCsv ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {locale === 'ar' ? 'تصدير CSV' : locale === 'fr' ? 'Exporter CSV' : 'Export CSV'}
          </button>
          <button
            onClick={() => {
              setShowAddForm(true);
              setAddError('');
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90 active:bg-primary/80"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {locale === 'ar' ? 'إضافة مستخدم' : locale === 'fr' ? 'Ajouter un utilisateur' : 'Add User'}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder={t('admin.searchPlaceholder')}
          aria-label={t('admin.searchUsers')}
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full h-10 ps-10 pe-4 border border-border bg-card text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
        />
      </div>

      <DataTable<UserData>
        data={paginated}
        gridTemplate="1fr 1fr 140px 100px 120px 80px 80px 80px 160px"
        ariaLabel={locale === 'ar' ? 'جدول المستخدمين' : locale === 'fr' ? 'Tableau des utilisateurs' : 'Users table'}
        emptyMessage={
          debouncedSearch
            ? locale === 'ar'
              ? 'لا يوجد مستخدمون يطابقون بحثك'
              : locale === 'fr'
                ? 'Aucun utilisateur ne correspond à votre recherche'
                : 'No users match your search'
            : locale === 'ar'
              ? 'لا يوجد مستخدمون مسجلون بعد. اضغط «إضافة مستخدم» لدعوة أعضاء الفريق.'
              : locale === 'fr'
                ? 'Aucun utilisateur inscrit pour le moment. Cliquez sur « Ajouter un utilisateur » pour inviter des membres.'
                : 'No users registered yet. Click "Add User" to invite team members.'
        }
        rowKey={(u) => u._id}
        breakpoint="md"
        onRowClick={(u) => router.push(`/admin/users/${u._id}`)}
        rowAriaLabel={(u) =>
          locale === 'ar'
            ? `المستخدم: ${u.username}`
            : locale === 'fr'
              ? `Utilisateur : ${u.username}`
              : `User: ${u.username}`
        }
        columns={
          [
            {
              key: 'username',
              header: (
                <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                  اسم المستخدم
                </span>
              ),
              cell: (u) => (
                <div className="flex items-center gap-2.5 min-w-0">
                  {u.role === 'Admin' ? (
                    <>
                      <Shield className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                      <span className="sr-only">
                        {locale === 'ar' ? 'مسؤول' : 'Admin'}
                      </span>
                    </>
                  ) : (
                    <>
                      <User className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                      <span className="sr-only">
                        {locale === 'ar' ? 'مستخدم' : locale === 'fr' ? 'Utilisateur' : 'User'}
                      </span>
                    </>
                  )}
                  <span className="text-sm font-medium truncate">{u.username}</span>
                </div>
              ),
            },
            {
              key: 'email',
              header: (
                <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                  البريد الإلكتروني
                </span>
              ),
              cell: (u) => (
                <span className="text-sm text-muted-foreground truncate">{u.email}</span>
              ),
            },
            {
              key: 'lastActivity',
              header: (
                <button
                  onClick={() => handleSort('lastActivity')}
                  className="inline-flex items-center gap-1 text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hover:text-foreground transition-colors"
                >
                  {locale === 'ar' ? 'آخر نشاط' : locale === 'fr' ? 'Dernière activité' : 'Last Activity'}
                  {sortBy === 'lastActivity' ? (
                    sortOrder === 'desc' ? (
                      <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUp className="h-3 w-3" />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                  )}
                </button>
              ),
              cell: (u) => (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {u.lastActivity
                    ? new Date(u.lastActivity).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })
                    : '—'}
                </span>
              ),
            },
            {
              key: 'userChannels',
              header: (
                <button
                  onClick={() => handleSort('channelCount')}
                  className="inline-flex items-center gap-1 text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium hover:text-foreground transition-colors"
                >
                  {locale === 'ar' ? 'قنوات المستخدم' : locale === 'fr' ? 'Chaînes' : 'User Ch.'}
                  {sortBy === 'channelCount' ? (
                    sortOrder === 'desc' ? (
                      <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUp className="h-3 w-3" />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                  )}
                </button>
              ),
              cell: (u) => (
                <span className="text-sm text-muted-foreground tabular-nums">
                  {u.channelCount ?? 0}
                </span>
              ),
            },
            {
              key: 'channelCode',
              header: (
                <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                  {locale === 'ar' ? 'رمز القناة' : locale === 'fr' ? 'Code chaîne' : 'Channel Code'}
                </span>
              ),
              cell: (u) => (
                <div className="flex items-center gap-1.5 min-w-0">
                  <code className="text-xs font-mono bg-muted px-1.5 py-0.5 truncate">
                    {u.channelListCode || '—'}
                  </code>
                  {u.channelListCode && (
                    <button
                      onClick={(e) => handleCopyCode(e, u.channelListCode!)}
                      className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="نسخ إلى الحافظة"
                    >
                      {copiedCode === u.channelListCode ? (
                        <Check className="h-3 w-3 text-signal-green" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  )}
                </div>
              ),
            },
            {
              key: 'role',
              header: (
                <ColumnFilter
                  label="الدور"
                  options={filterOptions.role}
                  selected={selectedRoles}
                  onChange={setSelectedRoles}
                />
              ),
              cell: (u) => (
                <span className="text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  {u.role}
                </span>
              ),
            },
            {
              key: 'status',
              header: (
                <ColumnFilter
                  label="الحالة"
                  options={filterOptions.status}
                  selected={selectedStatuses}
                  onChange={setSelectedStatuses}
                />
              ),
              cell: (u) => (
                <div className="relative inline-flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${u.isActive ? 'bg-signal-green' : 'bg-signal-red'}`}
                    aria-hidden="true"
                  />
                  <span className="text-xs text-muted-foreground">
                    {u.isActive ? 'نشط' : 'غير نشط'}
                  </span>
                </div>
              ),
            },
            {
              key: 'subscription',
              mobileHidden: true,
              header: (
                <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                  {locale === 'ar' ? 'الاشتراك' : locale === 'fr' ? 'Abonnement' : 'Subscription'}
                </span>
              ),
              cell: (u) => {
                const sub = u.subscription;
                if (!sub?.planName) {
                  return (
                    <span className="text-xs text-muted-foreground">
                      {locale === 'ar' ? 'لا يوجد' : locale === 'fr' ? 'Aucun' : 'None'}
                    </span>
                  );
                }
                const statusCls =
                  sub.status === 'ACTIVE'
                    ? 'bg-signal-green/10 text-signal-green border-signal-green/30'
                    : sub.status === 'EXPIRED'
                      ? 'bg-signal-red/10 text-signal-red border-signal-red/30'
                      : 'bg-muted text-muted-foreground border-border';
                const statusLabel =
                  sub.status === 'ACTIVE'
                    ? locale === 'ar'
                      ? 'نشط'
                      : locale === 'fr'
                        ? 'Actif'
                        : 'Active'
                    : sub.status === 'EXPIRED'
                      ? locale === 'ar'
                        ? 'منتهي'
                        : locale === 'fr'
                          ? 'Expiré'
                          : 'Expired'
                      : locale === 'ar'
                        ? 'ملغى'
                        : locale === 'fr'
                          ? 'Annulé'
                          : 'Cancelled';
                return (
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate">{sub.planName}</span>
                      <span className={`shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 border ${statusCls}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {sub.expiresAt
                        ? `${locale === 'ar' ? 'ينتهي' : locale === 'fr' ? 'Expire' : 'Expires'} ${new Date(sub.expiresAt).toLocaleDateString()}`
                        : '—'}
                      {typeof u.devicesInUse === 'number' && u.devicesInUse > 0
                        ? ` · ${u.devicesInUse} ${locale === 'ar' ? 'جهاز' : locale === 'fr' ? 'app.' : 'dev.'}`
                        : ''}
                    </div>
                  </div>
                );
              },
            },
            {
              key: 'actions',
              headerClassName: 'text-right',
              header: (
                <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
                  الإجراءات
                </span>
              ),
              cell: (u) => (
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleActive(e, u);
                    }}
                    className="flex items-center justify-center h-8 w-8 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={u.isActive ? 'تعطيل المستخدم' : 'تفعيل المستخدم'}
                  >
                    {u.isActive ? (
                      <ToggleRight className="h-4 w-4 text-signal-green" />
                    ) : (
                      <ToggleLeft className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(e, u._id, u.username);
                    }}
                    className="flex items-center justify-center h-8 w-8 text-muted-foreground hover:text-destructive transition-colors"
                    aria-label={
                      locale === 'ar'
                        ? `حذف ${u.username}`
                        : locale === 'fr'
                          ? `Supprimer ${u.username}`
                          : `Delete ${u.username}`
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ),
            },
          ] satisfies DataTableColumn<UserData>[]
        }
      />

      <Pagination page={page} pageSize={pageSize} totalCount={totalCount} onPageChange={setPage} />

      {/* Add User Modal */}
      <Modal
        open={showAddForm}
        onClose={() => {
          setShowAddForm(false);
          setAddError('');
        }}
        title="إنشاء مستخدم جديد"
      >
        <form onSubmit={handleAddUser} className="p-5 space-y-4">
          {addError && (
            <div
              role="alert"
              className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {addError}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="new-username"
                className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground"
              >
                اسم المستخدم
              </label>
              <input
                id="new-username"
                type="text"
                required
                minLength={3}
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
                placeholder={t('common.username')}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="new-email"
                className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground"
              >
                البريد الإلكتروني
              </label>
              <input
                id="new-email"
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
                placeholder={t('common.email')}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="new-password"
                className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground"
              >
                كلمة المرور
              </label>
              <input
                id="new-password"
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
                placeholder={t('common.password')}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="new-role"
                className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground"
              >
                الدور
              </label>
              <select
                id="new-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
              >
                <option value="User">مستخدم</option>
                <option value="Admin">مسؤول</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={addLoading}
              aria-busy={addLoading}
              className="inline-flex items-center px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
            >
              {addLoading ? 'جارٍ الإنشاء...' : 'إنشاء المستخدم'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setAddError('');
              }}
              className="px-6 py-2.5 text-sm font-medium border border-border uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteConfirm !== null}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={confirmDelete}
        title="حذف المستخدم"
        message={`هل تريد حذف المستخدم "${deleteConfirm?.username}"؟ لا يمكن التراجع عن هذا الإجراء.`}
        confirmLabel="حذف"
        variant="destructive"
      />
    </div>
  );
}
