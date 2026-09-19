# Changelog

## [Unreleased]

### Changed (crash reports no longer leave the device with credentials)

- The crash reporter redacts every free-text field before the report is queued to disk. A throwable message routinely embeds the URL or token that caused the failure — an Xtream `get.php?username=&password=` request, a `/live/<user>/<password>/1423.ts` path, a bearer token or a playback JWT — and none of those may be uploaded (operations brief §7). `CrashRedactor` is the Kotlin counterpart of the server's `redactSensitiveText` (same rules, kept in step) and runs on the device, so the credentials never leave it; the server redacts again on ingest, because a crashed app cannot be trusted to have scrubbed its own payload and shipped clients can be older. The failure site — exception type, message, `file:line` — is preserved so the bug stays reproducible.
- The queue log line now prints the exception type only. It used to log the full exception message to logcat, which is exactly where a credential would be.

### Added (request correlation ids)

- Every managed API call now carries `X-Request-ID` — a random UUID that labels that one request and nothing else (no user, device, account or session data). The backend already accepts and echoes a valid value and logs it as `rid=`, and the diagnostics screen now shows "معرّف آخر طلب" for it, so a support conversation can start from the id the user reads off the screen instead of guessing a time window. Only DZ HOOF API calls are correlated: BYO playlist, EPG and stream hosts receive no such header. The id lives in memory for the session only, and the report's safety screen rejects any value that is not a UUID.

### Added
- Release provenance manifest: every `vX.Y.Z` release now attaches `dzhoof-tv-vX.Y.Z-official.release.json` containing versionName, versionCode, channel, distribution, size, SHA-256, **signing certificate SHA-256 fingerprint**, min/target SDK, commit and build timestamp — see `docs/RELEASE_PROVENANCE.md`. The release job fails closed when the APK has no verifiable signature, when the checksum or fingerprint cannot be read, or when the APK's versionCode disagrees with the documented `major*10000+minor*100+patch` derivation, so a build can never publish without them.
  - The manifest is now actually produced and uploaded by `.github/workflows/android-release.yml` (it previously existed as a script that no workflow called) and printed in the run's step summary; the generator's fail-closed behaviour is covered by `scripts/ci/test-write-release-manifest.sh`, which CI runs in the Secret guard job.
  - A release candidate (`.github/workflows/release-candidate.yml`) now produces the same APK name, `.sha256` and `beta`-channel manifest as build artifacts. Its checksum used to be written to a path the upload step never read (`android/app-official-release.apk.sha256` vs `android/app/…`), so candidates shipped without a checksum; the generator also mis-derived the versionCode for suffixed versions (`1.0.0-rc.1` parsed its patch part as `0-rc.1`), which would have failed every candidate once the manifest was enforced.
- In-app diagnostics screen (Settings): which build this is (versionName, versionCode, signing-certificate SHA-256), how it was installed (`play` / `managed_device` / `external_apk` and what that means for updates), when the last update check ran and what came of it (mapped to a readable Arabic reason per `UpdateErrorCode`), and which backend the app is talking to (`/health/version` version, commit, builtAt, environment), with a copy-to-report action for support. The report is screened before it is built or displayed: it never carries a token, JWT, password, username, playlist/Xtream/EPG URL, device serial or account code, and a value that looks like any of those renders as a placeholder instead.
- Distribution-path detection: the app now knows and reports internally which of the three update paths applies to this install — `play` (installed from Google Play), `managed_device` (proven device owner / affiliated profile owner) or `external_apk` (everything else). The managed path is only chosen when the device policy state proves it; silent install is never inferred, and Play takes precedence because Play's policy governs store installs.
- Pre-install verification of a downloaded update, all fail-closed: SHA-256 checksum, package name, expected versionCode, downgrade protection, plus the existing signature comparison. Failures map to stable `UpdateErrorCode` values that mirror the server's error taxonomy.
- APK download URL allowlist: HTTPS only, no credentials in the URL, no IP literals (so loopback/private ranges and DNS-rebinding hosts are unreachable), GitHub release hosts plus the configured API host.
- The update check now sends `currentVersionCode`, `channel` and `platform` (`android-tv` on TV/leanback devices, otherwise `android`) and reads `sha256`, `versionCode`, `sizeBytes` and `minimumSupportedVersionCode` from the API response.
- `AppUpdater.DownloadState.Failed` now carries the non-sensitive error `code` alongside the Arabic message so telemetry and diagnostics can report the reason without parsing text.

### Changed
- A Google Play installation is no longer offered the app's own sideload path: `UpdateManager` reports `DelegatedToStore` and leaves updating to Play (which governs store installs anyway). The Play In-App Updates flow itself is wired separately, so this is the correct outcome in both cases.
- Update failure messages now come from the shared error taxonomy (same wording for the same failure everywhere) instead of ad-hoc strings at each call site.

## [1.3.3] - 2026-09-17

Fixes for the errors the app reported about itself. The two crash classes below are the
only ones present in the production `crashreports` collection (7 reports); every other
item was found by reading the code against its own contracts.

> Entries for 1.2.1 – 1.3.2 were never written to this file. They are not reconstructed
> here: the GitHub release notes for those tags are the record.

### Fixed (crashes)

- **Duplicate lazy-list keys took the whole screen down.** Three crash reports from a
  Samsung SM-S906B carried `IllegalArgumentException: Key "رياضة" was already used`. A
  channel-group label is not unique (the same group can arrive from two sources), and
  seven lists keyed on a non-unique value — `{ it.name }`, `{ it.channelId }`,
  `key = keyOf`, `{ _, channel -> channel.id }`, `{ it.key }`, `{ _, entry -> "category_…" }`.
  All of them are position-prefixed now, and `LazyListKeyUniquenessTest` fails the build
  for any new one (the scanner self-checks the shapes that caused the crash).
- **Writing stream health could kill the player mid-stream.** `channel_health.channelId`
  is a foreign key into `channels`, so a background sync that dropped the channel made
  the write raise `SQLiteConstraintException` inside an unguarded `viewModelScope.launch`.
- **The health scanner could crash the app at every launch.** Its unattended loop ran on
  a plain `SupervisorJob` scope with no `CoroutineExceptionHandler`, so one SQLite/IO
  failure escaped to the default handler.
- **Saving an Xtream source crashed on devices with a broken keystore.**
  `AppPreferences` let `SecurePreferences`' `SecurityException` escape from the caller's
  UI-thread coroutine. It now reports failure instead, so the app never switches to a
  source whose password was not stored.
- **A malformed channel aborted the entire refresh.** Gson writes null into the non-null
  `ChannelDto.id/name/url` fields when a payload omits them, and the NPE came out of
  `ChannelEntity`'s constructor inside a bulk `map { toEntity(it) }` — one bad entry, no
  channels at all, behind a generic "تعذر تحميل القنوات". Unusable entries are dropped
  with a logged count.
- **A Room failure in any list screen crashed the app** over data that only decorates a
  score badge: `channelHealthDao.getAllHealth()` was combined into the channel flow in
  eight places with no exception handling.

### Fixed

- **Bring-your-own playlist import never finished.** `AddSourceScreen` compared
  `playlistResult` to the literal `"Playlist loaded"` while the ViewModel set
  `"تم تحميل قائمة التشغيل"`, so onboarding never advanced and a success was drawn as a
  warning. The strings now live in one place.
- **Tapping a channel whose id contains `/` crashed navigation.** BYO playlists derive
  the id from the channel name when there is no tvg-id, so `"24/7 HD"` added a path
  segment and Navigation threw. Ids are encoded like the other id-carrying routes
  (`ScreenRouteEncodingTest`).
- **Multiview panes stayed black after a channel change.** `VideoPlayer`'s `AndroidView`
  bound the player only in `factory`; Multiview recreates its ExoPlayer per channel while
  reusing the view, so the reused `PlayerView` kept painting a released player.
- **The exported sync receiver was usable as a denial of service.** "Protected" by
  `RECEIVE_BOOT_COMPLETED` — a normal permission any installed app can hold — so any app
  could force a full channel re-sync at will. Senders cannot be authenticated for either
  action, so the trigger is throttled to one sync per 10 minutes.

### Security

- **Debug HTTP logging leaked credentials.** `HttpLoggingInterceptor(Level.HEADERS)`
  printed the full URL and every header, redacting only `X-TV-Code`: `X-Session-Id`, the
  Xtream account inside a BYO URL (`/live/<user>/<pass>/123.ts`,
  `player_api.php?username=…`) and the managed playback token in the path all reached
  logcat. Replaced by a logger that prints method, host, path (token-shaped segments
  masked), status and duration — never the query, never a header (`AGENTS.md` forbids
  credentials in logs).

### Added

- Crash reports now carry the screen they happened on. The endpoint has always accepted
  `screen` (100 chars) and the app never filled it, so all seven reports in production
  arrived with `screen: null` and had to be diagnosed from obfuscated frames. Only the
  destination *pattern* (`player/{channelId}`) is recorded — never its arguments.

## [1.2.0] - 2026-09-09

### Added
- Channel management per channel: hide and PIN-lock any channel from the channel list; hidden channels disappear from browse, search and zap, locked channels ask for the PIN in the player.
- Manage Channels screen (Settings): review, search, unhide and unlock channels in one place.
- Per-channel track preferences: the audio/subtitle tracks you pick are remembered per channel and auto-applied on the next tune; manual picks always win.
- Display refresh-rate matching: during live playback the player matches the display refresh rate to the video frame rate (with safe fallbacks) for smoother motion.
- Channel number chip on the zap info bar (live TV).
- VOD player controls: sleep timer (30/60/90/120 min with live countdown and tap-to-resume), aspect ratio cycle (ملاءمة / تكبير / ملء الشاشة) and playback speed widened to 0.5×–2×.
- Room schema v11 (channel_prefs).

### Notes
- All features are client-side; no server change required.

---
## [1.1.0] - 2026-09-08

### Added
- Home "مباريات اليوم": today's live/upcoming sports matches row (server EPG detection), with LIVE badge / kickoff time per match — tap to tune straight to the carrying channel. Works on phone, TV, and boxes; row hides automatically when empty or when the device isn't paired.
- VOD playback speed control: tap the floating chip in the movie/episode player to cycle 0.75× → 1× → 1.25× → 1.5× → 2× (applies to the current and following items in the session).

### Notes
- Server API consumed: `GET /api/v1/tv/epg/:code/matches-today` (already live in production; no server change needed).

---

## [2.2.3] - 2026-07-14

### Added
- enhance UI styles for ChannelCard and HomeHero components
- implement update available screen and view model for app updates fix: enhance UI components with focus visuals and elevation adjustments refactor: streamline settings components and player key mappings

### Fixed
- enhance TV search layout for improved UX and align header with query bar
- multiview channel picker crashing on large playlists
- channel long-press toggling favorite while opening context menu
- in-app update stuck at Downloading on Android 13+
- stop settings tabs resetting to Connection during busy states

### Other
- Refactor UI components and enhance settings functionality
- Refactor update handling: Move update logic to AppUpdater class
- Refactor pairing UI components and improve source management

---

## [2.2.2] - 2026-07-14

### Fixed
- make player menu reachable on remotes without a MENU button

---

## [2.2.1] - 2026-07-14

### Fixed
- store credential-free Xtream stream URLs, resolve at use time

---

## [2.2.0] - 2026-07-14

### Added
- EPG guide upgrades, mobile player overhaul, PiP, and TV search redesign
- live EPG guide, playlist import, multiview and TV UI overhaul

### Changed
- polish README for public discoverability

### Fixed
- redact credentials from thumbnail-extractor URL logs
- EPG refresh reliability and correctness (Greptile)
- encrypt Xtream credentials + guard XMLTV EPG fetch (Greptile)

### Other
- Refactor settings UI components for better layout and responsiveness
- snapshot: WIP UI (audit fixes + in-progress screens) before mobile overhaul

---

## [2.1.3] - 2026-04-05

### Added
- integrate AnalyticsHelper into PlayerViewModel for enhanced event logging
- update SettingsViewModel to include download and connection test states
- Enhance PlayerScreen with mobile-specific features and immersive mode

### Other
- Add unit tests for PlayerViewModel, SearchViewModel, and SettingsViewModel

---

## [2.1.2] - 2026-04-04

### Added
- enhance Favorites feature to include favorite categories and navigation
- add ChannelsByCategory route to sidebar navigation
- enhance ChannelCard to display logo overlay on thumbnail

---

## [2.1.1] - 2026-04-04

### Added
- Integrate Amazon Appstore DRM for license verification and update ProGuard rules

---

## [2.1.0] - 2026-04-04

### Added
- Add header redaction for X-TV-Code in NetworkModule and recycle QR code bitmap in SettingsViewModel
- Enhance channel synchronization and playback handling in ChannelManager and PlayerScreen
- Implement Box overlay pattern for splash screen to pre-warm ViewModel
- Enhance channel management and UI with cache clearing functionality, improved empty states, and app startup flow documentation
- Add FUNDING.yml for GitHub sponsorship and support options

### Changed
- Update README for clarity and formatting improvements

### Other
- Add documentation for plaintext TV code storage decision, app startup flow, deployment guide, favorites workflow, health scanner lifecycle, player back press flow, and developer setup guide
- Refactor ChannelManager to use Hilt for dependency injection, sync EPG data, and improve channel management

---

## [2.0.5] - 2026-04-03

### Added
- Update splash animation colors and enhance font mapping in SplashScreen
- Implement pullFavoritesFromServer use case and related tests
- Implement unified color palette across FireVision IPTV app
- show current EPG program title on channel cards
- add unit tests for error handling in repository classes and update dependencies for testing
- add pre-commit hook for Android lint checks and update Makefile for setup instructions
- integrate Sentry for error tracking and reporting in the Android app
- add Sentry crash tracking and Jacoco/Codecov coverage reporting
- add portrait orientation support for Android phone users
- add EPG Phase 1 now/next program display in player overlay

### Changed
- add Android app user guide for end users
- streamline TV code management by centralizing SharedPreferences access
- update CHANGELOG.md for v2.0.4
- update preview assets by removing obsolete video and adding new images

### Fixed
- Update release tagging command to use 'v' instead of 'VERSION' for consistency
- Update border color references to use subtleBorder for consistency across components
- Implement long-press favorite toggle and enhance channel navigation logic
- Enhance category chip focus effects and improve visual feedback
- fix:#35 Improve thumbnail loading and enhance favorite button auto-hide logic
- update CI workflow to generate coverage report and set Sentry environment variables
- set ANDROID_SDK_ROOT and export environment variables in Makefile
- address PR review feedback for portrait mode
- add InnerClasses attribute to proguard keep rules for Gson TypeToken
- add EnclosingMethod and TypeToken keep rules to prevent Gson crash on release builds
- settings key event consumed when no handler, remove unused parameter
- Fire TV remote optimization — D-pad focus, OK/Menu/Settings buttons, debouncing

### Other
- Enhance UI state management and improve color theming
- Refactor app icons and backgrounds for improved design consistency
- Fix race condition in EpgRepositoryImpl cache loading
- Apply suggestions from code review
- Add GitHub issue templates (bug, feature request, remote navigation)

---

## [2.0.4] - 2026-03-21

### Added
- implement alternate stream fallback and enhance stream reporting
- enhance stream reporting with proxy support and update serialized names
- add stream metrics reporting and bidirectional favorites sync

### Changed
- add server-side implementation context for stream metrics

### Fixed
- adjust card dimensions and improve layout responsiveness across screens
- prevent FK crash in pullFavorites and suppress buffer watch during recovery
- wire onStreamUnresponsive callback and reset play tracker on load

### Other
- Add GitHub issue drafts for stream metrics feature

---

## [2.0.3] - 2026-03-18

### Added
- expand Makefile with emulator, device, and app lifecycle commands

### Changed
- remove legacy SettingsActivity, autoload channel feature, and extract CategoryCard component

### Fixed
- update playlist endpoint path to /api/v1/channels/playlist.m3u
- rename auth header from X-Session-ID to X-TV-Code to match server API
- defer keyboard popup on TV text inputs until explicit OK press
- improve error handling with auth-aware states and redesign settings layout
- overhaul pairing flow with PIN-based QR codes, reset support, and race condition fixes

### Other
- Fix Fire TV launcher banner and increase card sizes for TV viewing

---

## [2.0.2] - 2026-03-18

_(No notable changes recorded)_

---

All notable changes to FireVision IPTV are documented in this file.

## [2.0] - 2026-03-15

Major architecture modernization and full Kotlin migration.

### Architecture
- Migrated entire codebase from Java to Kotlin
- Implemented clean architecture with domain layer, repositories, and ViewModels
- Modernized build system and implemented Room database architecture
- Implemented ViewModel-based state management for channels

### Features
- Added screens for Channels, Favorites, Home, Player, Search, and Settings with new UI components
- Enhanced Player and Search screens with Pairing functionality
- Implemented animated splash screen with gradient background
- Enhanced PairingActivity with countdown functionality and improved handler management
- Added app version display and check-for-updates in settings

### UI/UX
- Refactored SettingsScreen and related components for improved UI
- Updated drawable resources for app icons and banners

### Cleanup
- Removed unused animation files

---

## [1.5] - 2025-11-27

### Features
- Implemented category and language selection UI
- Netflix-style UI enhancements with error handling and default channel options
- Enhanced PlaybackActivity with wake lock and improved key handling
- Refactored settings layout for Netflix-style UI and sidebar navigation
- Added playlist support

### Cleanup
- Removed Realm and Firebase Firestore dependencies
- Removed SearchActivity/SearchFragment and associated layouts
- Cleaned up unused fileReader class and related XML layouts
- Removed outdated build fix documentation

---

## [1.4] - 2025-11-01

### Features
- Implemented sidebar navigation and updated UI components
- Implemented Channel Overlay feature
- Enhanced search UI components
- Implemented update management and loading indicators

### DevOps
- Added GitHub build action

---

## [1.3] - 2024-06-05

### Features
- Added search functionality in the app

---

## [1.2] - 2024-06-05

_(No user-facing changes — internal release)_

---

## [1.1] - 2024-06-05

### Features
- Added categories support
- Version bump

---

## [1.0] - 2024-06-05

### Initial Release
- Initial commit with core IPTV functionality
- Firebase and Google Services integration
- CI/CD pipeline setup with GitHub Actions
