'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  lazy,
  Suspense,
  type ReactNode,
} from 'react';
import api from '@/lib/api';

const StreamPlayer = lazy(() => import('./stream-player'));

interface StreamChannel {
  name: string;
  url: string;
  logo?: string;
  channelId?: string;
  alternateUrls?: string[];
  /** true = url is a ready-to-play token URL (VOD/live token); skip stream-proxy wrapping */
  direct?: boolean;
  /** Number of alternates available (for on-demand slot tokens when direct=true) */
  maxSlot?: number;
}

interface StreamPlayerState {
  channel: StreamChannel | null;
  mode: 'proxy' | 'direct-fallback';
}

interface StreamPlayerContextValue {
  /** Start playing a stream. Persists across page navigations until closed. */
  playStream: (channel: StreamChannel, options?: { mode?: 'proxy' | 'direct-fallback' }) => void;
  /**
   * Start playing a live channel through a secure playback token instead of the
   * raw upstream URL. Issues slot-0 token, then lets the player fetch alternate
   * slot tokens on demand. Falls back to the raw URL only if token issuance fails.
   */
  playChannel: (channel: StreamChannel) => Promise<void>;
  /** Close the stream player. */
  closeStream: () => void;
  /** Whether a stream is currently active. */
  isPlaying: boolean;
}

const StreamPlayerContext = createContext<StreamPlayerContextValue | null>(null);

export function useStreamPlayer() {
  const ctx = useContext(StreamPlayerContext);
  if (!ctx) throw new Error('useStreamPlayer must be used within StreamPlayerProvider');
  return ctx;
}

export function StreamPlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StreamPlayerState>({
    channel: null,
    mode: 'proxy',
  });

  const playStream = useCallback(
    (channel: StreamChannel, options?: { mode?: 'proxy' | 'direct-fallback' }) => {
      setState({
        channel,
        mode: options?.mode ?? 'proxy',
      });
    },
    [],
  );

  const playChannel = useCallback(
    async (channel: StreamChannel) => {
      const maxSlot = Math.max(0, channel.alternateUrls?.length || 0);
      try {
        const res = await api.post('/tv/playback-token', { channelId: channel.channelId, slot: 0 });
        const { playbackUrl } = res.data.data;
        playStream({ ...channel, url: playbackUrl, direct: true, maxSlot, alternateUrls: undefined });
      } catch (err) {
        console.warn('[StreamPlayer] token issuance failed, falling back to raw proxy:', err);
        playStream(channel, { mode: 'proxy' });
      }
    },
    [playStream],
  );

  const closeStream = useCallback(() => {
    setState({ channel: null, mode: 'proxy' });
  }, []);

  return (
    <StreamPlayerContext.Provider value={{ playStream, playChannel, closeStream, isPlaying: !!state.channel }}>
      {children}
      {state.channel && (
        <Suspense fallback={null}>
          <StreamPlayer channel={state.channel} onClose={closeStream} mode={state.mode} />
        </Suspense>
      )}
    </StreamPlayerContext.Provider>
  );
}
