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
import { useDebouncedSearch } from '@/hooks/use-debounced-search';
import Pagination from '@/components/ui/pagination';
import SearchInput from '@/components/ui/search-input';

interface Series {
  _id: string;
  title: string;
  category: string;
  poster?: string;
  year?: number;
  rating?: number;
  description?: string;
}

const PAGE_SIZE = 24;

export default function SeriesPageShell() {
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('All');
  const [categories, setCategories] = useState<string[]>([]);
  const { search: searchTerm, debouncedSearch, handleSearchChange: setSearchTerm } = useDebouncedSearch('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

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
  }, [category, debouncedSearch, page]);

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <SearchInput
            value={searchTerm}
            onChange={(value) => setSearchTerm(value)}
            placeholder="ابحث عن اسم المسلسل..."
          />
        </div>
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
    </div>
  );
}
