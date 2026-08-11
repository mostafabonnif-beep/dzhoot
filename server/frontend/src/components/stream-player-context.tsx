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

const StreamPlayer = lazy(() => import('./stream-player'));

interface StreamChannel {
  name: string;
  playbackUrl?: string | null;
  url?: string;
  managed?: boolean;
  logo?: string;
  channelId?: string;
  alternateUrls?: string[];
}

interface StreamPlayerState {
  channel: StreamChannel | null;
}

interface StreamPlayerContextValue {
  /** Start playing a stream. Persists across page navigations until closed. */
  playStream: (channel: StreamChannel) => void;
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
  const [state, setState] = useState<StreamPlayerState>({ channel: null });

  const playStream = useCallback(
    (channel: StreamChannel) => {
      setState({ channel });
    },
    [],
  );

  const closeStream = useCallback(() => {
    setState({ channel: null });
  }, []);

  return (
    <StreamPlayerContext.Provider value={{ playStream, closeStream, isPlaying: !!state.channel }}>
      {children}
      {state.channel && (
        <Suspense fallback={null}>
          <StreamPlayer channel={state.channel} onClose={closeStream} />
        </Suspense>
      )}
    </StreamPlayerContext.Provider>
  );
}
