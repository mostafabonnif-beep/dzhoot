# DZ HOOF — Final Engineering Pass — 2026-08-30

## Completed in this pass

- Removed the implicit/default `DEMO` TV credential. Demo access is now strictly opt-in via `DEMO_TV_CODE`.
- Strengthened parental PIN hashing to PBKDF2-HMAC-SHA256 with 210,000 iterations and per-PIN random salt.
- Preserved legacy SHA-256 PIN verification and automatic migration after a successful unlock.
- Added local parental-PIN throttling: five failed attempts trigger a 30-second lockout.
- Kept Android Release R8 and resource shrinking enabled.
- Added `scripts/release/preflight.sh` for repeatable static release checks.
- Preserved SSRF validation, playback-token architecture, subscription gates, source hiding, Redis/MongoDB separation, EPG memory guards, and bounded EPG fetching already present in the supplied build.

## Important release boundary

This branch applies the hardening pass **on top of the latest `main`** (release traceability #48, operational readiness guard #50, and city relay pool #87 are all preserved). It is not honest to label live playback, a signed APK installation, payment-provider callbacks, or disaster-recovery restore as "verified" without executing those tests against the real production environment and authorized media sources.

Required live acceptance tests:

1. Build the official Release APK with the real production API URL.
2. Install it on at least one Android TV/Google TV device and one Android phone.
3. Pair a device and activate a valid subscription.
4. Play an authorized HLS channel end-to-end, including manifest and segments.
5. Verify expired subscription/device limits deny playback.
6. Import an authorized M3U/Xtream source and run EPG refresh.
7. Confirm EPG coverage for the real catalog.
8. Test reseller/code lifecycle if commercial reseller mode is enabled.
9. Perform a real MongoDB backup and isolated restore.
10. Verify rollback from the previous release.

No test result in this document should be interpreted as a substitute for those live acceptance tests.
