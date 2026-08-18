# DZ HOOF — Production Release Checklist

## Security
- [ ] `PLAYBACK_TOKEN_SECRET` >= 32 chars and unique per environment.
- [ ] `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` are unique production secrets.
- [ ] `TOTP_ENCRYPTION_KEY` configured.
- [ ] `SUBSCRIPTION_REQUIRED=true` in production.
- [ ] HTTPS-only public URLs and non-wildcard CORS.
- [ ] MongoDB/Redis are not publicly exposed.
- [ ] Device credentials are stored only as hashes; pairing payload is encrypted.

## Backend gate
- [ ] `npm ci --ignore-scripts`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build:backend`
- [ ] `npm run test:backend`
- [ ] `npm run smoke:device-security`
- [ ] `npm run smoke:golden-e2e`
- [ ] `npm audit --omit=dev --audit-level=high`

## Android gate
- [ ] `./gradlew lintDebug testDebugUnitTest`
- [ ] Signed `assembleRelease` with `-PrequireSignedRelease=true`
- [ ] `apksigner verify --verbose` passes.
- [ ] SHA-256 recorded for the release APK.
- [ ] Physical Android TV pairing/playback/revoke test passes.

## Operations
- [ ] Encrypted Mongo backup configured off-host.
- [ ] Restore drill completed.
- [ ] Redis persistence/failure policy documented.
- [ ] Monitoring/alerts configured.
- [ ] Rollback image/APK available.
- [ ] Migration list is up to date.
