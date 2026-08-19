# DZ HOOF T2 — Production Completion and Release Audit

**Date:** 2026-08-16  
**Repository:** `merci1994dz/dzhoot`  
**Target branch:** `main`

## Executive result

T2 repository-side work is substantially complete, but production deployment remains blocked by the absence of VPS credentials and a production content source that authorizes server-side relay. No deployment to a real VPS is claimed.

The current main branch is clean before the final T2 commit and includes the historical T1 commits as ancestors. PR #30 (`feature/t1-final-production`) remains open and is not merged, while the relevant T1 commits are already present in the current `main` history.

## T1 verification

The historical commits `b26dd61`, `1cdfb2f`, `57cec50`, and `632e4d0` are present and are ancestors of the current target branch. Secure playback, tokenized Android playback, production Docker configuration, activation/content access, and legacy raw-proxy gating remain represented in the current codebase.

The current relay architecture uses short-lived AES-GCM playback tokens, binds the token to the user and channel-list code, validates active subscription access, resolves upstream URLs server-side, and keeps provider credentials outside customer responses. HLS child playlists and URI attributes are rewritten through nested DZ HOOF playback tokens.

## T2 changes completed

The production startup guard now requires the actual production categories needed by the application: MongoDB, Redis, HTTPS public base URL, explicit HTTPS allowed origins, JWT secrets, playback token secret, Xtream encryption secret, TOTP encryption key, and administrator password. It rejects weak or placeholder secrets, invalid TOTP key format, localhost/example public URLs, and non-HTTPS CORS origins in production.

The relay now closes upstream manifest connections when the client aborts or disconnects, preventing abandoned sockets during HLS manifest loading. The prior raw-stream cleanup remains in place for MPEG-TS responses.

The M3U source gate remains active: a source is not publishable unless live HLS or MPEG-TS samples are playable from the Backend. This prevents a syntactically valid but blocked M3U list from exposing dead channels to customers.

## Validation results

| Area | Result |
|---|---:|
| Backend tests | 190/190 passing |
| Frontend tests | 5/5 passing |
| Android unit tests and Kotlin compilation | Passing |
| Android Debug APK | Built successfully |
| APK SHA-256 | `5006ec49973dc5c2ce56a39a377cf2cb1bee2fdcd70ba8f979a8c9c966e694a6` |
| Git history | T1 commits present |
| Credential scan | Supplied provider credentials not found in tracked code |
| Docker Compose validation | Blocked locally because Docker CLI is unavailable |
| Real VPS deployment | Blocked; no VPS credentials supplied |
| Permanent domain deployment | Blocked until VPS and DNS/reverse-proxy setup |
| Current Lynx Live playback | Blocked upstream by HTTP 403/Cloudflare |

## External blockers

The current environment has no Docker CLI, so `docker compose config`, image build, container startup, restart behavior, and health checks must be run on the target VPS or a machine with Docker installed. The repository contains production Compose, MongoDB authentication configuration, Redis, Caddy, health checks, and scheduler definitions, but they have not been represented as a completed VPS deployment.

The current Lynx source authenticates and exports an M3U list, but live URLs return Cloudflare HTTP 403 or no video bytes from the Backend server. The relay intentionally does not bypass this restriction. A provider whitelist, authorized B2B/restream endpoint, or another licensed source that returns valid HLS/TS bytes from the VPS is required.

## Release decision

The project is **repository-ready for VPS deployment preparation**, but not yet commercially release-ready. The remaining release gates are external: VPS access, domain/reverse proxy/TLS configuration, persistent MongoDB and Redis validation, backup/restore rehearsal, and a licensed playable source. Once those are supplied, the existing secure playback path can be validated end-to-end without exposing provider credentials to Android or Android TV.
