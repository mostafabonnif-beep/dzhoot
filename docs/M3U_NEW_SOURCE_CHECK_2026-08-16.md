# New M3U source check — 2026-08-16

## Scope

The supplied M3U file and its source endpoint were tested from the DZ HOOF server environment. Credentials are intentionally omitted from this report.

## Local file analysis

| Metric | Result |
|---|---:|
| File size | 399,783 bytes |
| EXTINF entries | 4,142 |
| Stream URLs | 4,142 |
| Host in file | `ibo.lynxiptv.com` |

The source endpoint successfully returned an M3U document. The `output=ts`, `output=hls`, and `output=m3u8` variants each returned an M3U document of approximately 943 KB with 4,142 URLs, but all variants pointed to the same `ibo.lynxiptv.com` host.

## Upstream checks

The account API responded with HTTP 200 and reported an Active user. The M3U endpoint also responded with HTTP 200 and returned content.

However, ten sample Live URLs from the supplied file all returned HTTP 403 with 4,546 bytes of HTML and `text/html` content. The first bytes were an HTML document rather than an HLS manifest or MPEG-TS payload. The response page identifies Cloudflare's `Attention Required` page. Changing between the provider's HTTP/HTTPS endpoint and ordinary User-Agent values did not produce video bytes. Substituting the playlist host with the account host returned HTTP 200 with zero bytes for the tested path, which is also not playable.

## Decision

The source is **not imported into the customer catalog**. It authenticates and exports metadata, but its Live URLs are blocked by Cloudflare at the delivery host from the DZ HOOF server environment. A proxy, FFmpeg relay, or MediaMTX cannot fix this because the upstream response is an access-denied HTML page rather than media bytes.

The provider must either whitelist the VPS IP at `ibo.lynxiptv.com`, provide a B2B/restream endpoint, provide a direct Live URL that works from the VPS, or remove the Cloudflare/data-center restriction. Once one sample returns a valid HLS manifest or TS bytes from the VPS, the existing DZ HOOF proxy pipeline can be used without changing the Android app.
