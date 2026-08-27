// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  hasRestrictedPresentationMarker,
  publicCatalogPresentationQuery,
  presentationForChannel,
  presentChannelForClient,
  sortClientCatalogChannels,
} = require('./catalog-presentation');

describe('catalog presentation', () => {
  it('marks decorative hash and supplier-name entries as not customer-visible', () => {
    expect(hasRestrictedPresentationMarker({ channelName: '##### beIN SPORTS HD #####' })).toBe(true);
    expect(hasRestrictedPresentationMarker({ channelGroup: 'AR| NEO 4K' })).toBe(true);
    expect(hasRestrictedPresentationMarker({ tvgLogo: 'https://images.example/neo/channel.png' })).toBe(true);
    expect(hasRestrictedPresentationMarker({ channelName: 'قناة رياضية HD', channelGroup: 'AR| SPORT' })).toBe(false);

    const query = publicCatalogPresentationQuery();
    expect(query.$nor).toHaveLength(10);
  });

  it('derives a neutral country and category from available display fields', () => {
    expect(presentationForChannel({ channelGroup: 'DZ| ALGERIA SPORT', channelName: 'Programme 1' }))
      .toEqual({ countryCode: 'DZ', country: 'الجزائر', category: 'رياضة', group: 'الجزائر · رياضة' });
    expect(presentationForChannel({ channelGroup: 'FR| GENERAL', channelName: 'France 24 News' }))
      .toEqual({ countryCode: 'FR', country: 'فرنسا', category: 'أخبار', group: 'فرنسا · أخبار' });
  });

  it('does not serialize source identifiers or alternate source labels to client payloads', () => {
    const presented = presentChannelForClient({
      channelId: 'channel-1',
      channelName: 'France 24 News',
      tvgName: 'France 24 News',
      channelGroup: 'FR| NEWS',
      channelUrl: 'https://iptv.example/playback/token.m3u8',
      channelDrmKey: 'internal-drm-key',
      activeUserAgent: 'private-agent',
      activeReferrer: 'https://private.example',
      metadata: {
        source: 'xtream',
        xtreamSourceId: 'source-id',
        xtreamStreamId: 10,
        m3uSourceId: 'm3u-id',
        country: 'Internal country',
        language: 'fr',
        quality: 'HD',
      },
      alternateStreams: [{
        streamUrl: 'https://iptv.example/playback/alternate.m3u8',
        source: 'upstream provider',
        userAgent: 'private-agent',
        referrer: 'https://private.example',
      }],
    });

    expect(presented.channelGroup).toBe('فرنسا · أخبار');
    expect(presented.catalog).toEqual({ countryCode: 'FR', country: 'فرنسا', category: 'أخبار' });
    expect(presented.metadata).toEqual({ country: 'فرنسا', countryCode: 'FR', language: 'fr', quality: 'HD' });
    expect(presented.alternateStreams).toEqual([{ streamUrl: 'https://iptv.example/playback/alternate.m3u8', quality: null, liveness: undefined, flaggedBad: undefined }]);
    expect(JSON.stringify(presented)).not.toContain('xtreamSourceId');
    expect(JSON.stringify(presented)).not.toContain('upstream provider');
    expect(JSON.stringify(presented)).not.toContain('private-agent');
    expect(JSON.stringify(presented)).not.toContain('internal-drm-key');
  });

  it('sorts visible channels by country, then category, then display name', () => {
    const sorted = sortClientCatalogChannels([
      { channelId: '3', channelName: 'Z Sports', channelGroup: 'DZ| SPORT' },
      { channelId: '1', channelName: 'B News', channelGroup: 'FR| NEWS' },
      { channelId: '2', channelName: 'A Sports', channelGroup: 'FR| SPORT' },
    ]);
    expect(sorted.map((channel: { channelId: string }) => channel.channelId)).toEqual(['3', '1', '2']);
  });
});
