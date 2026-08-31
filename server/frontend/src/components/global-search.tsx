'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, Search, Tv, User, X } from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';

interface UserResult {
  _id: string;
  username: string;
  email?: string;
  role?: string;
  isActive?: boolean;
}

interface CodeResult {
  _id: string;
  prefix: string;
  codeLast4: string;
  status?: string;
  planId?: { _id: string; name: string } | string | null;
}

interface ChannelResult {
  _id: string;
  channelName?: string;
  name?: string;
  channelGroup?: string;
}

interface SearchResults {
  users: UserResult[];
  codes: CodeResult[];
  channels: ChannelResult[];
}

type ResultType = 'user' | 'code' | 'channel';

interface FlatResult {
  key: string;
  type: ResultType;
  title: string;
  titleDir?: 'ltr';
  subtitle: string;
  href: string;
}

const EMPTY_RESULTS: SearchResults = { users: [], codes: [], channels: [] };

function pickLocale(locale: string, ar: string, fr: string, en: string) {
  return locale === 'ar' ? ar : locale === 'fr' ? fr : en;
}

function extractList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.data)) return b.data;
    if (Array.isArray(b.users)) return b.users;
    if (Array.isArray(b.channels)) return b.channels;
    if (Array.isArray(b.items)) return b.items;
  }
  return [];
}

function codeStatusLabel(status: string | undefined, locale: string) {
  switch (status) {
    case 'ACTIVATED':
      return pickLocale(locale, 'مفعّل', 'Activé', 'Activated');
    case 'REVOKED':
      return pickLocale(locale, 'ملغى', 'Révoqué', 'Revoked');
    case 'EXPIRED':
      return pickLocale(locale, 'منتهي', 'Expiré', 'Expired');
    default:
      return pickLocale(locale, 'غير مستخدم', 'Inutilisé', 'Unused');
  }
}

function displayCode(prefix: string, last4: string) {
  return `${prefix}-••••-••••-${last4}`;
}

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const router = useRouter();
  const { locale } = useLocale();
  const L = (ar: string, fr: string, en: string) => pickLocale(locale, ar, fr, en);

  const { search, debouncedSearch, handleSearchChange } = useDebouncedSearch('', 300);
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  // Tracks the immediate input value so the fetch effect can skip stale
  // debounced values (e.g. palette closed and reopened inside the debounce
  // window) without re-running on every keystroke.
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  const navigate = useCallback(
    (item: FlatResult) => {
      onOpenChange(false);
      router.push(item.href);
    },
    [router, onOpenChange],
  );

  // Global Cmd/Ctrl+K shortcut — opens/closes the palette from anywhere.
  useEffect(() => {
    function onGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [open, onOpenChange]);

  // Flat, ordered list of all results for keyboard navigation.
  const flatResults = useMemo<FlatResult[]>(() => {
    const flat: FlatResult[] = [];
    for (const u of results.users) {
      flat.push({
        key: `user-${u._id}`,
        type: 'user',
        title: u.username || '—',
        subtitle: u.email || u.role || '',
        href: '/admin/users',
      });
    }
    for (const c of results.codes) {
      const planName = typeof c.planId === 'object' && c.planId ? c.planId.name : '';
      flat.push({
        key: `code-${c._id}`,
        type: 'code',
        title: displayCode(c.prefix, c.codeLast4),
        titleDir: 'ltr',
        subtitle: [planName, codeStatusLabel(c.status, locale)].filter(Boolean).join(' · '),
        href: '/admin/codes',
      });
    }
    for (const ch of results.channels) {
      flat.push({
        key: `channel-${ch._id}`,
        type: 'channel',
        title: ch.channelName || ch.name || '—',
        subtitle: ch.channelGroup || '',
        href: '/admin/channels',
      });
    }
    return flat;
  }, [results, locale]);

  // Grouped views with localized headers.
  const groups = useMemo(
    () =>
      (
        [
          { type: 'user', label: pickLocale(locale, 'المستخدمون', 'Utilisateurs', 'Users') },
          {
            type: 'code',
            label: pickLocale(locale, 'أكواد التفعيل', "Codes d'activation", 'Activation codes'),
          },
          { type: 'channel', label: pickLocale(locale, 'القنوات', 'Chaînes', 'Channels') },
        ] as const
      ).map((g) => ({ ...g, rows: flatResults.filter((r) => r.type === g.type) })),
    [flatResults, locale],
  );

  // Search the three admin endpoints in parallel (debounced query).
  useEffect(() => {
    if (!open) return;
    if (!debouncedSearch.trim() || !searchRef.current.trim()) {
      setResults(EMPTY_RESULTS);
      setError('');
      setLoading(false);
      setActiveIndex(0);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const qs = new URLSearchParams({ search: debouncedSearch, page: '1', pageSize: '10' }).toString();
    (async () => {
      const settled = await Promise.allSettled([
        api.get(`/users?${qs}`, { signal: controller.signal }),
        api.get(`/admin/activation-codes?${qs}`, { signal: controller.signal }),
        api.get(`/admin/channels?${qs}`, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      const next: SearchResults = { users: [], codes: [], channels: [] };
      let failed = 0;
      const [usersRes, codesRes, channelsRes] = settled;
      if (usersRes.status === 'fulfilled') {
        next.users = extractList(usersRes.value.data) as UserResult[];
      } else {
        failed += 1;
      }
      if (codesRes.status === 'fulfilled') {
        next.codes = extractList(codesRes.value.data) as CodeResult[];
      } else {
        failed += 1;
      }
      if (channelsRes.status === 'fulfilled') {
        next.channels = extractList(channelsRes.value.data) as ChannelResult[];
      } else {
        failed += 1;
      }
      setResults(next);
      setActiveIndex(0);
      setLoading(false);
      // Only surface an error when every endpoint failed; partial results are fine.
      if (failed === 3) {
        setError(pickLocale(locale, 'تعذر البحث', 'La recherche a échoué', 'Search failed'));
      }
    })();
    return () => controller.abort();
  }, [open, debouncedSearch, locale]);

  // Reset state when the palette closes.
  useEffect(() => {
    if (!open) {
      handleSearchChange('');
      setResults(EMPTY_RESULTS);
      setError('');
      setLoading(false);
      setActiveIndex(0);
    }
  }, [open, handleSearchChange]);

  // Keyboard navigation inside the open palette.
  useEffect(() => {
    if (!open) return;
    function onDialogKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (flatResults.length === 0 ? 0 : (i + 1) % flatResults.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) =>
          flatResults.length === 0 ? 0 : (i - 1 + flatResults.length) % flatResults.length,
        );
        return;
      }
      if (e.key === 'Enter') {
        const item = flatResults[activeIndex];
        if (item) {
          e.preventDefault();
          navigate(item);
        }
      }
    }
    document.addEventListener('keydown', onDialogKeyDown);
    return () => document.removeEventListener('keydown', onDialogKeyDown);
  }, [open, flatResults, activeIndex, onOpenChange, navigate]);

  // Keep the highlighted row in view while navigating with the keyboard.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  if (!open) return null;

  const isTyping = search.trim() !== debouncedSearch.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh] sm:pt-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="w-full max-w-xl border border-border bg-background shadow-2xl">
        {/* Input row */}
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={L(
              'ابحث عن مستخدم، كود، أو قناة…',
              'Rechercher un utilisateur, un code ou une chaîne…',
              'Search for a user, code, or channel…',
            )}
            aria-label={L('بحث شامل', 'Recherche globale', 'Global search')}
            className="h-12 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none"
          />
          <span className="hidden sm:inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              Esc
            </kbd>
            <span>{L('لإغلاق', 'pour fermer', 'to close')}</span>
          </span>
          <button
            onClick={() => onOpenChange(false)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={L('إغلاق', 'Fermer', 'Close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[45vh] overflow-y-auto p-2">
          {!search.trim() ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {L('اكتب للبحث…', 'Tapez pour rechercher…', 'Type to search…')}
            </div>
          ) : isTyping || loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {L('جارٍ البحث…', 'Recherche…', 'Searching…')}
            </div>
          ) : error ? (
            <div
              role="alert"
              className="px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          ) : flatResults.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {L('لا توجد نتائج', 'Aucun résultat', 'No results')}
            </div>
          ) : (
            <div>
              {groups.map((group) => {
                if (group.rows.length === 0) return null;
                return (
                  <div key={group.type}>
                    <div className="px-3 pb-1.5 pt-3 text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                      {group.label}
                    </div>
                    {group.rows.map((item) => {
                      const isActive = item === flatResults[activeIndex];
                      return (
                        <button
                          key={item.key}
                          ref={isActive ? activeRowRef : undefined}
                          type="button"
                          onClick={() => navigate(item)}
                          onMouseEnter={() => setActiveIndex(flatResults.indexOf(item))}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start transition-colors ${
                            isActive ? 'bg-muted' : 'hover:bg-muted/50'
                          }`}
                          aria-current={isActive ? 'true' : undefined}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            {item.type === 'user' ? (
                              <User className="h-4 w-4" aria-hidden="true" />
                            ) : item.type === 'code' ? (
                              <KeyRound className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Tv className="h-4 w-4" aria-hidden="true" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={`block truncate text-sm font-medium text-foreground ${
                                item.titleDir === 'ltr' ? 'font-mono' : ''
                              }`}
                              dir={item.titleDir}
                            >
                              {item.title}
                            </span>
                            {item.subtitle && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {item.subtitle}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
