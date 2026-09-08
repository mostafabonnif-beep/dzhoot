'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TrendingUp, Radio, Film, MonitorPlay, Layers, Eye, Play, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import ChannelLogo from '@/components/ui/channel-logo';
import { useLocale } from '@/components/locale-provider';

interface DiscoverChannel {
  _id: string;
  channelId?: string;
  name: string;
  logo: string;
  group: string;
  viewers?: number;
  plays?: number;
  nowPlaying?: { title: string; endsAt: string | null } | null;
}

interface DiscoverVod {
  _id: string;
  name: string;
  poster: string;
  category: string;
}

interface Collection {
  key: string;
  titleAr: string;
  titleEn: string;
  groups: string[];
  channelCount: number;
}

interface DiscoverHome {
  generatedAt: string;
  stats: { totalChannels: number; liveViewers: number };
  trending: DiscoverChannel[];
  liveNow: DiscoverChannel[];
  latestMovies: DiscoverVod[];
  latestSeries: DiscoverVod[];
  collections: Collection[];
}

const STR = {
  ar: {
    discover: 'استكشف',
    subtitle: 'ما يشاهده الجميع الآن، والجديد، ومجموعات مختارة لك',
    liveNow: 'يُشاهَد الآن',
    viewers: 'مشاهد',
    trending: 'الرائج',
    plays: 'تشغيل',
    latestMovies: 'أحدث الأفلام',
    latestSeries: 'أحدث المسلسلات',
    collections: 'مجموعات ذكية',
    channels: 'قناة',
    totalChannels: 'قناة في الكتالوج',
    watchingNow: 'يشاهد الآن',
    nowPlaying: 'يُعرض الآن',
    browse: 'تصفح الكل',
    refresh: 'تحديث',
    empty: 'لا يوجد محتوى بعد — ابدأ المشاهدة وستظهر هنا اقتراحات ذكية.',
  },
  en: {
    discover: 'Discover',
    subtitle: 'What everyone is watching now, what is new, and picks for you',
    liveNow: 'Live Now',
    viewers: 'viewers',
    trending: 'Trending',
    plays: 'plays',
    latestMovies: 'Latest Movies',
    latestSeries: 'Latest Series',
    collections: 'Smart Collections',
    channels: 'channels',
    totalChannels: 'channels in catalog',
    watchingNow: 'watching now',
    nowPlaying: 'Now playing',
    browse: 'Browse all',
    refresh: 'Refresh',
    empty: 'Nothing here yet — start watching and smart picks will appear.',
  },
  fr: {
    discover: 'Découvrir',
    subtitle: 'Ce que tout le monde regarde, les nouveautés et des sélections pour vous',
    liveNow: 'En direct',
    viewers: 'spectateurs',
    trending: 'Tendances',
    plays: 'lectures',
    latestMovies: 'Films récents',
    latestSeries: 'Séries récentes',
    collections: 'Collections intelligentes',
    channels: 'chaînes',
    totalChannels: 'chaînes au catalogue',
    watchingNow: 'regardent',
    nowPlaying: 'En ce moment',
    browse: 'Tout parcourir',
    refresh: 'Actualiser',
    empty: 'Rien ici pour le moment — regardez et des suggestions apparaîtront.',
  },
} as const;

type DiscoverStrings = Record<keyof typeof STR.ar, string>;

function ChannelCard({ ch, live, t }: { ch: DiscoverChannel; live?: boolean; t: DiscoverStrings }) {
  return (
    <Link
      href={`/user/channels?focus=${ch._id}`}
      className="group relative flex w-40 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:border-emerald-500/60 hover:shadow-lg sm:w-44"
    >
      <div className="flex h-24 items-center justify-center bg-muted/40 p-3">
        <ChannelLogo src={ch.logo} alt={ch.name} size="lg" />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <p className="line-clamp-1 text-xs font-semibold">{ch.name}</p>
        <p className="line-clamp-1 text-[10px] text-muted-foreground">{ch.group}</p>
        {ch.nowPlaying?.title ? (
          <p className="line-clamp-1 text-[10px] text-emerald-600 dark:text-emerald-400">
            ▶ {ch.nowPlaying.title}
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between pt-1 text-[10px] text-muted-foreground">
          {live && ch.viewers ? (
            <span className="flex items-center gap-1 text-red-500">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
              </span>
              {ch.viewers} {t.viewers}
            </span>
          ) : ch.plays ? (
            <span className="flex items-center gap-1">
              <Play className="h-3 w-3" /> {ch.plays} {t.plays}
            </span>
          ) : (
            <span />
          )}
        </div>
      </div>
    </Link>
  );
}

function VodCard({ item, href }: { item: DiscoverVod; href: string }) {
  return (
    <Link
      href={href}
      className="group relative w-32 shrink-0 overflow-hidden rounded-xl border border-border bg-card transition hover:border-emerald-500/60 hover:shadow-lg sm:w-36"
    >
      <div className="aspect-[2/3] w-full bg-muted/40">
        {item.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.poster} alt={item.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Film className="h-8 w-8" />
          </div>
        )}
      </div>
      <div className="p-2">
        <p className="line-clamp-2 text-[11px] font-semibold leading-tight">{item.name}</p>
        <p className="line-clamp-1 text-[9px] text-muted-foreground">{item.category}</p>
      </div>
    </Link>
  );
}

function SectionHeader({ icon: Icon, title, href, browseLabel }: { icon: React.ElementType; title: string; href?: string; browseLabel: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-sm font-bold sm:text-base">
        <Icon className="h-4 w-4 text-emerald-500" />
        {title}
      </h2>
      {href ? (
        <Link href={href} className="text-[11px] text-emerald-600 hover:underline dark:text-emerald-400">
          {browseLabel} ←
        </Link>
      ) : null}
    </div>
  );
}

export default function DiscoverPage() {
  const { locale } = useLocale();
  const t: DiscoverStrings = (STR[locale] as DiscoverStrings) ?? STR.ar;
  const [data, setData] = useState<DiscoverHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(refresh = false) {
    try {
      setLoading(true);
      const res = await api.get(`/discover/home${refresh ? '?refresh=1' : ''}`);
      setData(res.data.data);
      setError(null);
    } catch (e) {
      setError('load-failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(() => load(), 90_000); // live viewers move fast
    return () => clearInterval(timer);
  }, []);

  const hasContent =
    data &&
    (data.trending.length > 0 || data.liveNow.length > 0 || data.latestMovies.length > 0 || data.collections.length > 0);

  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-black tracking-tight sm:text-2xl">{t.discover}</h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{t.subtitle}</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t.refresh}
        </button>
      </div>

      {/* Stats strip */}
      {data ? (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs">
            <Layers className="h-3.5 w-3.5 text-emerald-500" />
            <strong>{data.stats.totalChannels.toLocaleString()}</strong> {t.totalChannels}
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs">
            <Eye className="h-3.5 w-3.5 text-red-500" />
            <strong>{data.stats.liveViewers}</strong> {t.watchingNow}
          </div>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center text-sm text-red-500">
          {t.empty}
        </div>
      ) : !hasContent ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {t.empty}
        </div>
      ) : (
        <>
          {/* Live now */}
          {data!.liveNow.length > 0 ? (
            <section>
              <SectionHeader icon={Radio} title={t.liveNow} href="/user/channels" browseLabel={t.browse} />
              <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
                {data!.liveNow.map((ch) => (
                  <ChannelCard key={ch._id} ch={ch} live t={t} />
                ))}
              </div>
            </section>
          ) : null}

          {/* Trending */}
          {data!.trending.length > 0 ? (
            <section>
              <SectionHeader icon={TrendingUp} title={t.trending} href="/user/channels" browseLabel={t.browse} />
              <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
                {data!.trending.map((ch) => (
                  <ChannelCard key={ch._id} ch={ch} t={t} />
                ))}
              </div>
            </section>
          ) : null}

          {/* Smart collections */}
          {data!.collections.length > 0 ? (
            <section>
              <SectionHeader icon={Layers} title={t.collections} href="/user/channels" browseLabel={t.browse} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {data!.collections.map((c) => (
                  <Link
                    key={c.key}
                    href={`/user/channels?group=${encodeURIComponent(c.groups[0] || '')}`}
                    className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-center transition hover:border-emerald-500/60 hover:shadow-md"
                  >
                    <span className="text-2xl">
                      {{ sports: '⚽', news: '📰', kids: '🧒', movies: '🎬', series: '📺', algeria: '🇩🇿' }[c.key] || '📁'}
                    </span>
                    <span className="text-xs font-bold">{locale === 'ar' ? c.titleAr : c.titleEn}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {c.channelCount.toLocaleString()} {t.channels}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {/* Latest movies */}
          {data!.latestMovies.length > 0 ? (
            <section>
              <SectionHeader icon={Film} title={t.latestMovies} href="/user/channels?tab=movies" browseLabel={t.browse} />
              <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
                {data!.latestMovies.map((m) => (
                  <VodCard key={m._id} item={m} href="/user/channels?tab=movies" />
                ))}
              </div>
            </section>
          ) : null}

          {/* Latest series */}
          {data!.latestSeries.length > 0 ? (
            <section>
              <SectionHeader icon={MonitorPlay} title={t.latestSeries} href="/user/channels?tab=series" browseLabel={t.browse} />
              <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
                {data!.latestSeries.map((s) => (
                  <VodCard key={s._id} item={s} href="/user/channels?tab=series" />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
