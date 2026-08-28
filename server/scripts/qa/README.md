# QA scripts

## contract-test.py
End-to-end contract check: simulates the Android TV app's API flow against a
live server (update check, channel sync, EPG, playback tokens for live + VOD
+ episodes, categories, reports) and validates every response against the
app's DTO field contracts.

Usage (from any machine with the TV code of an ACTIVE user):
```bash
python3 scripts/qa/contract-test.py
# edit BASE/CODE at the top, or run on the VPS
```
Fails loudly on any field the app deserializes but the server does not send.
Run it before/after every release to catch app↔server contract drift.
