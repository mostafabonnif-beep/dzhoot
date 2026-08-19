# Xtream upstream re-check — 2026-08-16

The customer application now reaches the DZ HOOF backend successfully. The catalog endpoint returns only three IPTV-org test channels because the registered Xtream source remains inactive/degraded.

A fresh direct check against the supplied Xtream host produced:

| Endpoint | HTTP | Bytes | Result |
|---|---:|---:|---|
| `player_api.php` | 200 | 511 | Authentication succeeds; user is Active and auth=1 |
| `get.php?...type=m3u_plus&output=ts` | 884 | 0 | No playlist bytes are delivered |
| `/live/{user}/{pass}/1.m3u8` | 456 | 0 | No HLS bytes are delivered |
| `/live/{user}/{pass}/1.ts` | 456 | 0 | No TS bytes are delivered |

Conclusion: the credentials and account authentication work, but the provider does not deliver media bytes to the server-side requests. The application correctly keeps this source hidden from customers because showing 16,609 metadata-only channels would produce channels that cannot play.
