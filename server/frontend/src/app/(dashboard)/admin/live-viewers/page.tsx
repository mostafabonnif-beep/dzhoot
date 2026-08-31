'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Users, Tv, Film, MonitorPlay, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';

interface LiveViewer {
  sessionId: string;
  userId: string | null;
  username: string | null;
  channelListCode: string | null;
  contentType: 'live' | 'movie' | 'episode' | null;
  contentName: string | null;
  contentGroup: string | null;
  platform: string | null;
  startedAt: string | null;
}

function typeIcon(type: LiveViewer['contentType']) {
  if (type === 'live') return Tv;
  if (type === 'movie') return Film;
  if (type === 'episode') return MonitorPlay;
  return Users;
}

function typeLabel(type: LiveViewer['contentType'], l: string) {
  if (type === 'live') return l === 'ar' ? 'قناة مباشرة' : l === 'fr' ? 'Direct' : 'Live channel';
  if (type === 'movie') return l === 'ar' ? 'فيلم' : l === 'fr' ? 'Film' : 'Movie';
  if (type === 'episode') return l === 'ar' ? 'حلقة مسلسل' : l === 'fr' ? 'Épisode' : 'Episode';
  return l === 'ar' ? 'غير معروف' : l === 'fr' ? 'Inconnu' : 'Unknown';
}

function timeAgo(iso: string | null, l: string) {
  if (!iso) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return l === 'ar' ? `منذ ${diffSec} ثانية` : l === 'fr' ? `il y a ${diffSec}s` : `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return l === 'ar' ? `منذ ${min} دقيقة` : l === 'fr' ? `il y a ${min} min` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  return l === 'ar' ? `منذ ${hr} ساعة` : l === 'fr' ? `il y a ${hr}h` : `${hr}h ago`;
}

export default function LiveViewersPage() {
  const { locale } = useLocale();
  const [viewers, setViewers] = useState<LiveViewer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get('/admin/live-viewers');
      setViewers(res.data?.data?.viewers || []);
    } catch {
      setError(
        locale === 'ar'
          ? 'فشل تحميل قائمة المشاهدين المباشرين'
          : locale === 'fr'
            ? 'Échec du chargement des spectateurs en direct'
            : 'Failed to load live viewers',
      );
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000); // auto-refresh every 10s
    return () => clearInterval(interval);
  }, [load]);

  const revoke = async (userId: string | null, sessionId: string) => {
    if (!userId) return;
    setRevoking(sessionId);
    try {
      await api.delete(`/admin/live-viewers/${userId}/${sessionId}`);
      await load();
    } finally {
      setRevoking(null);
    }
  };

  const liveCount = viewers.filter((v) => v.contentType === 'live').length;
  const vodCount = viewers.filter((v) => v.contentType === 'movie' || v.contentType === 'episode').length;

  const title = locale === 'ar' ? 'المشاهدون الآن' : locale === 'fr' ? 'Spectateurs en direct' : 'Live Viewers';
  const subtitle =
    locale === 'ar'
      ? 'من يشاهد الآن، وماذا يشاهد، في الوقت الفعلي'
      : locale === 'fr'
        ? 'Qui regarde quoi, en temps réel'
        : "Who's watching what, in real time";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            load();
          }}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <RefreshCw className="h-4 w-4" />
          {locale === 'ar' ? 'تحديث' : locale === 'fr' ? 'Actualiser' : 'Refresh'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            {locale === 'ar' ? 'إجمالي المشاهدين' : locale === 'fr' ? 'Total' : 'Total viewers'}
          </p>
          <p className="text-3xl font-bold mt-1">{viewers.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            {locale === 'ar' ? 'قنوات مباشرة' : locale === 'fr' ? 'Direct' : 'Live channels'}
          </p>
          <p className="text-3xl font-bold mt-1">{liveCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">VOD</p>
          <p className="text-3xl font-bold mt-1">{vodCount}</p>
        </div>
      </div>

      {error && <div className="rounded-lg bg-destructive/10 text-destructive px-4 py-3 text-sm">{error}</div>}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : viewers.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            {locale === 'ar' ? 'لا يوجد مشاهدون متصلون الآن' : locale === 'fr' ? 'Aucun spectateur en ligne' : 'No one is watching right now'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">
                    {locale === 'ar' ? 'المستخدم' : locale === 'fr' ? 'Utilisateur' : 'User'}
                  </th>
                  <th className="px-4 py-3 text-start font-medium">
                    {locale === 'ar' ? 'يشاهد' : locale === 'fr' ? 'Regarde' : 'Watching'}
                  </th>
                  <th className="px-4 py-3 text-start font-medium">
                    {locale === 'ar' ? 'النوع' : locale === 'fr' ? 'Type' : 'Type'}
                  </th>
                  <th className="px-4 py-3 text-start font-medium">
                    {locale === 'ar' ? 'منذ' : locale === 'fr' ? 'Depuis' : 'Since'}
                  </th>
                  <th className="px-4 py-3 text-start font-medium">
                    {locale === 'ar' ? 'إجراء' : locale === 'fr' ? 'Action' : 'Action'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {viewers.map((v) => {
                  const Icon = typeIcon(v.contentType);
                  return (
                    <tr key={v.sessionId} className="hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="font-medium">{v.username || v.channelListCode || '—'}</div>
                        {v.channelListCode && v.username && (
                          <div className="text-xs text-muted-foreground">{v.channelListCode}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span>{v.contentName || (locale === 'ar' ? 'غير معروف' : 'Unknown')}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{typeLabel(v.contentType, locale)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{timeAgo(v.startedAt, locale)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => revoke(v.userId, v.sessionId)}
                          disabled={!v.userId || revoking === v.sessionId}
                          className="flex items-center gap-1.5 rounded-lg border border-destructive/30 text-destructive px-3 py-1.5 text-xs font-medium hover:bg-destructive/10 disabled:opacity-50"
                        >
                          {revoking === v.sessionId ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          {locale === 'ar' ? 'قطع الاتصال' : locale === 'fr' ? 'Déconnecter' : 'Disconnect'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
