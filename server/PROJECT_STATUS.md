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
- Backend TypeScript typecheck and ESLint pass.
- Backend tests pass: 157 tests across 18 suites.
- Frontend ESLint, typecheck, tests, and Next.js production build pass; the build generates 39 routes.
- Dependency audit passes with 0 high-or-above vulnerabilities.
- Android APK build still requires validation in GitHub Actions or on a machine with Java 17 and Android SDK 34.

## Next implementation step

Set `DZHOOF_API_URL` to the real HTTPS server URL through Gradle properties or the release workflow, import one authorized test M3U playlist, run the server with MongoDB/Redis, then build and install the debug APK on an Android TV emulator or device. Use `server/docs/workflow/DEPLOYMENT_GUIDE.md` for the production checklist.
