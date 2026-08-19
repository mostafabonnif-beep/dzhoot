# IPTV competitive findings — 2026-08-16

## TiviMate

Official source: https://tivimate.com/

The official page positions TiviMate as a media player that does not provide channels or content. Its highlighted capabilities include multiple playlists, favorite channels, search, multiview, catch-up, recording, parental controls, and personalization. It is explicitly designed for Android TV and emphasizes remote-friendly control and a TV guide experience.

## Sparkle TV

Official source: https://www.sparkleplayer.com/

Sparkle TV positions itself as a DVR/PVR player for Android TV, Google TV, and Fire TV. It supports M3U, Xtream Codes, XMLTV, EPG and channel guide, logos and program images, favorites, sorting and hiding channels/categories, multiple audio tracks, subtitles, auto frame rate, timeshift, search, DVR, multiview, VOD, themes, home-screen integration, multiple sources, parental controls, remote customization, and a sleep timer. It also clearly states that it does not provide channels or media and that users must have lawful content sources.

## Initial implications for DZ HOOF

DZ HOOF already has a stronger managed-service concept than these pure players because it has activation codes, a managed backend, source verification, playback tokens, customer visibility rules, and a server-side media pipeline. The main experience gaps to prioritize are a clearer TV guide/channel guide, stronger search and filtering, visible but understandable channel status, favorites and recently watched polish, sleep timer, multiple audio/subtitles where the source supports them, Android TV remote focus, and a clean legal/source status model.

## Google Play comparison

IPTV Smarters Pro's Google Play description highlights user-provided IPTV playback, playlist management, channel navigation, live streaming controls, VOD access, EPG integration, and M3U/M3U8 support. The listing reinforces that a player depends on the user's lawful content source.

TiviMate's Google Play listing highlights M3U, Xtream Codes and Stalker Portal support, a fast grid EPG, multiple playlists, favorites, catch-up, recording, search, and multiview. The listing is marked as TV-supported and emphasizes an interface tailored to large screens.

## Prioritized product requirements for DZ HOOF

1. Keep the activation-only onboarding and managed backend as a differentiator, while making the first-run experience as fast as a player app.
2. Improve the TV guide into a clear grid with now/next programs, channel logos, category filtering, and fast focus movement.
3. Polish favorites, recent channels, search, and category sorting/hiding.
4. Make playback controls TV-first: clear overlay, channel zap, audio/subtitle selection where supported, sleep timer, retry and source-status messaging.
5. Add multiview and recording only after the legal source and storage/bandwidth model support them; these features create substantial operational cost.
6. Make source status and legal availability explicit in administration while keeping provider credentials and original stream URLs hidden from customers.

## Implemented in this iteration

The Android guide filter bar now uses localized resources for the All and Favorites filters instead of fixed English labels. Guide loading and empty-state messages also use resources, which keeps the Arabic Android TV experience consistent. Existing guide functionality already includes a channel-by-time grid, category filtering, favorites filtering, channel tuning, and catch-up dispatch when the source supports it.

This iteration deliberately prioritizes polish and clarity over adding expensive features such as DVR or multiview before a legal, stable source and production storage/bandwidth model are available.
