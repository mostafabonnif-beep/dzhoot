# Contributing to DZ HOOF

Thanks for helping. DZ HOOF is a legal IPTV player and channel-management
platform: it only manages streams, playlists, EPG sources and metadata the
operator is authorized to use.

## Read first

- `AGENTS.md` — the AI development rules (product boundaries, architecture,
  protected behavior, security rules). They apply to every contributor.
- `PROJECT_ROADMAP.md` — current scope, phases and what counts as "done".
- `server/PROJECT_STATUS.md` — honest status of the server component.
- `server/docs/` — architecture, API documentation, deployment and security
  guides.

## Before you start

- Open an issue (or comment on an existing one) describing what you want to
  change and why, so work is not duplicated.
- For new features, confirm they fit the roadmap scope. The project is at a
  pre-release stage: stabilizing core playback and deployment beats new scope.

## Branching

- `main` — stable, installable state.
- `develop` — integration of in-flight work.
- `feature/<name>` — new feature.
- `fix/<name>` — bug fix.
- `release/<version>` — release preparation.

## Commit messages

Use the conventional prefix:

```
feat: add EPG source management
fix: handle expired pairing PIN
refactor: isolate playlist parser
docs: update deployment guide
test: cover Xtream normalization
build: prepare Android release
security: hide upstream credentials
```

## Pull requests

Every PR must state:

1. **What changed** and **why**.
2. **How it was tested** (command run, manual steps on device/emulator).
3. **Database or API changes** (migrations to run, endpoints changed).
4. **New secrets or configuration** (and their env vars).
5. **License review** if any external code was adapted (record it in
   `docs/THIRD_PARTY.md`).

## Rules of thumb

- Make small, focused changes. Do not rewrite unrelated modules.
- Read the existing implementation before editing it.
- Never hard-code credentials, tokens, provider URLs or private keys.
- Keep SSRF protections, auth, rate limiting and audit logging intact.
- Add tests for new backend behavior; run `npm run test:backend`,
  `npm run typecheck` and `npm run lint` before pushing.
- Android changes must be tested on both Android TV and phone form factors
  where relevant.
- Do not copy branding, images or UI resources from other apps — build the
  experience independently.
- Check the license before copying external code; GPL/BSL code is not merged.

## License

MIT — see `LICENSE`. By contributing you agree your changes are licensed
under the same terms.
