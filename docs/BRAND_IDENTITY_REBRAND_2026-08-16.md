# DZ HOOF brand identity update — 2026-08-16

## Objective

Remove visible legacy FireVision branding from the customer-facing product and establish one consistent DZ HOOF identity across the Android launcher, splash screen, email templates, EPG generator metadata, OAuth user agent, frontend storage keys, and default development identities.

## Implemented

The supplied DZ HOOF artwork is now stored as `android/app/src/main/res/drawable-nodpi/dzhoof_logo.png` and is used by the adaptive launcher foreground, monochrome launcher resource, and the Compose splash screen. The previous Lottie splash path and legacy flame vector are no longer used by the customer-facing Android startup flow.

Runtime-facing backend and frontend strings were rebranded to DZ HOOF, including email subjects and templates, default local admin/test email addresses, EPG generator metadata, source User-Agent, device lock namespace, and frontend local-storage namespaces. Internal workspace package namespaces were subsequently migrated from `@firevision/*` to `@dzhoof/*` after regenerating the npm workspace lockfile and re-running dependency graph checks. The legal third-party attribution in `docs/THIRD_PARTY.md` was preserved as required by the applicable license notices.

## Verification

Backend: 200/200 tests passed in the current regression suite.

Android: unit tests and Kotlin compilation passed; debug APK assembly passed.

No production URL is embedded in the repository documentation; the Android API base URL is supplied through the Gradle build configuration.

The unused legacy Lottie splash asset and dependency were removed after the branded static splash was verified. This reduces legacy surface area and avoids shipping an unused old visual asset.

Final APK SHA-256: `5006ec49973dc5c2ce56a39a377cf2cb1bee2fdcd70ba8f979a8c9c966e694a6`

## Remaining note

Historical reports may still mention the former namespace as part of the migration history. Active workspace manifests, imports, Docker build commands, CI workflows, and the npm lockfile now use `@dzhoof/*`; legal third-party attribution remains unchanged.
