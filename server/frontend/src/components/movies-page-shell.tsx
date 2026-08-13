'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Film,
  LayoutGrid,
  List,
} from 'lucide-react';
import api from '@/lib/api';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';
import Pagination from '@/components/ui/pagination';
import SearchInput from '@/components/ui/search-input';

interface Movie {
  _id: string;
  title: string;
  category: string;
  poster?: string;
  year?: number;
  duration?: number;
  rating?: number;
  description?: string;
}

const PAGE_SIZE = 24;

export default function MoviesPageShell() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('All');
  const [categories, setCategories] = useState<string[]>([]);
  const { search: searchTerm, debouncedSearch, handleSearchChange: setSearchTerm } = useDebouncedSearch('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const fetchMovies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/movies', {
        params: {
          page,
          limit: PAGE_SIZE,
          category: category === 'All' ? undefined : category,
          search: debouncedSearch || undefined,
        },
      });
      if (res.data.success) {
        setMovies(res.data.data);
        setTotal(res.data.pagination.total);
      }
    } catch (error) {
      console.error('Error fetching movies:', error);
    } finally {
      setLoading(false);
    }
  }, [category, debouncedSearch, page]);

  const fetchCategories = async () => {
    try {
      const res = await api.get('/movies/categories');
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
    fetchMovies();
  }, [fetchMovies]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Film className="h-6 w-6 text-primary" />
            إدارة الأفلام (VOD)
          </h1>
          <p className="text-muted-foreground mt-1">
            إجمالي الأفلام المتاحة: {total}
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
            placeholder="ابحث عن اسم الفيلم..."
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
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : movies.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center border-2 border-dashed rounded-lg">
          <Film className="h-12 w-12 text-muted-foreground mb-2" />
          <p className="text-muted-foreground">لا توجد أفلام مطابقة للبحث.</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {movies.map((movie) => (
            <div key={movie._id} className="group relative rounded-lg overflow-hidden border bg-card hover:shadow-lg transition-all">
              <div className="aspect-[2/3] bg-muted relative">
                {movie.poster ? (
                  <img
                    src={movie.poster}
                    alt={movie.title}
                    className="object-cover w-full h-full"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://placehold.co/400x600?text=No+Poster';
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <Film className="h-10 w-10" />
                  </div>
                )}
                <div className="absolute top-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded">
                  {movie.category}
                </div>
              </div>
              <div className="p-2">
                <h3 className="font-semibold text-sm truncate" title={movie.title}>
                  {movie.title}
                </h3>
                <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
                  <span>{movie.year || 'N/A'}</span>
                  {movie.duration && <span>{Math.floor(movie.duration / 60)}د</span>}
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
                <th className="p-3 font-medium">الفيلم</th>
                <th className="p-3 font-medium">التصنيف</th>
                <th className="p-3 font-medium text-center">السنة</th>
                <th className="p-3 font-medium text-center">المدة</th>
                <th className="p-3 font-medium text-center">التقييم</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {movies.map((movie) => (
                <tr key={movie._id} className="hover:bg-accent/50 transition-colors">
                  <td className="p-3 flex items-center gap-3">
                    <div className="h-10 w-7 bg-muted rounded overflow-hidden flex-shrink-0">
                      <img src={movie.poster} alt={movie.title} className="object-cover w-full h-full" />
                    </div>
                    <span className="font-medium">{movie.title}</span>
                  </td>
                  <td className="p-3 text-muted-foreground">{movie.category}</td>
                  <td className="p-3 text-center">{movie.year || '-'}</td>
                  <td className="p-3 text-center">{movie.duration ? `${Math.floor(movie.duration / 60)}د` : '-'}</td>
                  <td className="p-3 text-center text-yellow-500 font-bold">{movie.rating || '-'}</td>
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
