'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Tv, Search, Loader2, KeyRound, LogOut, Star } from 'lucide-react';
import api from '@/lib/api';
import StreamPlayer from '@/components/stream-player';

interface WatchChannel {
  channelId: string;
  channelName: string;
  channelImg?: string | null;
  tvgLogo?: string | null;
  channelGroup?: string | null;
  channelUrl?: string;
  order?: number;
}

export default function WatchPage() {
  const [codeInput, setCodeInput] = useState('');
  const [code, setCode] = useState('');
  const [channels, setChannels] = useState<WatchChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<WatchChannel | null>(null);
  const [playingName, setPlayingName] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem('watch_tv_code');
    if (stored) {
      setCode(stored);
      setCodeInput(stored);
      loadChannels(stored);
    }
    try {
      const favs = JSON.parse(window.localStorage.getItem('watch_favorites') || '[]');
      if (Array.isArray(favs)) setFavorites(favs.filter((f) => typeof f === 'string'));
    } catch {
      /* ignore corrupted favorites */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleFavorite(channelId: string) {
    setFavorites((prev) => {
      const next = prev.includes(channelId)
        ? prev.filter((id) => id !== channelId)
        : [...prev, channelId];
      try {
        window.localStorage.setItem('watch_favorites', JSON.stringify(next));
      } catch {
        /* storage full/blocked — keep in-memory only */
      }
      return next;
    });
  }

  async function loadChannels(c?: string) {
    const finalCode = (c ?? codeInput).trim().toUpperCase();
    if (!finalCode) return;
    window.localStorage.setItem('watch_tv_code', finalCode);
    setCode(finalCode);
    setLoading(true);
    setError('');
    setChannels([]);
    try {
      const all: WatchChannel[] = [];
      let page = 1;
      const pageSize = 5000;
      while (true) {
        const res = await api.get('/channels', { params: { page, pageSize } });
        const data: WatchChannel[] = res.data?.data ?? [];
        all.push(...data);
        if (data.length < pageSize) break;
        page += 1;
        if (page > 10) break;
      }
      if (all.length === 0) {
        setError('لا توجد قنوات لهذا الكود — تحقق من الكود أو فعّل اشتراكك أولاً.');
      }
      setChannels(all);
    } catch (e: any) {
      const status = e?.response?.status;
      setError(
        status === 401
          ? 'الكود غير صالح أو الاشتراك منتهي.'
          : e?.response?.data?.error || 'تعذر تحميل القنوات — تحقق من اتصالك وحاول مجدداً.',
      );
    } finally {
      setLoading(false);
    }
  }

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? channels.filter(
          (c) =>
            (c.channelName || '').toLowerCase().includes(q) ||
            (c.channelGroup || '').toLowerCase().includes(q),
        )
      : channels;
    const map = new Map<string, WatchChannel[]>();
    for (const c of list) {
      const g = c.channelGroup || 'أخرى';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(c);
    }
    const favList = list.filter((c) => favorites.includes(c.channelId));
    const result: [string, WatchChannel[]][] = [];
    if (favList.length > 0) result.push(['⭐ مفضلتي', favList]);
    if (!favoritesOnly) result.push(...Array.from(map.entries()));
    return result;
  }, [channels, search, favorites, favoritesOnly]);

  function logout() {
    window.localStorage.removeItem('watch_tv_code');
    setCode('');
    setChannels([]);
    setSelected(null);
    setCodeInput('');
  }

  return (
    <main dir="rtl" className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-extrabold">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Tv className="h-5 w-5" aria-hidden="true" />
            </span>
            DZ HOOF
          </Link>
          {code ? (
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-bold tracking-wider">
                {code}
              </span>
              <button
                onClick={logout}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                تغيير الكود
              </button>
            </div>
          ) : (
            <Link href="/buy" className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">
              اشترك الآن
            </Link>
          )}
        </div>
      </header>

      {!code ? (
        <section className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
            <KeyRound className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="mt-6 text-3xl font-extrabold">أدخل كود القنوات</h1>
          <p className="mt-2 text-center text-muted-foreground">
            الكود موجود في بطاقة الاشتراك أو عند المحل — 6 أحرف مثل ABC123
          </p>
          <form
            className="mt-8 w-full"
            onSubmit={(e) => {
              e.preventDefault();
              loadChannels();
            }}
          >
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={10}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-center text-2xl font-extrabold tracking-[0.3em] outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={loading || !codeInput.trim()}
              className="mt-4 w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground transition disabled:opacity-50"
            >
              {loading ? 'جارٍ التحميل...' : 'دخول'}
            </button>
          </form>
          {error && <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>}
        </section>
      ) : (
        <section className="mx-auto max-w-6xl px-4 py-6">
          {error && (
            <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="mb-6 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث عن قناة... (16,000+ قناة)"
                className="w-full rounded-xl border border-border bg-card py-3 pl-4 pr-11 text-foreground outline-none focus:border-primary"
              />
            </div>
            {favorites.length > 0 && (
              <button
                onClick={() => setFavoritesOnly((v) => !v)}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                  favoritesOnly
                    ? 'border-amber-400/60 bg-amber-400/10 text-amber-500'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
                title="عرض القنوات المفضلة فقط"
              >
                <Star className={`h-4 w-4 ${favoritesOnly ? 'fill-amber-400' : ''}`} aria-hidden="true" />
                <span className="hidden sm:inline">المفضلة</span>
                <span className="rounded-full bg-muted px-1.5 text-xs">{favorites.length}</span>
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
              <span>جارٍ تحميل القنوات...</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map(([group, list]) => (
                <details key={group} className="group rounded-xl border border-border bg-card" open={groups.length <= 5}>
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
                    <span className="font-bold">{group}</span>
                    <span className="text-xs text-muted-foreground">{list.length} قناة</span>
                  </summary>
                  <div className="grid grid-cols-2 gap-2 border-t border-border p-3 sm:grid-cols-3 lg:grid-cols-5">
                    {list.map((c) => (
                      <div key={c.channelId} className="relative">
                        <button
                          onClick={() => {
                            setSelected(c);
                            setPlayingName(c.channelName);
                          }}
                          className="flex w-full flex-col items-center gap-2 rounded-lg p-2 text-center transition hover:bg-primary/10"
                        >
                          <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-muted">
                            {c.tvgLogo || c.channelImg ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={c.tvgLogo || c.channelImg || ''} alt="" className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <Tv className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                            )}
                          </span>
                          <span className="line-clamp-2 text-xs font-medium leading-tight">{c.channelName}</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(c.channelId);
                          }}
                          aria-label={favorites.includes(c.channelId) ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
                          title={favorites.includes(c.channelId) ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
                          className={`absolute left-1 top-1 grid h-7 w-7 place-items-center rounded-full transition ${
                            favorites.includes(c.channelId)
                              ? 'text-amber-400 hover:text-amber-300'
                              : 'text-muted-foreground/30 hover:bg-background/80 hover:text-amber-400'
                          }`}
                        >
                          <Star
                            className={`h-4 w-4 ${favorites.includes(c.channelId) ? 'fill-amber-400' : ''}`}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
              {!loading && channels.length === 0 && !error && (
                <p className="py-16 text-center text-muted-foreground">لا توجد قنوات.</p>
              )}
            </div>
          )}
        </section>
      )}

      {selected && (
        <StreamPlayer
          channel={{
            name: selected.channelName,
            url: selected.channelUrl || '',
            logo: selected.tvgLogo || selected.channelImg || undefined,
            channelId: selected.channelId,
          }}
          onClose={() => {
            setSelected(null);
            setPlayingName('');
          }}
          mode="proxy"
        />
      )}

      {playingName && !selected && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 px-4 py-2 text-center text-sm text-muted-foreground backdrop-blur">
          الآن: <span className="font-bold text-foreground">{playingName}</span>
        </div>
      )}
    </main>
  );
}
