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

## V4 same-environment matrix

```bash
DZ_FORENSIC_PRIVATE_DIR=/secure/private/path \\
  node scripts/stream-diagnostics/v4-matrix.js --m3u /secure/source.m3u
```

The V4.1 runner selects the first stream URL from a local M3U snapshot and tests it with two independent curl profiles, FFprobe, and headless VLC on the same execution host. `curl_native` uses curl defaults without VLC impersonation; `curl_vlc_profile` preserves the previous VLC-compatible User-Agent profile. Headers, raw logs, and FFprobe output remain in a mode-0700 private directory; the JSON summary redacts provider credentials and signed redirect parameters. FFprobe reports `valid_media`, `html_response`, `connection_failure`, `connection_timeout`, or `invalid_media`. VLC reports whether media was detected, the process only started, playback failed, or the process timed out. PulseAudio initialization errors are not treated as stream success, and media success requires actual detected media rather than HTTP 200 alone.

Run this on the actual production VPS to establish the V4 Case A–D decision. A run inside a development sandbox proves only the result for that sandbox's network identity.
