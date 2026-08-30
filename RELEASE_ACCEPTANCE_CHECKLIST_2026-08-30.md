# DZ HOOF — Release Acceptance Checklist — 2026-08-30

## Code/package verification completed

- [x] No implicit `DEMO` credential/fallback in backend authentication.
- [x] Parental PIN uses PBKDF2-HMAC-SHA256 with random salt and versioned format.
- [x] Legacy SHA-256 PINs migrate after successful verification.
- [x] Local PIN brute-force throttling is enabled.
- [x] Android release R8 and resource shrinking are enabled.
- [x] Backend JavaScript syntax check passes.
- [x] JSON files parse successfully.
- [x] XML files parse successfully.
- [x] Release preflight script syntax passes.
- [x] Android Gradle wrapper executable bit is fixed.

## Live acceptance required before declaring 100% production-ready

- [ ] `server/.env.production` populated only from a secure secret store.
- [ ] Backend starts in production without configuration errors.
- [ ] MongoDB connection and indexes verified.
- [ ] Redis connection and rate/concurrency limits verified.
- [ ] HTTPS reverse proxy and CORS verified from the real public domain.
- [ ] Admin login, 2FA, roles and audit log verified.
- [ ] Authorized M3U import verified.
- [ ] Authorized Xtream import verified.
- [ ] EPG refresh, matching and coverage verified against the real catalog.
- [ ] Subscription activation, expiry and renewal verified.
- [ ] Device limit and revocation verified.
- [ ] Playback token issuance and expiry verified.
- [ ] Authorized HLS manifest + segments play on Android and Android TV.
- [ ] Source health monitoring and fallback verified with a controlled failure.
- [ ] VOD/Series playback verified if enabled.
- [ ] Recording and retention/disk watchdog verified if enabled.
- [ ] Payment webhook signature/idempotency verified if payments are enabled.
- [ ] Reseller balance/code lifecycle verified if reseller mode is enabled.
- [ ] Firebase/FCM features verified if enabled.
- [ ] Release APK built and installed on a physical Android TV/Google TV device.
- [ ] Release APK built and tested on a physical Android phone/tablet.
- [ ] MongoDB backup created and restored into an isolated environment.
- [ ] Rollback to previous application release verified.
- [ ] Monitoring/alerts verified.

## Release decision rule

The code package can be called a **Release Candidate** after the static checks pass.
It can be called **100% production-ready only after every live acceptance item above passes on the actual deployment and authorized media sources**.
