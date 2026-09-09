'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Hls from 'hls.js';
import { Loader2, MonitorX, X } from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';

export interface VodPlayRequest {
  kind: 'movie' | 'episode';
  id: string;
  title: string;
}

/* ------------------------------------------------------------------ */
/* Localized strings                                                   */
/* ------------------------------------------------------------------ */

const STR = {
  ar: {
    close: 'إغلاق',
    loading: 'جارٍ تجهيز التشغيل…',
    retry: 'إعادة المحاولة',
    genericError: 'تعذّر تشغيل المحتوى. حاول مرة أخرى.',
    unsupportedTitle: 'هذه الصيغة غير مدعومة في المتصفح',
    unsupportedBody: 'ملفات MKV/AVI تتطلب تطبيق DZ HOOF (Android / TV).',
    downloadApp: 'حمّل التطبيق',
    hintSubscription: 'اشتراكك منتهٍ — فعّل كودًا جديدًا من صفحة الاشتراك للمتابعة.',
    hintConcurrent: 'لديك مشاهدة نشطة على جهاز آخر. أوقفها ثم أعد المحاولة.',
    hintDevice: 'يجب ربط جهازك أولًا من صفحة «ربط الجهاز».',
    hintMissing: 'المحتوى غير متاح حاليًا.',
  },
  en: {
    close: 'Close',
    loading: 'Preparing playback…',
    retry: 'Retry',
    genericError: 'Failed to play content. Please try again.',
    unsupportedTitle: 'This format is not supported in the browser',
    unsupportedBody: 'MKV/AVI files require the DZ HOOF app (Android / TV).',
    downloadApp: 'Download the app',
    hintSubscription: 'Your subscription has expired — activate a new code from the subscription page.',
    hintConcurrent: 'Playback is active on another device. Stop it and retry.',
    hintDevice: 'Pair your device first from the “Pair device” page.',
    hintMissing: 'This content is not available right now.',
  },
  fr: {
    close: 'Fermer',
    loading: 'Préparation de la lecture…',
    retry: 'Réessayer',
    genericError: 'Échec de la lecture. Réessayez.',
    unsupportedTitle: 'Format non pris en charge par le navigateur',
    unsupportedBody: 'Les fichiers MKV/AVI nécessitent l’application DZ HOOF (Android / TV).',
    downloadApp: 'Télécharger l’application',
    hintSubscription: 'Votre abonnement a expiré — activez un code depuis la page abonnement.',
    hintConcurrent: 'Une lecture est active sur un autre appareil. Arrêtez-la puis réessayez.',
    hintDevice: 'Associez d’abord votre appareil (page « Associer un appareil »).',
    hintMissing: 'Ce contenu n’est pas disponible pour le moment.',
  },
} as const;

type Strings = Record<keyof typeof STR.ar, string>;

interface PlaybackPayload {
  playbackUrl: string;
  mimeType?: string;
}

const CODE_HINTS: Record<string, keyof Strings> = {
  SUBSCRIPTION_EXPIRED: 'hintSubscription',
  CONCURRENT_STREAM_LIMIT: 'hintConcurrent',
  PLAYBACK_DEVICE_REQUIRED: 'hintDevice',
  CONTENT_NOT_FOUND: 'hintMissing',
};

export function UserVodPlayer({ request, onClose }: { request: VodPlayRequest; onClose: () => void }) {
  const { locale } = useLocale();
  const t: Strings = STR[locale];
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('');
  const [unsupported, setUnsupported] = useState(false);

  const authorize = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setUnsupported(false);
    setPlaybackUrl(null);
    try {
      const body = request.kind === 'movie' ? { movieId: request.id } : { episodeId: request.id };
      const res = await api.post('/tv/playback-token', body, {
        headers: { 'X-Playback-Client': 'web' },
      });
      const payload: PlaybackPayload = res.data?.data || {};
      if (!payload.playbackUrl) throw new Error('no-url');
      setPlaybackUrl(payload.playbackUrl);
      setMimeType(payload.mimeType || '');
    } catch (err: unknown) {
      const anyErr = err as { response?: { data?: { error?: string; code?: string } } };
      const code = anyErr.response?.data?.code;
      const serverMsg = anyErr.response?.data?.error;
      const hint = code ? CODE_HINTS[code] : undefined;
      setErrorMsg(hint ? `${serverMsg ? `${serverMsg} ` : ''}${t[hint]}` : serverMsg || t.genericError);
    } finally {
      setLoading(false);
    }
  }, [request, t]);

  // Fetch a fresh playback token every time the modal opens
  useEffect(() => {
    authorize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.kind, request.id]);

  // Wire the right engine to the video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackUrl) return;

    const isHls = mimeType.includes('mpegurl') || mimeType.includes('m3u8') || playbackUrl.endsWith('.m3u8');
    const isMp4 = mimeType.includes('mp4') || (!isHls && !mimeType);

    if (!isHls && !isMp4) {
      setUnsupported(true); // mkv/avi/webm edge — no browser engine for these
      return;
    }

    if (isHls) {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true });
        hlsRef.current = hls;
        hls.loadSource(playbackUrl);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = playbackUrl; // Safari native HLS
      } else {
        setUnsupported(true);
      }
    } else {
      video.src = playbackUrl;
    }
    video.play().catch(() => {
      /* autoplay blocked — controls remain available */
    });

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [playbackUrl, mimeType]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={request.title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 className="truncate text-sm font-bold sm:text-base">{request.title}</h3>
          <button
            onClick={onClose}
            aria-label={t.close}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted transition hover:bg-muted/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="bg-black">
          {loading ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
              <p className="text-xs text-muted-foreground">{t.loading}</p>
            </div>
          ) : errorMsg ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="max-w-md text-sm text-white/90">{errorMsg}</p>
              <div className="flex gap-2">
                <button
                  onClick={authorize}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-black transition hover:bg-amber-400"
                >
                  {t.retry}
                </button>
                <button
                  onClick={onClose}
                  className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-white/80 transition hover:text-white"
                >
                  {t.close}
                </button>
              </div>
            </div>
          ) : unsupported ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <MonitorX className="h-10 w-10 text-white/60" />
              <p className="text-sm font-bold text-white">{t.unsupportedTitle}</p>
              <p className="max-w-md text-xs text-white/70">{t.unsupportedBody}</p>
              <Link
                href="/download"
                className="mt-1 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-black transition hover:bg-amber-400"
              >
                {t.downloadApp}
              </Link>
            </div>
          ) : (
            <video ref={videoRef} controls autoPlay playsInline className="aspect-video w-full" />
          )}
        </div>
      </div>
    </div>
  );
}
