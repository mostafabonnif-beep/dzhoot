'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Clapperboard, Film, Loader2, Play, Search, TvMinimalPlay } from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';
import { UserVodPlayer, VodPlayRequest } from '@/components/user-vod-player';

/* ------------------------------------------------------------------ */
/* Localized strings (same self-contained pattern as /user/discover)   */
/* ------------------------------------------------------------------ */

const STR = {
  ar: {
    pageTitle: 'مكتبة الأفلام والمسلسلات',
    moviesTab: 'أفلام',
    seriesTab: 'مسلسلات',
    all: 'الكل',
    searchPlaceholder: 'ابحث في الأفلام والمسلسلات…',
    loadMore: 'عرض المزيد',
    showing: 'عرض {shown} من {total}',
    emptyMovies: 'لا توجد أفلام مطابقة.',
    emptySeries: 'لا توجد مسلسلات مطابقة.',
    emptyEpisodes: 'لا توجد حلقات لهذا الموسم بعد.',
    loadError: 'تعذّر تحميل المحتوى. حاول مرة أخرى.',
    backToLibrary: 'العودة للمكتبة',
    playMovie: 'تشغيل الفيلم',
    playEpisode: 'تشغيل الحلقة',
    episodesOf: 'حلقات {title}',
    seasons: 'الموسم {n}',
    minutes: '{m} د',
    noPoster: 'بدون غلاف',
    retry: 'إعادة المحاولة',
  },
  en: {
    pageTitle: 'Movies & Series',
    moviesTab: 'Movies',
    seriesTab: 'Series',
    all: 'All',
    searchPlaceholder: 'Search movies and series…',
    loadMore: 'Load more',
    showing: 'Showing {shown} of {total}',
    emptyMovies: 'No matching movies.',
    emptySeries: 'No matching series.',
    emptyEpisodes: 'No episodes for this season yet.',
    loadError: 'Failed to load content. Please try again.',
    backToLibrary: 'Back to library',
    playMovie: 'Play movie',
    playEpisode: 'Play episode',
    episodesOf: 'Episodes of {title}',
    seasons: 'Season {n}',
    minutes: '{m} min',
    noPoster: 'No poster',
    retry: 'Retry',
  },
  fr: {
    pageTitle: 'Films & Séries',
    moviesTab: 'Films',
    seriesTab: 'Séries',
    all: 'Tous',
    searchPlaceholder: 'Rechercher films et séries…',
    loadMore: 'Afficher plus',
    showing: '{shown} sur {total} affichés',
    emptyMovies: 'Aucun film correspondant.',
    emptySeries: 'Aucune série correspondante.',
    emptyEpisodes: 'Aucun épisode pour cette saison.',
    loadError: 'Échec du chargement. Réessayez.',
    backToLibrary: 'Retour à la bibliothèque',
    playMovie: 'Lire le film',
    playEpisode: 'Lire l’épisode',
    episodesOf: 'Épisodes de {title}',
    seasons: 'Saison {n}',
    minutes: '{m} min',
    noPoster: 'Sans affiche',
    retry: 'Réessayer',
  },
} as const;

type Strings = Record<keyof typeof STR.ar, string>;
type Kind = 'movies' | 'series';

interface VodItem {
  _id: string;
  title: string;
  poster?: string;
  category?: string;
  duration?: number | null;
  year?: number | null;
}
interface SeasonRow {
  _id: string;
  seasonNumber?: number;
  name?: string;
}
interface EpisodeRow {
  _id: string;
  episodeNumber?: number;
  title?: string;
  duration?: number | null;
}
interface CategoryRow {
  name: string;
  count: number;
}

const fmt = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

export type VodKind = Kind;

export default function UserVodBrowser({ initialKind = 'movies' }: { initialKind?: VodKind }) {
  const { locale } = useLocale();
  const t: Strings = STR[locale];

  const [kind, setKind] = useState<Kind>(initialKind);
  const [category, setCategory] = useState('All');
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  const [items, setItems] = useState<VodItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Series drill-down: selected series -> seasons -> episodes
  const [seriesOpen, setSeriesOpen] = useState<VodItem | null>(null);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);

  // Player modal
  const [play, setPlay] = useState<VodPlayRequest | null>(null);

  // Debounce the search box (400ms)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 400);
    return () => window.clearTimeout(id);
  }, [search]);

  const loadCategories = useCallback(async (k: Kind) => {
    try {
      const res = await api.get(`/catalog/${k}/categories`);
      const rows: CategoryRow[] = Array.isArray(res.data?.data) ? res.data.data : [];
      setCategories(rows);
    } catch {
      setCategories([]); // chips are optional — grid still works
    }
  }, []);

  const loadPage = useCallback(
    async (k: Kind, cat: string, q: string, p: number, replace: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get(`/catalog/${k}`, {
          params: {
            page: p,
            limit: 24,
            category: cat === 'All' ? undefined : cat,
            search: q || undefined,
          },
        });
        const rows: VodItem[] = Array.isArray(res.data?.data) ? res.data.data : [];
        setItems((prev) => (replace ? rows : [...prev, ...rows]));
        setTotal(Number(res.data?.totalCount) || rows.length);
        setPage(p);
      } catch {
        setError(t.loadError);
      } finally {
        setLoading(false);
      }
    },
    [t.loadError],
  );

  // Reset + first page whenever filters change
  useEffect(() => {
    if (seriesOpen) return; // drill-down view owns the screen
    loadCategories(kind);
    loadPage(kind, category, debounced, 1, true);
  }, [kind, category, debounced, seriesOpen, loadCategories, loadPage, t]);

  const loadMore = () => loadPage(kind, category, debounced, page + 1, false);

  // ---- Series drill-down -------------------------------------------------
  const openSeries = async (s: VodItem) => {
    setSeriesOpen(s);
    setSeasonId(null);
    setEpisodes([]);
    setSeasons([]);
    try {
      const res = await api.get(`/catalog/series/${s._id}/seasons`);
      const rows: SeasonRow[] = Array.isArray(res.data?.data) ? res.data.data : [];
      setSeasons(rows);
      if (rows.length > 0) await openSeason(rows[0]._id);
    } catch {
      setError(t.loadError);
    }
  };

  const openSeason = async (sid: string) => {
    setSeasonId(sid);
    setEpisodesLoading(true);
    try {
      const res = await api.get(`/catalog/seasons/${sid}/episodes`);
      const rows: EpisodeRow[] = Array.isArray(res.data?.data) ? res.data.data : [];
      setEpisodes(rows);
    } catch {
      setEpisodes([]);
    } finally {
      setEpisodesLoading(false);
    }
  };

  const kindChips = useMemo(
    () => [
      { key: 'movies' as Kind, label: t.moviesTab },
      { key: 'series' as Kind, label: t.seriesTab },
    ],
    [t],
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          <Clapperboard className="h-6 w-6 text-amber-500" />
          {t.pageTitle}
        </h1>
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          {kindChips.map((c) => (
            <button
              key={c.key}
              onClick={() => setKind(c.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                kind === c.key
                  ? 'bg-amber-500 text-black'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchPlaceholder}
          className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none transition focus:border-amber-500/70"
        />
      </div>

      {/* Series drill-down */}
      {seriesOpen ? (
        <div>
          <button
            onClick={() => setSeriesOpen(null)}
            className="mb-4 flex items-center gap-1 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            {t.backToLibrary}
          </button>
          <h2 className="mb-1 text-lg font-bold">{seriesOpen.title}</h2>
          {seasons.length > 1 ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {seasons.map((s) => (
                <button
                  key={s._id}
                  onClick={() => openSeason(s._id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    seasonId === s._id
                      ? 'bg-amber-500 text-black'
                      : 'border border-border bg-card text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {s.name || fmt(t.seasons, { n: s.seasonNumber ?? 1 })}
                </button>
              ))}
            </div>
          ) : null}
          {episodesLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
            </div>
          ) : episodes.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t.emptyEpisodes}</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {episodes.map((ep) => (
                <li key={ep._id}>
                  <button
                    onClick={() =>
                      setPlay({ kind: 'episode', id: ep._id, title: ep.title || `${ep.episodeNumber ?? ''}` })
                    }
                    className="flex w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-muted/40"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                      {ep.episodeNumber ?? '•'}
                    </span>
                    <span className="flex-1 truncate text-sm font-medium">{ep.title || t.playEpisode}</span>
                    {ep.duration ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {fmt(t.minutes, { m: Math.floor(ep.duration / 60) })}
                      </span>
                    ) : null}
                    <Play className="h-4 w-4 shrink-0 text-amber-500" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          {/* Category chips */}
          <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setCategory('All')}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                category === 'All'
                  ? 'bg-amber-500 text-black'
                  : 'border border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.all}
            </button>
            {categories.map((c) => (
              <button
                key={c.name}
                onClick={() => setCategory(c.name)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                  category === c.name
                    ? 'bg-amber-500 text-black'
                    : 'border border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          {/* Grid */}
          {error ? (
            <div className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground">
              <p>{error}</p>
              <button
                onClick={() => loadPage(kind, category, debounced, 1, true)}
                className="rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium transition hover:text-foreground"
              >
                {t.retry}
              </button>
            </div>
          ) : items.length === 0 && !loading ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {kind === 'movies' ? t.emptyMovies : t.emptySeries}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {items.map((item) =>
                kind === 'movies' ? (
                  <button
                    key={item._id}
                    onClick={() => setPlay({ kind: 'movie', id: item._id, title: item.title })}
                    className="group overflow-hidden rounded-xl border border-border bg-card text-start transition hover:border-amber-500/50 hover:shadow-lg"
                  >
                    <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted/40">
                      {item.poster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.poster}
                          alt={item.title}
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Film className="h-8 w-8 text-muted-foreground/50" />
                        </div>
                      )}
                      <span className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 opacity-0 backdrop-blur transition group-hover:opacity-100">
                        <Play className="h-4 w-4 text-white" />
                      </span>
                    </div>
                    <div className="p-2.5">
                      <p className="line-clamp-2 text-xs font-semibold leading-snug">{item.title}</p>
                      <p className="mt-1 line-clamp-1 text-[10px] text-muted-foreground">
                        {item.duration ? fmt(t.minutes, { m: Math.floor(item.duration / 60) }) : item.category || ''}
                      </p>
                    </div>
                  </button>
                ) : (
                  <button
                    key={item._id}
                    onClick={() => openSeries(item)}
                    className="group overflow-hidden rounded-xl border border-border bg-card text-start transition hover:border-amber-500/50 hover:shadow-lg"
                  >
                    <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted/40">
                      {item.poster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.poster}
                          alt={item.title}
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <TvMinimalPlay className="h-8 w-8 text-muted-foreground/50" />
                        </div>
                      )}
                      <span className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 opacity-0 backdrop-blur transition group-hover:opacity-100">
                        <ChevronRight className="h-4 w-4 text-white rtl:rotate-180" />
                      </span>
                    </div>
                    <div className="p-2.5">
                      <p className="line-clamp-2 text-xs font-semibold leading-snug">{item.title}</p>
                      <p className="mt-1 line-clamp-1 text-[10px] text-muted-foreground">{item.category || ''}</p>
                    </div>
                  </button>
                ),
              )}
            </div>
          )}

          {/* Load more */}
          {items.length > 0 && items.length < total && (
            <div className="mt-6 flex flex-col items-center gap-2">
              <button
                onClick={loadMore}
                disabled={loading}
                className="flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-medium transition hover:border-amber-500/50 disabled:opacity-50"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {t.loadMore}
              </button>
              <p className="text-xs text-muted-foreground">{fmt(t.showing, { shown: items.length, total })}</p>
            </div>
          )}
          {loading && items.length === 0 && (
            <div className="flex justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-amber-500" />
            </div>
          )}
        </>
      )}

      {play ? <UserVodPlayer request={play} onClose={() => setPlay(null)} /> : null}
    </div>
  );
}
