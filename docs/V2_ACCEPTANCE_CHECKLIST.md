# DZ HOOF V2 Acceptance Checklist

- [ ] Provider credentials are encrypted at rest.
- [ ] Viewer API never returns Xtream username/password.
- [ ] Viewer API addresses channels by internal IDs.
- [ ] Subscription expiry is enforced server-side.
- [ ] Device limit is enforced server-side.
- [ ] Concurrent playback limit is enforced server-side.
- [ ] Playback sessions can be revoked.
- [ ] Direct playback is disabled unless explicitly enabled.
- [ ] Direct playback is enabled per provider/source, not globally.
- [ ] Proxy remains available as an explicit fallback.
- [ ] Provider health status is visible to administrators.
- [ ] Full signed playback URLs are absent from logs.
- [ ] Existing playback-security tests remain green.
- [ ] Backend typecheck/build/test suites pass.
- [ ] Frontend lint/build/test suites pass.
- [ ] No production secrets are committed.
