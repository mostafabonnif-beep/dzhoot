'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Minimize2, Maximize2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import api from '@/lib/api';

interface StreamPlayerChannel {
  name: string;
  url: string;
  logo?: string;
  /** Mongo _id of the catalog channel — used for playback metrics (report-play). */
  id?: string;
  /** Catalog channel reference (e.g. `xt:<sourceId>:<streamId>`) — used to
   *  issue a server-side playback token (the reliable same-origin proxy path). */
  channelId?: string;
  alternateUrls?: string[];
}

interface StreamPlayerProps {
  channel: StreamPlayerChannel | null;
  onClose: () => void;
  /**
   * 'proxy' (default) = play through the server playback-token pipeline
   * (same-origin HTTPS proxy URLs — works for upstreams that block datacenter
   * IPs, and avoids browser mixed-content on http:// CDN segments).
   * 'direct-fallback' = try the token pipeline first, then the raw URL.
   */
  mode?: 'proxy' | 'direct-fallback';
}

/** Normalize an absolute API URL to the current page origin (same server,
 *  same Caddy) so the browser never needs cross-origin CORS/CORP/CSP
 *  exceptions — the token paths are host-agnostic. */
function toSameOrigin(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return new URL(
        parsed.pathname + parsed.search + parsed.hash,
        window.location.origin,
      ).toString();
    }
  } catch {
    /* leave as-is */
  }
  return url;
}

interface TokenResult {
  url?: string;
  mimeType?: string;
  hlsUrl?: string;
  proxyUrl?: string;
  /** Direct provider URL (HTTPS only) — the browser plays it straight from
   *  the provider CDN; residential viewer IPs are allowed by the provider. */
  directUrl?: string;
  /** `.m3u8` twin of the direct URL for hls.js (when the source is Xtream). */
  directHlsUrl?: string;
  error?: string;
}

/** Issue a server playback token for a catalog channel slot. */
async function fetchTokenizedUrl(channelId: string, slot: number): Promise<TokenResult> {
  try {
    const res = await api.post('/tv/playback-token', { channelId, slot });
    const d = res.data;
    if (d?.success && d.data?.playbackUrl) {
      return {
        url: toSameOrigin(d.data.playbackUrl),
        mimeType: d.data?.mimeType || '',
        hlsUrl: d.data?.hlsUrl ? toSameOrigin(d.data.hlsUrl) : undefined,
        proxyUrl: d.data?.proxyPlaybackUrl ? toSameOrigin(d.data.proxyPlaybackUrl) : undefined,
        // External provider URLs stay absolute — never rewrite to same-origin.
        directUrl: d.data?.directUrl || undefined,
        directHlsUrl: d.data?.directHlsUrl || undefined,
      };
    }
    return { error: d?.error || 'Failed to issue playback token' };
  } catch (e: any) {
    return { error: e?.response?.data?.error || e?.message || 'Playback token request failed' };
  }
}

interface SourceCandidate {
  url: string;
  /** 'hls' → hls.js engine; 'ts' → mpegts.js engine (raw MPEG-TS relay). */
  kind: 'hls' | 'ts';
  /** Whether the bytes flow through our server (relay/remux) vs the browser
   *  fetching an external provider URL directly. */
  serverAssisted: boolean;
}

export default function StreamPlayer({ channel, onClose, mode = 'proxy' }: StreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('جارٍ تحميل البث...');
  const [playerError, setPlayerError] = useState('');
  const [isLive, setIsLive] = useState(false);
  const [mini, setMini] = useState(false);
  const wasActiveRef = useRef(false); // tracks if player was already open (for swap vs fresh open)
  const playReportedRef = useRef<{ channelId: string; at: number } | null>(null);
  const currentSrcRef = useRef<string>('');
  const stallTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Drag position for mini player
  const [position, setPosition] = useState({ right: 16, bottom: 16 });
  const dragRef = useRef<{ mouseX: number; mouseY: number; right: number; bottom: number } | null>(
    null,
  );
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Block body scroll in full mode
  useEffect(() => {
    if (!channel || mini) {
      document.body.style.overflow = '';
      return;
    }
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [channel, mini]);

  // Escape key closes in full mode
  useEffect(() => {
    if (!channel || mini) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [channel, mini, onClose]);

  // Player setup
  useEffect(() => {
    if (!channel) {
      wasActiveRef.current = false;
      return;
    }
    const ch = channel;
    const url = ch.url;
    const alternateUrls = ch.alternateUrls || [];
    let alternateIndex = 0;
    const sessionId = typeof window !== 'undefined' ? useAuthStore.getState().sessionId : null;
    let destroyed = false;
    let activeHls: { destroy: () => void; startLoad?: () => void } | null = null;
    // Raw MPEG-TS player (mpegts.js) — same lifecycle as the HLS player.
    let activeMpegts: { destroy: () => void; unload?: () => void } | null = null;
    // Native-HLS (Safari) listeners — hoisted so cleanup can remove them.
    let nativeLoadedMeta: (() => void) | null = null;
    let nativeError: (() => void) | null = null;
    // Stall watchdog state
    let lastProgressAt = Date.now();
    let lastCurrentTime = -1;
    let stallRecoveries = 0;

    const safeDestroyHls = (instance: { destroy: () => void } | null) => {
      if (!instance) return;
      try {
        instance.destroy();
      } catch {
        /* already destroyed */
      }
      if (hlsRef.current === instance) hlsRef.current = null;
      if (activeHls === instance) activeHls = null;
    };

    const safeDestroyMpegts = (instance: { destroy: () => void } | null) => {
      if (!instance) return;
      try {
        instance.destroy();
      } catch {
        /* already destroyed */
      }
      if (activeMpegts === instance) activeMpegts = null;
    };

    setStatus('جارٍ تحميل البث...');
    setPlayerError('');
    setIsLive(false);
    currentSrcRef.current = '';

    // If player was already active (swapping streams), keep mini mode & position.
    // Only reset to full modal on fresh open.
    if (!wasActiveRef.current) {
      setMini(false);
      setPosition({ right: 16, bottom: 16 });
    }
    wasActiveRef.current = true;

    // ── Video (HLS / MPEG-TS) mode ──
    const video = videoRef.current;
    if (!video) return;

    async function initPlayer() {
      try {
        const HlsModule = await import('hls.js');
        const Hls = HlsModule.default;
        if (destroyed) return;

        // Candidate source resolution (web):
        //  - Catalog channels (channelId present) play through the server
        //    playback-token pipeline. Preferred order per token slot:
        //      1. directHlsUrl — provider HTTPS .m3u8 (hls.js): the browser
        //                        plays straight from the provider CDN. Works
        //                        for residential viewers even when the
        //                        provider blocks the VPS datacenter IP.
        //      2. directUrl    — provider HTTPS raw TS (mpegts.js), same idea.
        //      3. hlsUrl       — server-side HLS remux (hls.js): fallback when
        //                        the viewer's IP is not allowed by the provider
        //                        or the direct CDN is unreachable.
        //      4. relay        — raw server relay (proxyUrl in direct mode, or
        //                        the plain playbackUrl when direct is off): TS
        //                        via mpegts.js, HLS via hls.js.
        let tokenSlot = 0;
        const maxTokenSlot = Math.min(3, Math.max(alternateUrls.length, 0));
        let directTried = false;

        async function nextSource(): Promise<SourceCandidate | null> {
          if (destroyed) return null;
          if (ch.channelId && tokenSlot <= maxTokenSlot) {
            const slot = tokenSlot++;
            const r = await fetchTokenizedUrl(ch.channelId, slot);
            if (!r.url && !r.hlsUrl && !r.directUrl && !r.directHlsUrl) {
              // Token failed for this slot (e.g. expired/limit) — advance.
              setStatus('تجربة مصدر بديل...');
              return nextSource();
            }
            const candidates: SourceCandidate[] = [];
            if (r.directHlsUrl) {
              candidates.push({ url: r.directHlsUrl, kind: 'hls', serverAssisted: false });
            }
            if (r.directUrl) {
              candidates.push({ url: r.directUrl, kind: 'ts', serverAssisted: false });
            }
            if (r.hlsUrl) candidates.push({ url: r.hlsUrl, kind: 'hls', serverAssisted: true });
            // Relay: in direct mode the plain playbackUrl is the direct 302
            // (skip — mixed content on web); otherwise it IS the relay.
            const relayUrl = r.proxyUrl || (r.hlsUrl ? undefined : r.url);
            if (relayUrl) {
              candidates.push({
                url: relayUrl,
                kind: r.mimeType === 'application/x-mpegurl' ? 'hls' : 'ts',
                serverAssisted: true,
              });
            }
            // De-duplicate (hlsUrl and relay can share the same token path).
            const seen = new Set<string>();
            for (const c of candidates) {
              if (!seen.has(c.url)) {
                seen.add(c.url);
                return c;
              }
            }
            setStatus('تجربة مصدر بديل...');
            return nextSource();
          }
          if (mode === 'direct-fallback' && !directTried) {
            directTried = true;
            return { url, kind: 'hls', serverAssisted: false };
          }
          if (!ch.channelId && alternateIndex < alternateUrls.length) {
            const alt = alternateUrls[alternateIndex++];
            return {
              url: alt,
              kind: alt.includes('.m3u8') ? 'hls' : 'ts',
              serverAssisted: false,
            };
          }
          return null;
        }

        /** Advance to the next candidate after a fatal engine error. */
        function advanceFrom(currentSrc: string) {
          if (destroyed) return;
          setStatus('تبديل المصدر...');
          void nextSource().then((info) => {
            if (destroyed) return;
            if (info && info.url !== currentSrc) {
              playSource(info);
            } else {
              setPlayerError(
                'تعذر تحميل البث — قد تتوقف مصادر البث لهذه القناة أو يحجبها مزود الخدمة عن خوادم التشغيل. جرّب قناة أخرى، وإن استمرت المشكلة تواصل مع الدعم.',
              );
            }
          });
        }

        function tryHlsSource(candidate: SourceCandidate) {
          if (destroyed) return;
          safeDestroyHls(activeHls);
          safeDestroyMpegts(activeMpegts);
          currentSrcRef.current = candidate.url;
          if (candidate.serverAssisted && mode === 'direct-fallback') setStatus('تجربة خادم البث...');
          setPlayerError('');
          setIsLive(false);

          let networkRetries = 0;
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 30,
            maxBufferLength: 20,
            maxMaxBufferLength: 30,
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 6,
            liveDurationInfinity: true,
            manifestLoadingTimeOut: 10000,
            manifestLoadingMaxRetry: 4,
            manifestLoadingRetryDelay: 500,
            levelLoadingTimeOut: 10000,
            levelLoadingMaxRetry: 4,
            levelLoadingRetryDelay: 500,
            fragLoadingTimeOut: 20000,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 500,
            xhrSetup: (xhr: XMLHttpRequest, xhrUrl: string) => {
              if (xhrUrl.includes('/api/v1/tv/') && sessionId) {
                xhr.setRequestHeader('X-Session-Id', sessionId);
              }
            },
          });
          activeHls = hls;
          hlsRef.current = hls;
          hls.loadSource(candidate.url);
          hls.attachMedia(video!);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (!destroyed) {
              setIsLive(true);
              setStatus('بث مباشر');
              video!.play().catch(() => {});
            }
          });
          hls.on(
            Hls.Events.ERROR,
            (_: string, data: { fatal: boolean; type: string; details: string }) => {
              if (destroyed) return;
              if (data.fatal) {
                if (data.type === 'mediaError') {
                  setStatus('خطأ في الوسائط — استعادة...');
                  hls.recoverMediaError();
                } else if (data.type === 'networkError') {
                  networkRetries += 1;
                  if (networkRetries <= 3) {
                    const delayMs = 500 * networkRetries;
                    setStatus(`انقطاع الشبكة — إعادة المحاولة (${networkRetries}/3)...`);
                    setTimeout(() => {
                      if (destroyed) return;
                      hls.startLoad();
                    }, delayMs);
                  } else {
                    safeDestroyHls(hls);
                    advanceFrom(candidate.url);
                  }
                } else {
                  // Fatal manifest/level/other error — advance to the next source.
                  safeDestroyHls(hls);
                  advanceFrom(candidate.url);
                }
              }
            },
          );
        }

        async function tryMpegtsSource(candidate: SourceCandidate) {
          if (destroyed) return;
          safeDestroyHls(activeHls);
          safeDestroyMpegts(activeMpegts);
          currentSrcRef.current = candidate.url;
          if (candidate.serverAssisted && mode === 'direct-fallback') setStatus('تجربة خادم البث...');
          setPlayerError('');
          setIsLive(false);

          let Mpegts: any;
          try {
            const mod = await import('mpegts.js');
            Mpegts = mod.default || mod;
          } catch {
            if (!destroyed) advanceFrom(candidate.url);
            return;
          }
          if (destroyed) return;
          if (!Mpegts || !Mpegts.isSupported || !Mpegts.isSupported()) {
            // Engine unavailable on this browser — advance to the next source.
            if (!destroyed) advanceFrom(candidate.url);
            return;
          }

          const player = Mpegts.createPlayer(
            { type: 'mpegts', isLive: true, url: candidate.url },
            {
              // Worker disabled: the page CSP (connect-src/script-src) has no
              // blob: allowance, so a blob Worker would be blocked.
              enableWorker: false,
              // Low-latency live tuning — avoids the "stall then jump" that a
              // growing stash buffer causes on raw TS passthrough.
              enableStashBuffer: false,
              liveBufferLatencyChasing: true,
              liveBufferLatencyMaxLatency: 3,
              liveBufferLatencyMinRemain: 0.5,
              liveBufferLatencyMaxDrift: 3,
              lazyLoad: false,
              deferLoadAfterSourceOpen: true,
            },
          );
          activeMpegts = player;
          player.attachMediaElement(video!);
          player.on(Mpegts.Events.ERROR, () => {
            if (destroyed) return;
            safeDestroyMpegts(player);
            advanceFrom(candidate.url);
          });
          player.on(Mpegts.Events.RECOVERED_EARLY_EOF, () => {
            /* ignore — live TS */
          });
          player.on(Mpegts.Events.MEDIA_INFO, () => {
            if (!destroyed) {
              setIsLive(true);
              setStatus('بث مباشر');
              video!.play().catch(() => {});
            }
          });
          player.load();
        }

        /** Dispatch a candidate source to the right engine. */
        function playSource(info: SourceCandidate | null) {
          if (destroyed) return;
          if (!info) {
            setPlayerError(
              'تعذر تحميل البث — قد تتوقف مصادر البث لهذه القناة أو يحجبها مزود الخدمة عن خوادم التشغيل. جرّب قناة أخرى، وإن استمرت المشكلة تواصل مع الدعم.',
            );
            return;
          }
          if (info.kind === 'hls') {
            tryHlsSource(info);
          } else {
            void tryMpegtsSource(info);
          }
        }

        if (Hls.isSupported()) {
          void nextSource().then((info) => playSource(info));
        } else if (video!.canPlayType('application/vnd.apple.mpegurl')) {
          // Native HLS (Safari): resolve candidates sequentially via <video>.
          let nativeFallback = false;
          const nativePlay = (info: SourceCandidate | null) => {
            if (destroyed) return;
            if (!info) {
              setPlayerError('تعذر تحميل البث — قد تتوقف مصادر البث لهذه القناة');
              return;
            }
            if (info.kind === 'hls') {
              setStatus('تبديل المصدر...');
              video!.src = info.url;
              video!.load();
            } else {
              // Raw TS on Safari — use mpegts.js (MSE) instead of native.
              void tryMpegtsSource(info);
            }
          };
          nativeLoadedMeta = () => {
            if (!destroyed) {
              setIsLive(true);
              setStatus('بث مباشر');
              video!.play().catch(() => {});
            }
          };
          nativeError = () => {
            if (destroyed) return;
            if (!nativeFallback) {
              nativeFallback = true;
              void nextSource().then((info) => nativePlay(info));
            } else {
              setPlayerError('تعذر تحميل البث — قد تتوقف مصادر البث لهذه القناة');
            }
          };
          void nextSource().then((info) => nativePlay(info));
          video!.addEventListener('loadedmetadata', nativeLoadedMeta);
          video!.addEventListener('error', nativeError);
        } else {
          setPlayerError('المتصفح لا يدعم هذا النوع من البث');
        }

        // ── Stall watchdog ─────────────────────────────────────────────────
        // If the video is neither paused nor ended but currentTime stops
        // advancing for 10s, nudge the current engine; if it stalls repeatedly,
        // advance to the next source (alternate slot / relay / error).
        const stallTimer = setInterval(() => {
          if (destroyed || video!.paused || video!.ended) return;
          if (video!.readyState < 2) return; // still loading — not a stall
          const now = Date.now();
          if (video!.currentTime === lastCurrentTime && now - lastProgressAt > 10_000) {
            stallRecoveries += 1;
            lastProgressAt = now;
            if (stallRecoveries >= 3) {
              // Repeated stalls — give up on this source.
              stallRecoveries = 0;
              const src = currentSrcRef.current;
              if (src) {
                safeDestroyHls(activeHls);
                safeDestroyMpegts(activeMpegts);
                advanceFrom(src);
              }
              return;
            }
            // Soft recovery: nudge the current engine.
            setStatus('البث متوقف — إعادة الاسترداد...');
            try {
              activeHls?.startLoad?.();
              if (activeMpegts) {
                // mpegts.js has no startLoad — recreate it on the same URL.
                const src = currentSrcRef.current;
                safeDestroyMpegts(activeMpegts);
                if (src) void tryMpegtsSource({ url: src, kind: 'ts', serverAssisted: true });
              }
            } catch {
              /* ignore */
            }
          }
        }, 2000);
        stallTimerRef.current = stallTimer;
      } catch {
        setPlayerError('تعذر تحميل المشغل');
      }
    }

    const onTimeUpdate = () => {
      lastProgressAt = Date.now();
      lastCurrentTime = video!.currentTime;
    };
    video!.addEventListener('timeupdate', onTimeUpdate);

    initPlayer();

    const PLAY_REPORT_DEDUP_MS = 30_000;
    const reportPlay = () => {
      const channelId = channel.id || channel.channelId;
      if (!channelId) return;
      const prev = playReportedRef.current;
      if (
        prev &&
        prev.channelId === channelId &&
        Date.now() - prev.at < PLAY_REPORT_DEDUP_MS
      )
        return;
      playReportedRef.current = { channelId, at: Date.now() };
      const deviceId = `web-${sessionId || 'anonymous'}`;
      api
        .post(
          `/channels/${channelId}/report-play`,
          { deviceId, proxyPlay: true },
          {
            headers: { 'X-Skip-Auth-Redirect': '1' },
            timeout: 10_000,
          },
        )
        .catch((err) => {
          console.warn(
            '[StreamPlayer] report-play failed:',
            err.response?.status,
            err.response?.data || err.message,
          );
        });
    };
    const onPlaying = () => {
      if (destroyed) return;
      setIsLive(true);
      setStatus('بث مباشر');
      reportPlay();
    };
    const onPause = () => !destroyed && setStatus('متوقف مؤقتاً');
    const onWaiting = () => !destroyed && setStatus('جارٍ التخزين المؤقت...');
    const onVidError = () => !destroyed && setPlayerError('خطأ في التشغيل');
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('error', onVidError);

    return () => {
      destroyed = true;
      if (stallTimerRef.current) {
        clearInterval(stallTimerRef.current);
        stallTimerRef.current = null;
      }
      safeDestroyHls(activeHls);
      if (activeMpegts) {
        try {
          activeMpegts.destroy();
        } catch {
          /* already destroyed */
        }
        activeMpegts = null;
      }
      hlsRef.current = null;
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('error', onVidError);
      if (nativeLoadedMeta) video.removeEventListener('loadedmetadata', nativeLoadedMeta);
      if (nativeError) video.removeEventListener('error', nativeError);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [channel, mode]);

  // Clean up drag listeners on unmount
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  // Drag handler for mini player header
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      right: position.right,
      bottom: position.bottom,
    };

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = dragRef.current.mouseX - ev.clientX;
      const dy = dragRef.current.mouseY - ev.clientY;
      setPosition({
        right: Math.max(0, dragRef.current.right + dx),
        bottom: Math.max(0, dragRef.current.bottom + dy),
      });
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      dragCleanupRef.current = null;
    };
    const handleUp = () => {
      dragRef.current = null;
      cleanup();
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    dragCleanupRef.current = cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- position captured at drag start via dragRef, adding to deps would break drag
  }, []);

  if (!channel) return null;

  const statusColor = playerError
    ? 'text-signal-red'
    : status === 'بث مباشر'
      ? 'text-signal-green'
      : 'text-muted-foreground';

  /*
   * Single return — the video/audio element is always at the same position
   * in the React tree so it is never unmounted when toggling mini mode.
   */
  return (
    <>
      {/* Backdrop overlay — only in full mode */}
      {!mini && (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === overlayRef.current) onClose();
          }}
        />
      )}

      {/* Player container */}
      <div
        role="region"
        aria-label={`Stream player — ${channel.name}`}
        className={
          mini
            ? 'fixed z-[60] shadow-2xl border border-border bg-card flex flex-col overflow-hidden rounded-lg transition-[transform,box-shadow] duration-300'
            : 'fixed z-50 inset-0 flex items-center justify-center p-4 pointer-events-none'
        }
        style={
          mini
            ? {
                width: 'min(360px, calc(100vw - 32px))',
                maxWidth: 'calc(100vw - 32px)',
                right: position.right,
                bottom: position.bottom,
              }
            : undefined
        }
      >
        <div
          className={
            mini
              ? 'flex flex-col w-full'
              : 'max-w-5xl w-full bg-card border-2 border-primary/30 shadow-lg animate-fade-up max-h-[90vh] flex flex-col pointer-events-auto'
          }
        >
          {/* Header */}
          <div
            className={
              mini
                ? 'flex items-center justify-between px-3 py-1.5 bg-card border-b border-border cursor-grab active:cursor-grabbing select-none'
                : 'flex items-center justify-between px-5 py-3 border-b border-border'
            }
            onMouseDown={mini ? handleDragStart : undefined}
          >
            <h2
              className={
                mini
                  ? 'text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground truncate mr-2'
                  : 'text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground'
              }
            >
              {channel.name}
            </h2>
            <div className={`flex items-center shrink-0 ${mini ? 'gap-1' : 'gap-2'}`}>
              {isLive && !mini && (
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-600/10 border border-red-600/30 text-red-600 text-[10px] font-bold uppercase tracking-[0.15em]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
                  </span>
                  LIVE
                </span>
              )}
              <button
                onClick={() => setMini(!mini)}
                className={
                  mini
                    ? 'hidden md:flex items-center justify-center h-8 w-8 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                    : 'hidden md:flex items-center gap-1.5 px-2 py-1 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors'
                }
                aria-label={mini ? 'توسيع المشغل' : 'المشغل المصغر'}
                title={mini ? 'توسيع المشغل' : 'المشغل المصغر'}
              >
                {mini ? (
                  <Maximize2 className="h-3 w-3" />
                ) : (
                  <>
                    <Minimize2 className="h-3.5 w-3.5" />
                    <span className="uppercase tracking-[0.1em] text-xs font-medium">مصغر</span>
                  </>
                )}
              </button>
              <button
                onClick={onClose}
                className={`flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors ${mini ? 'h-8 w-8' : 'h-10 w-10'}`}
                aria-label="إغلاق"
                title="إغلاق"
              >
                <X className={mini ? 'h-3 w-3' : 'h-4 w-4'} />
              </button>
            </div>
          </div>

          {/* Media */}
          <div className="bg-black">
            <video
              ref={videoRef}
              controls
              className={mini ? 'w-full aspect-video' : 'w-full max-h-[80vh]'}
              playsInline
            />
          </div>

          {/* Status bar */}
          <div
            className={
              mini
                ? 'flex items-center justify-between px-3 py-1 border-t border-border'
                : 'flex items-center justify-between px-5 py-2.5 border-t border-border'
            }
          >
            <div
              className={`flex items-center gap-2 truncate ${mini ? 'max-w-[55%]' : 'max-w-[60%]'}`}
            >
              {!mini && isLive && (
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.15em] text-red-600 shrink-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-600" />
                  مباشر
                </span>
              )}
              {!mini && (
                <span
                  className={`truncate text-xs text-muted-foreground`}
                  title={channel.url}
                >
                  {channel.name}
                </span>
              )}
            </div>
            <span
              className={`font-medium ${mini ? 'text-xs' : 'text-xs'} ${statusColor}`}
              aria-live="polite"
              aria-atomic="true"
            >
              {playerError || status}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
