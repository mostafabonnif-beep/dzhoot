// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  hasRestrictedPresentationMarker,
  publicCatalogPresentationQuery,
  presentationForChannel,
  presentChannelForClient,
  sortClientCatalogChannels,
  cleanDisplayText,
  cleanVodTitle,
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

    // The supplier's own (already clean) group label is preserved for the
    // familiar channel structure; the neutral presentation label is only a
    // fallback when a channel has no raw group.
    expect(presented.channelGroup).toBe('FR| NEWS');
    expect(presented.catalog).toEqual({ countryCode: 'FR', country: 'فرنسا', category: 'أخبار' });
    expect(presented.metadata).toEqual({ country: 'فرنسا', countryCode: 'FR', language: 'fr', quality: 'HD' });
    expect(presented.alternateStreams).toEqual([{ streamUrl: 'https://iptv.example/playback/alternate.m3u8', quality: null, liveness: undefined, flaggedBad: undefined }]);
    expect(JSON.stringify(presented)).not.toContain('xtreamSourceId');
    expect(JSON.stringify(presented)).not.toContain('upstream provider');
    expect(JSON.stringify(presented)).not.toContain('private-agent');
    expect(JSON.stringify(presented)).not.toContain('internal-drm-key');
  });

  it('sorts visible channels by supplier group, then per-group order, then name', () => {
    const sorted = sortClientCatalogChannels([
      { channelId: '3', channelName: 'Z Sports', channelGroup: 'DZ| SPORT', order: 10 },
      { channelId: '1', channelName: 'B News', channelGroup: 'FR| NEWS', order: 1 },
      { channelId: '2', channelName: 'A Sports', channelGroup: 'FR| SPORT', order: 2 },
      { channelId: '4', channelName: 'B Prime', channelGroup: 'FR| SPORT', order: 1 },
      { channelId: '5', channelName: 'A Prime', channelGroup: 'FR| SPORT', order: 1 },
    ]);
    // DZ| before FR|; FR| NEWS before FR| SPORT; within FR| SPORT: order 1
    // (A Prime, then B Prime by name) before order 2.
    expect(sorted.map((channel: { channelId: string }) => channel.channelId)).toEqual(['3', '1', '5', '4', '2']);
  });
});

describe('display-name cleaning', () => {
  it('strips unicode small-caps and decorative symbols from groups/names', () => {
    expect(cleanDisplayText('AR| ARABIC SPORTS ⚽ رياضة ᴴᴰ/ᴿᴬᵂ')).toBe('AR| ARABIC SPORTS رياضة');
    expect(cleanDisplayText('AFR| AFRICA ⱽᴵᴾ ᴴᴰ/ᴿᴬᵂ')).toBe('AFR| AFRICA');
    expect(cleanDisplayText('UK| 24/7 ▶ ᴴᴰ/ᴿᴬᵂ')).toBe('UK| 24/7');
    expect(cleanDisplayText('DZ| قنوات جزائرية ᴴᴰ')).toBe('DZ| قنوات جزائرية');
  });

  it('keeps readable French/Arabic characters and basic punctuation', () => {
    expect(cleanDisplayText('FR| CANAL+ SPORT')).toBe('FR| CANAL+ SPORT');
    expect(cleanDisplayText('TR| RADIO MIX')).toBe('TR| RADIO MIX');
  });

  it('cleans VOD source prefixes from titles', () => {
    expect(cleanVodTitle('4K-AR: 12 Years a Slave (2013)')).toBe('12 Years a Slave (2013)');
    expect(cleanVodTitle('100 Girls (2000)')).toBe('100 Girls (2000)');
    expect(cleanVodTitle('4K-AR: (X مراتي) اكس مراتي')).toBe('(X مراتي) اكس مراتي');
  });
});

describe('catalog curation (CATALOG_HIDE_GROUPS)', () => {
  const originalEnv = process.env.CATALOG_HIDE_GROUPS;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CATALOG_HIDE_GROUPS;
    else process.env.CATALOG_HIDE_GROUPS = originalEnv;
  });

  it('hides curated groups from the customer query by default (radio)', () => {
    delete process.env.CATALOG_HIDE_GROUPS;
    const { publicCatalogHideQuery, isHiddenGroup } = require('./catalog-presentation');
    const q = publicCatalogHideQuery();
    const regex = (q as any).$nor[0].channelGroup;
    expect(regex instanceof RegExp).toBe(true);
    expect(regex.test('TR| RADIO MIX')).toBe(true);
    expect(isHiddenGroup({ channelGroup: 'TR| RADIO MIX' })).toBe(true);
    expect(isHiddenGroup({ channelGroup: 'AR| ARABIC SPORTS' })).toBe(false);
  });

  it('honors a custom hide list and "none" disables hiding', () => {
    const { publicCatalogHideQuery, isHiddenGroup } = require('./catalog-presentation');
    process.env.CATALOG_HIDE_GROUPS = 'RADIO,24/7';
    expect(isHiddenGroup({ channelGroup: 'UK| 24/7' })).toBe(true);
    process.env.CATALOG_HIDE_GROUPS = 'none';
    expect(publicCatalogHideQuery()).toEqual({});
    expect(isHiddenGroup({ channelGroup: 'TR| RADIO MIX' })).toBe(false);
  });
});

describe('duplicate-channel dedup (CATALOG_DEDUP)', () => {
  const { dedupKeyForChannel, selectCatalogDedup } = require('./catalog-presentation');

  it('strips spacing-modifier quality markers from display text', () => {
    const { cleanDisplayText } = require('./catalog-presentation');
    expect(cleanDisplayText('AR| BEIN SPORTS ʰᵉᵛᶜ ⭐')).toBe('AR| BEIN SPORTS');
    expect(cleanDisplayText('AR| ALGERIA ˢ')).toBe('AR| ALGERIA');
    expect(cleanDisplayText('AR| BEIN SPORTS ˢˢ')).toBe('AR| BEIN SPORTS');
    expect(cleanDisplayText('AR| ECHOUROUK TV +6H')).toBe('AR| ECHOUROUK TV +6H');
  });

  it('normalizes copies that differ only by package/quality tags', () => {
    expect(dedupKeyForChannel({ channelName: 'beIN Sprts 1' })).toBe('bein sprts 1');
    expect(dedupKeyForChannel({ channelName: 'BE: beIN SPRTS 1' })).toBe('bein sprts 1');
    expect(dedupKeyForChannel({ channelName: '8K: beIN SPRTS 1 SD' })).toBe('bein sprts 1');
    expect(dedupKeyForChannel({ channelName: 'NM: beIN SPRTS 1 ʰ' })).toBe('bein sprts 1');
    // Distinct channels stay distinct
    expect(dedupKeyForChannel({ channelName: 'AR: Al Jazeera' })).toBe('al jazeera');
    expect(dedupKeyForChannel({ channelName: 'AR: Al Jazeera Mubasher' })).toBe('al jazeera mubasher');
    // Timeshift feeds are NOT duplicates of the base channel
    expect(dedupKeyForChannel({ channelName: 'AR: ECHOUROUK TV +6H' })).toBe('echourouk tv +6h');
  });

  it('hides every copy after the first per normalized name within a group', () => {
    const rows = [
      { _id: 'a1', channelGroup: 'AR| BEIN SPORTS', channelName: 'beIN Sprts 1', order: 1 },
      { _id: 'a2', channelGroup: 'AR| BEIN SPORTS', channelName: '8K: beIN SPRTS 1 SD', order: 2 },
      { _id: 'a3', channelGroup: 'AR| BEIN SPORTS', channelName: 'BE: beIN SPRTS 1', order: 3 },
      { _id: 'a4', channelGroup: 'AR| BEIN SPORTS', channelName: 'beIN Sprts 2', order: 4 },
      { _id: 'a5', channelGroup: 'AR| BEIN SPORTS', channelName: 'NM: beIN SPRTS 2 ʰ', order: 5 },
      { _id: 'b1', channelGroup: 'AR| ALGERIA الجزائر', channelName: 'AR: Echourouk TV', order: 1 },
      { _id: 'b2', channelGroup: 'AR| ALGERIA الجزائر', channelName: 'AR: Echourouk TV', order: 2 },
      { _id: 'b3', channelGroup: 'AR| ALGERIA ˢ', channelName: 'AR: Echourouk TV +6H', order: 1 },
    ];
    const hidden = selectCatalogDedup(rows);
    expect(hidden.sort()).toEqual(['a2', 'a3', 'a5', 'b2']);
  });

  it('keeps the first copy per normalized name even when order ties', () => {
    const rows = [
      { _id: 'x2', channelGroup: 'FR| MAX PPV', channelName: 'FR: MAX PPV 2', order: 0 },
      { _id: 'x1', channelGroup: 'FR| MAX PPV', channelName: 'FR: MAX PPV 1', order: 0 },
      { _id: 'x3', channelGroup: 'FR| MAX PPV', channelName: 'VIP: MAX PPV 1', order: 0 },
    ];
    const hidden = selectCatalogDedup(rows);
    expect(hidden).toEqual(['x3']);
  });
});
