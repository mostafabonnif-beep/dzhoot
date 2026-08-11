export interface PlaybackChannel {
  name: string;
  playbackUrl?: string | null;
  url?: string | null;
  managed?: boolean;
  logo?: string;
  channelId?: string;
  alternateUrls?: string[];
}

export function resolvePlaybackSource(channel: PlaybackChannel): { url: string; managed: boolean } {
  const managed = channel.managed === true || Boolean(channel.playbackUrl);
  if (managed) {
    if (!channel.playbackUrl) {
      throw new Error('Secure playback is unavailable for this managed stream');
    }
    return { url: channel.playbackUrl, managed: true };
  }
  if (!channel.url) {
    throw new Error('Playback URL is unavailable');
  }
  return { url: channel.url, managed: false };
}
