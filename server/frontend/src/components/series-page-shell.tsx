'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Tv,
  LayoutGrid,
  List,
  RefreshCw,
} from 'lucide-react';
import api from '@/lib/api';
import { useStreamPlayer } from '@/components/stream-player-context';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';
import Pagination from '@/components/ui/pagination';
import SearchInput from '@/components/ui/search-input';
import { X, Play, Clapperboard, ListVideo } from 'lucide-react';

interface Series {
  _id: string;
  title: string;
  category: string;
  poster?: string;
  year?: number;
  rating?: number;
  description?: string;
  sourceId?: string;
  isActive: boolean;
}

interface Season {
  _id: string;
  seasonNumber: number;
  name?: string;
}

interface Episode {
  _id: string;
  title: string;
  episodeNumber: number;
  plot?: string;
  duration?: number;
}

const PAGE_SIZE = 24;

export default function SeriesPageShell() {
  const { playStream } = useStreamPlayer();
  const [seriesList, setSeriesList] = useState<Series[]>([]);
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
  const [detailSeries, setDetailSeries] = useState<Series | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const openDetail = useCallback(async (series: Series) => {
    setDetailSeries(series);
    setSeasons([]);
    setSelectedSeason(null);
    setEpisodes([]);
    setDetailLoading(true);
    try {
      const res = await api.get(`/series/${series._id}`);
      if (res.data.success && res.data.data?.seasons?.length) {
        setSeasons(res.data.data.seasons);
        setSelectedSeason(res.data.data.seasons[0]._id);
      }
    } catch (error) {
      console.error('Error fetching series detail:', error);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const selectSeason = useCallback(async (seasonId: string) => {
    setSelectedSeason(seasonId);
    setEpisodes([]);
    setEpisodesLoading(true);
    try {
      const res = await api.get(`/series/seasons/${seasonId}/episodes`);
      if (res.data.success) setEpisodes(res.data.data || []);
    } catch (error) {
      console.error('Error fetching episodes:', error);
    } finally {
      setEpisodesLoading(false);
    }
  }, []);

  const playEpisode = useCallback(async (ep: Episode) => {
    setPlayingId(ep._id);
    try {
      const res = await api.post('/tv/playback-token', { episodeId: ep._id });
      const { playbackUrl } = res.data.data;
      playStream({ name: `${detailSeries?.title || 'حلقة'} — ${ep.title || `حلقة ${ep.episodeNumber}`}`, url: playbackUrl, direct: true });
    } catch (err) {
      console.error('Error playing episode:', err);
      alert('تعذر تشغيل الحلقة حاليًا. تحقق من حالة المصدر ثم حاول مجددًا.');
    } finally {
      setPlayingId(null);
    }
  }, [playStream, detailSeries]);

  useEffect(() => {
    if (selectedSeason && seasons.length) selectSeason(selectedSeason);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeason, seasons.length]);

  const fetchSeries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/series', {
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
        setSeriesList(res.data.data);
        setTotal(res.data.pagination.total);
      }
    } catch (error) {
      console.error('Error fetching series:', error);
      setError('تعذر تحميل المسلسلات حاليًا. تحقق من الاتصال ثم أعد المحاولة.');
    } finally {
      setLoading(false);
    }
  }, [category, debouncedSearch, page, sourceId, status]);

  const fetchSources = async () => {
    try {
      const res = await api.get('/admin/xtream-sources');
      if (res.data.success) setSources((res.data.data || []).map((source: { _id: string; name: string }) => ({ _id: source._id, name: source.name })));
    } catch (error) {
      console.error('Error fetching Xtream sources:', error);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await api.get('/series/categories');
      if (res.data.success) {
        setCategories(['All', ...res.data.data]);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchSources();
  }, []);

  useEffect(() => {
    fetchSeries();
  }, [fetchSeries]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Tv className="h-6 w-6 text-primary" />
            إدارة المسلسلات
          </h1>
          <p className="text-muted-foreground mt-1">
            إجمالي المسلسلات المتاحة: {total}
          </p>
        </div>

        <div className="flex items-center gap-2">
           <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-md ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground'}`}
          >
            <LayoutGrid className="h-5 w-5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-md ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground'}`}
          >
            <List className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2">
          <SearchInput
            value={searchTerm}
            onChange={(value) => setSearchTerm(value)}
            placeholder="ابحث عن اسم المسلسل..."
          />
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
          {sources.map((source) => <option key={source._id} value={source._id}>{source.name}</option>)}
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
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'All' ? 'جميع التصنيفات' : c}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="sr-only">جارٍ تحميل المسلسلات</span>
        </div>
      ) : error ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 text-center">
          <Tv className="h-10 w-10 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <button
            type="button"
            onClick={fetchSeries}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <RefreshCw className="h-4 w-4" />
            إعادة المحاولة
          </button>
        </div>
      ) : seriesList.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center border-2 border-dashed rounded-lg">
          <Tv className="h-12 w-12 text-muted-foreground mb-2" />
          <p className="text-muted-foreground">لا توجد مسلسلات مطابقة للبحث.</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {seriesList.map((series) => (
            <div key={series._id} className="group relative rounded-lg overflow-hidden border bg-card hover:shadow-lg transition-all">
              <div className="aspect-[2/3] bg-muted relative">
                {series.poster ? (
                  <Image
                    src={series.poster}
                    alt={series.title}
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
                    unoptimized
                    className="object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <Tv className="h-10 w-10" />
                  </div>
                )}
                <div className="absolute top-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded">
                  {series.category}
                </div>
                {/* Detail overlay */}
                <button
                  type="button"
                  onClick={() => openDetail(series)}
                  aria-label={`عرض ${series.title}`}
                  title={`عرض المواسم والحلقات: ${series.title}`}
                  className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 group-hover:bg-black/40 group-hover:opacity-100 transition-all"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transform transition-transform group-hover:scale-110">
                    <Play className="h-5 w-5 mr-0.5" fill="currentColor" />
                  </span>
                </button>
              </div>
              <div className="p-2">
                <h3 className="font-semibold text-sm truncate" title={series.title}>
                  {series.title}
                </h3>
                <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
                  <span>{series.year || 'N/A'}</span>
                  <span className="text-yellow-500 font-bold">{series.rating || '-'}</span>
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
                <th className="p-3 font-medium">المسلسل</th>
                <th className="p-3 font-medium">التصنيف</th>
                <th className="p-3 font-medium text-center">السنة</th>
                <th className="p-3 font-medium text-center">التقييم</th>
                <th className="p-3 font-medium text-center">الحلقات</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {seriesList.map((series) => (
                <tr key={series._id} className="hover:bg-accent/50 transition-colors">
                  <td className="p-3 flex items-center gap-3">
                    <div className="relative h-10 w-7 bg-muted rounded overflow-hidden flex-shrink-0">
                      <Image
                        src={series.poster || 'https://placehold.co/400x600?text=No+Poster'}
                        alt={series.title}
                        fill
                        sizes="28px"
                        unoptimized
                        className="object-cover"
                      />
                    </div>
                    <span className="font-medium">{series.title}</span>
                  </td>
                  <td className="p-3 text-muted-foreground">{series.category}</td>
                  <td className="p-3 text-center">{series.year || '-'}</td>
                  <td className="p-3 text-center text-yellow-500 font-bold">{series.rating || '-'}</td>
                  <td className="p-3 text-center">
                    <button
                      type="button"
                      onClick={() => openDetail(series)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
                      aria-label={`عرض حلقات ${series.title}`}
                    >
                      <ListVideo className="h-3.5 w-3.5" />
                      الحلقات
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-center py-4">
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={total}
          onPageChange={setPage}
        />
      </div>

      {/* ── Series detail modal (seasons + episodes) ── */}
      {detailSeries && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setDetailSeries(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`تفاصيل ${detailSeries.title}`}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl bg-card border shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h2 className="text-lg font-bold truncate">{detailSeries.title}</h2>
              <button
                type="button"
                onClick={() => setDetailSeries(null)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="إغلاق"
                title="إغلاق (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex gap-4 px-5 py-4 border-b border-border">
              <div className="relative h-32 w-24 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                {detailSeries.poster ? (
                  <Image src={detailSeries.poster} alt={detailSeries.title} fill unoptimized className="object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <Clapperboard className="h-8 w-8" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{detailSeries.category}</p>
                {detailSeries.year && <p className="text-sm text-muted-foreground mt-0.5">{detailSeries.year}</p>}
                <p className="mt-2 text-sm leading-6 line-clamp-3">{detailSeries.description || 'لا يوجد وصف متاح.'}</p>
              </div>
            </div>

            <div className="px-5 py-3 border-b border-border flex items-center gap-3">
              <label htmlFor="season-select" className="text-sm font-medium">الموسم:</label>
              {detailLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : seasons.length === 0 ? (
                <span className="text-sm text-muted-foreground">لا توجد مواسم مستوردة بعد.</span>
              ) : (
                <select
                  id="season-select"
                  value={selectedSeason || ''}
                  onChange={(e) => selectSeason(e.target.value)}
                  className="flex h-9 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {seasons.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name || `الموسم ${s.seasonNumber}`}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {episodesLoading ? (
                <div className="flex h-24 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : episodes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {seasons.length === 0 ? 'لا توجد حلقات. مزامنة الحلقات تعمل في الخلفية للمصادر المستوردة.' : 'لا توجد حلقات في هذا الموسم.'}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {episodes.map((ep) => (
                    <li key={ep._id} className="flex items-center gap-3 py-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground shrink-0">
                        {ep.episodeNumber}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{ep.title || `حلقة ${ep.episodeNumber}`}</p>
                        {ep.duration ? (
                          <p className="text-xs text-muted-foreground">{Math.floor(ep.duration / 60)} دقيقة</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => playEpisode(ep)}
                        disabled={playingId === ep._id}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors shrink-0"
                        aria-label={`تشغيل ${ep.title || `حلقة ${ep.episodeNumber}`}`}
                      >
                        {playingId === ep._id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" fill="currentColor" />
                        )}
                        تشغيل
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
