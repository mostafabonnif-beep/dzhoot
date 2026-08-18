# DZ HOOF — Entitlement & Golden E2E Hardening

## Added in this batch

- Plan-level playback entitlements are now enforced from `Plan.features`.
- `allowLive` and `allowVod` default to `true` for legacy plans.
- `maxConcurrentStreams` can be configured per plan; the global stream limit remains the fallback.
- Device-issued playback tokens are bound to `deviceId` and `deviceCredentialVersion`.
- Revoking a device now invalidates both new device authentication and already-issued device-bound playback tokens.
- HLS child playback tokens inherit the device binding through the upstream proxy.

## Plan feature example

```json
{
  "allowLive": true,
  "allowVod": false,
  "maxConcurrentStreams": 1
}
```

The existing `Plan.features` field is intentionally used so no destructive migration is required.

## Golden production flow

The release acceptance test should cover:

1. Register / login.
2. Activate a subscription plan.
3. Pair a TV device.
4. Receive a device credential.
5. Request playback with the device credential.
6. Verify HLS playback succeeds.
7. Revoke the device.
8. Verify the old device credential is rejected.
9. Verify an already-issued device-bound playback token is rejected.
10. Verify expired/cancelled subscription blocks playback.
11. Verify a plan with `allowVod=false` blocks VOD but permits LIVE.
12. Verify the configured per-plan concurrent stream limit.
13. Restore a production backup into an isolated MongoDB instance and run the same playback checks.

## Required CI commands

```bash
npm ci
npm run typecheck
npm test -- --runInBand
npm run lint
npm run build
```

Android release validation must additionally run the project's Gradle test/lint/release tasks on a network-enabled CI runner.
