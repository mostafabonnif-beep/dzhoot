# Dzhoof — first version

Dzhoof is a legal IPTV player and channel-management platform. It accepts streams the operator is authorized to use; it does not provide pirated channel sources.

## Starting point

This first version is based on the MIT-licensed FireVision IPTV Server and FireVision IPTV Android TV repositories. The upstream server already provides authentication, admin/user roles, M3U import, channel groups, EPG, device pairing, M3U/JSON playlist delivery, stream proxying, health checks, and a web admin dashboard. The Android app already provides Media3 playback, M3U/Xtream input, categories, favorites, search, EPG, TV pairing, and D-pad navigation.

## Dzhoof first-version scope

- Rebrand the app and dashboard from FireVision to Dzhoof.
- Point the Android app at the Dzhoof server instead of the upstream hosted server.
- Keep the first release focused on: admin login, authorized M3U import, categories, channel playback, favorites, EPG, and TV pairing.
- Defer subscriptions, payments, reseller accounts, and DRM until the core playback and deployment path is verified.

## Local credentials

The local server `.env` contains development-only bootstrap credentials. Replace them before any public deployment.

## Validation status

- Shared TypeScript package builds.
- Backend TypeScript typecheck passes.
- Backend tests pass: 89 tests across 5 suites.
- Android APK build is not yet validated because this environment has no Java/Android SDK.

## Next implementation step

Set the real HTTPS server URL in `android/app/build.gradle.kts`, import one authorized test M3U playlist, run the server with MongoDB/Redis, then build and install the debug APK on an Android TV emulator or device.
