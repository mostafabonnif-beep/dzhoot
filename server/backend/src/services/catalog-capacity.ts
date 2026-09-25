/**
 * How many channels a TV client may sync in one catalog read.
 *
 * This is a safety valve against pathological payloads, not a browse limit: the TV
 * app pages through the catalog 5,000 at a time (`ChannelRemoteDataSource.fetchChannels`)
 * and the server truncates the pageable set at this number. When the ceiling is below
 * the real catalog the truncation is silent — the app simply receives fewer channels and
 * `totalCount` reports the ceiling as if it were the catalog size.
 *
 * That is what happened on 2026-09-25: the prune damage was repaired and the platform
 * went from 13,872 to 25,968 active channels, past a 20,000 ceiling that had been fine
 * the day before. The two route files each carried their own copy of the literal, which
 * is the same drift that blanked the movie catalog earlier, so the number now lives here
 * once and both files read it.
 */

export const TV_CHANNELS_MAX_DEFAULT = 30000;

export function tvChannelsMax(): number {
  const configured = Number(process.env.TV_CHANNELS_MAX);
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  return TV_CHANNELS_MAX_DEFAULT;
}

module.exports = { tvChannelsMax, TV_CHANNELS_MAX_DEFAULT };
