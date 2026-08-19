# DZ HOOF Secure IPTV Relay — Specification Audit

## Executive assessment

The attached relay specification is substantially represented in the existing DZ HOOF architecture. The backend already issues short-lived encrypted playback tokens, validates the subscribed user, hides upstream URLs from the Android client, resolves upstream URLs server-side, applies SSRF validation, proxies HLS and MPEG-TS streams, rewrites HLS child playlists and URI attributes through the DZ HOOF playback route, and disables the legacy arbitrary raw proxy by default.

The relay can only deliver content that the provider actually sends to the server. It does not and must not bypass Cloudflare, IP allowlists, DRM, geographic restrictions, concurrency limits, or any other provider access control.

## Current compliance matrix

| Requirement | Status | Implementation or limitation |
|---|---|---|
| Server-side credentials | Implemented | Xtream/M3U secrets are encrypted and not returned through customer APIs |
| Internal channel identity | Implemented | Customer APIs expose catalog channel references rather than provider credentials |
| Short-lived playback token | Implemented | AES-GCM token, random nonce, expiry, user and channel-list binding |
| Subscription enforcement | Implemented | Playback-token issuance and relay verify active subscription |
| No arbitrary public proxy | Implemented | Legacy raw proxy is disabled unless explicitly enabled by configuration |
| SSRF protection | Implemented | Protocol, DNS resolution, private/internal address checks and pinned lookup |
| HLS rewriting | Implemented | Master/media playlists and URI attributes are rewritten through nested DZ HOOF tokens |
| MPEG-TS streaming | Implemented | Streams are piped without buffering the full live stream |
| Client disconnect cleanup | Improved | Manifest and raw stream upstream connections are now destroyed on abort/close |
| Source health gate | Implemented | M3U sync requires playable HLS/TS samples; unplayable sources remain inactive |
| FFmpeg fallback | Not enabled by default | Correctly deferred until a valid upstream needs format conversion |
| Safe connection sharing | Not enabled | Must remain opt-in and provider-policy compliant |
| Current Lynx source | Blocked upstream | Account/M3U metadata works, but Live URLs return Cloudflare HTTP 403 from the server |

## Verification

Backend tests remain 190/190 passing after the relay cleanup change, and TypeScript compilation passes. The new M3U source was tested through the same Backend path: it returned a playlist with thousands of entries but zero playable samples, so it was marked Inactive and was not published to customers.

## Decision

No bypass mechanism is added. The correct next step for this source is a provider-side whitelist, a B2B/restream endpoint, or another authorized source that returns valid HLS or MPEG-TS bytes from the VPS. Once that condition is met, the existing relay path is ready to serve the source without exposing provider credentials to Android or Android TV.
