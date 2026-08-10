# DZ HOOF — AI Development Rules

## Product

DZ HOOF is a legal IPTV player and channel-management platform. It manages only streams, playlists, EPG sources, and metadata that the operator is authorized to use. It does not provide or distribute unauthorized content.

## Read first

Before changing code, read:

1. `PROJECT_ROADMAP.md`
2. `server/PROJECT_STATUS.md`
3. The nearest `README.md`, `AGENTS.md`, or project documentation for the component being changed.

## Architecture

- `server/` contains the Backend API and Next.js Admin Dashboard.
- `android/` contains the Android and Android TV client.
- Android must communicate through the DZ HOOF API; it must not connect directly to MongoDB.
- IPTV credentials and server secrets stay server-side whenever the managed-source workflow is used.
- Do not add a new database, queue, framework, or large dependency without documenting the reason.

## Protected behavior

Preserve these working capabilities unless the user explicitly asks for a breaking change:

- M3U channel import and channel grouping.
- User authentication and Admin/User roles.
- PIN/QR device pairing.
- M3U/JSON playlist delivery.
- EPG synchronization.
- Media3/ExoPlayer playback.
- Favorites, search, and local caching.
- Stream health checks and rate limiting.

## Coding rules

- Read the existing implementation before editing it.
- Make small, focused changes.
- Do not rewrite unrelated modules.
- Do not hard-code credentials, tokens, passwords, provider URLs, or private API keys.
- Validate all external URLs server-side and retain SSRF protections.
- Use migrations for schema changes.
- Update API documentation for endpoint or payload changes.
- Add tests for new backend behavior and regression fixes.
- Treat Android and Android TV as separate UX targets even when code is shared.
- Use Arabic/RTL-ready strings and layouts for user-visible text.
- Do not copy branding, images, or UI resources from GENRAL-TV or another application. Use ideas and independently implement the experience.
- Check the license before copying or adapting external code. Record the source and license in the relevant documentation.

## Security

- Never commit `.env`, `local.properties`, keystores, Firebase private configuration, OAuth secrets, Sentry tokens, or exported playlists containing credentials.
- Production secrets must come from environment variables or the deployment secret store.
- Do not expose Xtream credentials in Android logs, URLs shown to users, screenshots, or API responses unless the endpoint explicitly requires a protected playback token.
- Keep authentication, authorization, rate limiting, CORS, security headers, and audit logging intact.

## Validation

Do not claim a feature is complete without testing it.

For server changes, run the relevant build, typecheck, lint, and tests. For Android changes, run the relevant Gradle tests and build when Android SDK/JDK are available. If a build cannot run, state the exact environmental blocker.

## GitHub workflow

- Keep `main` stable.
- Use `feature/<name>` for features and `fix/<name>` for fixes.
- Use clear Conventional Commit messages such as `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, and `build:`.
- Keep pull requests small and document behavior, tests, configuration changes, and external licenses.
- GitHub Releases should contain built APKs; do not commit build outputs to the repository.
