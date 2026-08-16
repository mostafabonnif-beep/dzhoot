# DZ HOOF Forensic Stream Diagnostics

This tool compares ordinary server-side HTTP behavior for an M3U or live URL. It is diagnostic only: it does not bypass WAF, Cloudflare, CAPTCHA, IP restrictions, authentication, or provider authorization.

## Usage

```bash
node scripts/stream-diagnostics/forensic.js --url "$LIVE_URL" --profile matrix
node scripts/stream-diagnostics/forensic.js --m3u ./sample.m3u --profile vlc
```

The supported profiles are `native`, `browser`, `vlc`, and `matrix`. A matrix compares normal User-Agent/Accept behavior only; it does not spoof fingerprints or rotate access paths.

The output records DNS, resolved addresses, status, content type, content length, redirect chain, cookie presence, response time, TTFB, byte count, first bytes, and a short text preview. Query credentials, tokens, authorization values, and cookies are redacted. Response bodies are held only in memory while the tool follows a bounded HLS chain and are not serialized to output.

The tool can inspect an M3U playlist, select a stream URL, test a live response, follow up to three HLS child/segment URLs, and distinguish a working manifest from a segment failure. Use only sources and accounts for which the operator has authorization.
