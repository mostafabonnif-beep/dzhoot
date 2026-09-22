# QA scripts

Both scripts need the channel-list code of an ACTIVE test device. That code is a **bearer
credential** — it can read the catalog, pull EPG and mint playback tokens — so it is read from the
environment and never written into a file:

```bash
export DZHOOF_TV_CODE=<code>          # required
export DZHOOF_BASE_URL=<url>          # optional, defaults to https://iptv.ld-11.net
```

`scripts/security/check-secrets.sh` fails closed on a device code committed as a literal, so this
is enforced, not just documented.

## contract-test.py
End-to-end contract check: simulates the Android TV app's API flow against a
live server (update check, channel sync, EPG, playback tokens for live + VOD
+ episodes, categories, reports) and validates every response against the
app's DTO field contracts.

```bash
DZHOOF_TV_CODE=<code> python3 scripts/qa/contract-test.py
```

Fails loudly on any field the app deserializes but the server does not send.
Run it before/after every release to catch app↔server contract drift.

## playback-sample.py
Measures what the customer would actually get: it mints playback tokens for a
sample of live channels and counts the bytes that arrive through the app's own
relay path, classifying each result (`ok`, `empty_200`, `http_error`, `timeout`,
`blocked_by_stream_limit`). When the source advertises a direct provider URL it
samples that too, which is what separates "the provider is broken" from "our
relay is broken".

It is the acceptance measurement for issue #360 (a 10-channel sample played
6/10 before the fix), so it is meant to be run before and after a deploy with
the same seed:

```bash
DZHOOF_TV_CODE=<code> python3 scripts/qa/playback-sample.py --sample 10 --seed 7 --json /tmp/after.json
```

Reads only: tokens are short-lived and nothing is written to the platform.
