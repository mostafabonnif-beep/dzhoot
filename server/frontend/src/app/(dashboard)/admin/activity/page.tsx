'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Search } from 'lucide-react';
import api from '@/lib/api';
import { useLocale, type Locale } from '@/components/locale-provider';
import Pagination from '@/components/ui/pagination';
import ColumnFilter from '@/components/ui/column-filter';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';
import DataTable, { type DataTableColumn } from '@/components/ui/data-table';

interface AuditEntry {
  _id: string;
  userId?: { username?: string; email?: string };
  action: string;
  resource: string;
  resourceId?: string;
  status: 'success' | 'failure';
  ipAddress?: string;
  timestamp: string;
}

const ACTION_LABELS: Record<string, (l: Locale) => string> = {
  login: (l) => (l === 'ar' ? 'تسجيل الدخول' : l === 'fr' ? 'Connexion' : 'Login'),
  logout: (l) => (l === 'ar' ? 'تسجيل الخروج' : l === 'fr' ? 'Déconnexion' : 'Logout'),
  register: (l) => (l === 'ar' ? 'تسجيل' : l === 'fr' ? 'Inscription' : 'Register'),
  change_password: (l) =>
    l === 'ar'
      ? 'تغيير كلمة المرور'
      : l === 'fr'
        ? 'Changer le mot de passe'
        : 'Change Password',
  create_channel: (l) => (l === 'ar' ? 'إنشاء قناة' : l === 'fr' ? 'Créer une chaîne' : 'Create Channel'),
  update_channel: (l) =>
    l === 'ar' ? 'تحديث القناة' : l === 'fr' ? 'Modifier la chaîne' : 'Update Channel',
  delete_channel: (l) =>
    l === 'ar' ? 'حذف قناة' : l === 'fr' ? 'Supprimer une chaîne' : 'Delete Channel',
  delete_all_channels: (l) =>
    l === 'ar'
      ? 'حذف جميع القنوات'
      : l === 'fr'
        ? 'Supprimer toutes les chaînes'
        : 'Delete All Channels',
  import_m3u: (l) => (l === 'ar' ? 'استيراد M3U' : l === 'fr' ? 'Importer M3U' : 'Import M3U'),
  import_iptv_org: (l) =>
    l === 'ar' ? 'استيراد IPTV-org' : l === 'fr' ? 'Importer IPTV-org' : 'Import IPTV-org',
  import_iptv_org_user: (l) =>
    l === 'ar'
      ? 'استيراد (مستخدم)'
      : l === 'fr'
        ? 'Importer (utilisateur)'
        : 'Import (User)',
  create_user: (l) =>
    l === 'ar' ? 'إنشاء مستخدم' : l === 'fr' ? 'Créer un utilisateur' : 'Create User',
  update_user: (l) =>
    l === 'ar' ? 'تحديث مستخدم' : l === 'fr' ? 'Modifier un utilisateur' : 'Update User',
  delete_user: (l) =>
    l === 'ar' ? 'حذف مستخدم' : l === 'fr' ? 'Supprimer un utilisateur' : 'Delete User',
};

function formatLabel(action: string, locale: Locale) {
  return ACTION_LABELS[action]?.(locale) || action.replace(/_/g, ' ');
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts: string, locale: Locale) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return locale === 'ar' ? 'اليوم' : locale === 'fr' ? "Aujourd'hui" : 'Today';
  if (days === 1) return locale === 'ar' ? 'أمس' : locale === 'fr' ? 'Hier' : 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function ResourceCell({ log }: { log: AuditEntry }) {
  const { locale } = useLocale();
  const [expanded, setExpanded] = useState(false);
  if (!log.resourceId) {
    return <span className="text-sm text-muted-foreground block truncate">{log.resource}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      title={
        expanded
          ? locale === 'ar'
            ? 'اضغط للطي'
            : locale === 'fr'
              ? 'Cliquer pour réduire'
              : 'Click to collapse'
          : locale === 'ar'
            ? 'اضغط لعرض المعرّف الكامل'
            : locale === 'fr'
              ? "Cliquer pour afficher l'ID complet"
              : 'Click to show full ID'
      }
      className={`block w-full min-w-0 text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
        expanded ? 'whitespace-normal break-all' : 'truncate'
      }`}
    >
      {log.resource}: {log.resourceId}
    </button>
  );
}

export default function ActivityPage() {
  const { t, locale } = useLocale();
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { search, debouncedSearch, handleSearchChange } = useDebouncedSearch();
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 50;

  const [filterOptions, setFilterOptions] = useState<{
    action: string[];
    resource: string[];
    status: string[];
  }>({ action: [], resource: [], status: [] });
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  // Date-range filter (backend supports from/to on the audit log)
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchLogs = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (selectedActions.length > 0 && selectedActions.length < filterOptions.action.length) {
          params.set('action', selectedActions.join(','));
        }
        if (
          selectedResources.length > 0 &&
          selectedResources.length < filterOptions.resource.length
        ) {
          params.set('resource', selectedResources.join(','));
        }
        if (selectedStatuses.length > 0 && selectedStatuses.length < filterOptions.status.length) {
          params.set('status', selectedStatuses.join(','));
        }
        if (dateFrom) params.set('from', `${dateFrom}T00:00:00`);
        if (dateTo) params.set('to', `${dateTo}T23:59:59`);

        const res = await api.get(`/activity?${params.toString()}`, { signal });
        const data = res.data?.data || res.data;
        setLogs(data.logs || []);
        setTotalCount(data.totalCount || 0);
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'CanceledError')
          setError(
            locale === 'ar'
              ? 'فشل تحميل سجل النشاط'
              : locale === 'fr'
                ? 'Échec du chargement du journal d’activité'
                : 'Failed to load activity logs',
          );
      } finally {
        setLoading(false);
      }
    },
    [page, debouncedSearch, selectedActions, selectedResources, selectedStatuses, filterOptions, dateFrom, dateTo, locale],
  );

  useEffect(() => {
    const controller = new AbortController();
    api
      .get('/activity/filter-options', { signal: controller.signal })
      .then((res) => {
        setFilterOptions(res.data?.data || { action: [], resource: [], status: [] });
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchLogs(controller.signal);
    return () => controller.abort();
  }, [fetchLogs]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, selectedActions, selectedResources, selectedStatuses]);

  return (
    <div className="space-y-6">
      <div className="">
        <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">{t('admin.activity')}</h1>
        <h2 className="text-sm text-muted-foreground mt-1">
          {t('admin.activity')}
        </h2>
      </div>

      {error && (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-2 border border-border bg-muted/30">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <input
          type="text"
          placeholder={t('admin.searchActivity')}
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          aria-label={t('admin.searchActivityLabel')}
        />
      </div>

      {/* Date-range filter */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border border-border bg-muted/20 text-sm">
        <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
          {locale === 'ar' ? 'الفترة' : locale === 'fr' ? 'Période' : 'Period'}
        </span>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setPage(1);
          }}
          aria-label={
            locale === 'ar' ? 'من تاريخ' : locale === 'fr' ? 'Du' : 'From'
          }
          className="h-8 px-2 border border-border bg-background text-xs focus-visible:outline-none focus-visible:border-primary"
        />
        <span className="text-muted-foreground">
          {locale === 'ar' ? 'إلى' : locale === 'fr' ? 'au' : 'to'}
        </span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPage(1);
          }}
          aria-label={
            locale === 'ar' ? 'إلى تاريخ' : locale === 'fr' ? 'Au' : 'To'
          }
          className="h-8 px-2 border border-border bg-background text-xs focus-visible:outline-none focus-visible:border-primary"
        />
        {(dateFrom || dateTo) && (
          <button
            onClick={() => {
              setDateFrom('');
              setDateTo('');
              setPage(1);
            }}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            {locale === 'ar' ? 'مسح' : locale === 'fr' ? 'Effacer' : 'Clear'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <DataTable<AuditEntry>
          data={logs}
          gridTemplate="minmax(100px,1fr) minmax(110px,1.2fr) minmax(130px,1.4fr) minmax(160px,2.6fr) minmax(90px,1fr) minmax(110px,1.1fr)"
          resizable
          ariaLabel={
            locale === 'ar'
              ? 'جدول سجل النشاط'
              : locale === 'fr'
                ? 'Tableau du journal d’activité'
                : 'Activity log table'
          }
          emptyMessage={t('common.noResults')}
          rowKey={(log) => log._id}
          rowAriaLabel={(log) =>
            `${formatLabel(log.action, locale)} ${
              locale === 'ar' ? 'بواسطة' : locale === 'fr' ? 'par' : 'by'
            } ${log.userId?.username || (locale === 'ar' ? 'غير معروف' : locale === 'fr' ? 'Inconnu' : 'unknown')}`
          }
          columns={
            [
              {
                key: 'time',
                headerClassName: 'text-xs uppercase tracking-[0.15em] text-muted-foreground',
                header: locale === 'ar' ? 'الوقت' : locale === 'fr' ? 'Heure' : 'Time',
                cell: (log) => (
                  <div className="text-xs tabular-nums text-muted-foreground">
                    <time dateTime={log.timestamp}>
                      <span className="font-medium">{formatTime(log.timestamp)}</span>
                    </time>
                    <time dateTime={log.timestamp} className="ml-1.5 text-muted-foreground/60">
                      {formatDate(log.timestamp, locale)}
                    </time>
                  </div>
                ),
              },
              {
                key: 'user',
                headerClassName: 'text-xs uppercase tracking-[0.15em] text-muted-foreground',
                header: locale === 'ar' ? 'المستخدم' : locale === 'fr' ? 'Utilisateur' : 'User',
                cell: (log) => (
                  <span className="text-sm truncate">{log.userId?.username || '—'}</span>
                ),
              },
              {
                key: 'action',
                headerClassName:
                  'text-xs uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-1',
                header: (
                  <ColumnFilter
                    label={locale === 'ar' ? 'الإجراء' : locale === 'fr' ? 'Action' : 'Action'}
                    options={filterOptions.action.map((a) => formatLabel(a, locale))}
                    selected={selectedActions.map((a) => formatLabel(a, locale))}
                    onChange={(labels) => {
                      const reverseMap = Object.fromEntries(
                        filterOptions.action.map((a) => [formatLabel(a, locale), a]),
                      );
                      setSelectedActions(labels.map((l) => reverseMap[l] || l));
                    }}
                  />
                ),
                cell: (log) => (
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {formatLabel(log.action, locale)}
                  </span>
                ),
              },
              {
                key: 'resource',
                mobileHidden: true,
                headerClassName:
                  'text-xs uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-1',
                header: (
                  <ColumnFilter
                    label={locale === 'ar' ? 'المورد' : locale === 'fr' ? 'Ressource' : 'Resource'}
                    options={filterOptions.resource}
                    selected={selectedResources}
                    onChange={setSelectedResources}
                  />
                ),
                cell: (log) => <ResourceCell log={log} />,
              },
              {
                key: 'status',
                headerClassName:
                  'text-xs uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-1',
                header: (
                  <ColumnFilter
                    label={t('common.status')}
                    options={filterOptions.status}
                    selected={selectedStatuses}
                    onChange={setSelectedStatuses}
                  />
                ),
                cell: (log) => (
                  <span>
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
                        log.status === 'success' ? 'bg-signal-green' : 'bg-signal-red'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="text-xs text-muted-foreground">
                      {log.status === 'success'
                        ? locale === 'ar'
                          ? 'نجاح'
                          : locale === 'fr'
                            ? 'Succès'
                            : 'Success'
                        : locale === 'ar'
                          ? 'فشل'
                          : locale === 'fr'
                            ? 'Échec'
                            : 'Failure'}
                    </span>
                    <span className="sr-only">
                      {log.status === 'success'
                        ? locale === 'ar'
                          ? 'نجاح'
                          : locale === 'fr'
                            ? 'Succès'
                            : 'Success'
                        : locale === 'ar'
                          ? 'فشل'
                          : locale === 'fr'
                            ? 'Échec'
                            : 'Failure'}
                    </span>
                  </span>
                ),
              },
              {
                key: 'ip',
                mobileHidden: true,
                headerClassName: 'text-xs uppercase tracking-[0.15em] text-muted-foreground',
                header: 'IP',
                cell: (log) => (
                  <span className="text-xs tabular-nums text-muted-foreground truncate">
                    {log.ipAddress || '—'}
                  </span>
                ),
              },
            ] satisfies DataTableColumn<AuditEntry>[]
          }
        />
      )}

      <Pagination page={page} totalCount={totalCount} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
