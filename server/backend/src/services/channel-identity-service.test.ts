import ChannelIdentity from '../models/ChannelIdentity';
import Channel from '../models/Channel';
import {
  buildChannelIdentityCandidate,
  normalizeChannelName,
  reconcileChannelIdentities,
} from './channel-identity-service';

describe('channel identity service', () => {
  it('normalizes names without losing Arabic letters', () => {
    expect(normalizeChannelName('  أخبار\u200b الجزائر  HD  ')).toBe('أخبار الجزائر hd');
  });

  it('prefers a real tvg-id over a source-generated id', () => {
    expect(buildChannelIdentityCandidate({ channelName: 'News', tvgId: 'news.dz' })).toMatchObject({
      identityKey: 'tvg:news dz',
      match: 'tvg-id',
      confidence: 0.99,
    });
    expect(buildChannelIdentityCandidate({ channelName: 'News', tvgId: 'xt:source:10', channelId: 'm3u:source:10' })).toMatchObject({
      identityKey: 'name:news:m3u source 10',
      match: 'name',
    });
  });

  it('links equivalent active channels from different sources', async () => {
    const suffix = Date.now();
    await Channel.create([
      {
        channelId: `m3u:${suffix}:news`,
        channelName: 'DZ News',
        channelUrl: 'https://m3u.example/news.m3u8',
        ownerId: null,
        tvgId: 'dz-news.dz',
        metadata: { source: 'm3u', m3uSourceId: `m3u-source-${suffix}` },
      },
      {
        channelId: `xt:${suffix}:news`,
        channelName: 'DZ News HD',
        channelUrl: 'https://xtream.example/news.m3u8',
        ownerId: null,
        tvgId: 'dz-news.dz',
        metadata: { source: 'xtream', xtreamSourceId: `xt-source-${suffix}` },
      },
    ]);

    const result = await reconcileChannelIdentities();
    const identity = await ChannelIdentity.findOne({ identityKey: 'tvg:dz news dz' }).lean();

    expect(result.identities).toBeGreaterThanOrEqual(1);
    expect(result.multiSource).toBeGreaterThanOrEqual(1);
    expect(identity).not.toBeNull();
    expect(identity!.channelCount).toBe(2);
    expect(identity!.sourceCount).toBe(2);
    expect(identity!.sourceKinds).toEqual(expect.arrayContaining(['m3u', 'xtream']));

    const linked = await Channel.find({ channelId: { $in: [`m3u:${suffix}:news`, `xt:${suffix}:news`] } }).lean();
    expect(linked.every((channel: any) => channel.identityKey === 'tvg:dz news dz')).toBe(true);
  });
});
