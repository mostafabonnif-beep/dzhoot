#!/usr/bin/env python3
"""
Playback sample through the app's own path.

Written for the acceptance criterion of issue #360: "measure the success ratio of a 10-channel
sample through the app path (it was 6/10)". The earlier measurement was done by hand with a real
device code; this makes it repeatable before and after a deploy.

What it does, per sampled channel:

  1. mints a playback token exactly like the app does (`POST /api/v1/tv/playback-token`, slot 0);
  2. opens the *relay* URL the app plays (`playbackUrl`) and counts how many bytes actually
     arrive within the window;
  3. when the source advertises a direct provider URL, samples that too — that is what separates
     "the provider is broken" from "our relay is broken", which is the whole point of #360;
  4. classifies the result: `ok`, `empty_200` (a valid-looking 200 that sends nothing — the black
     screen), `http_error` (the relay now answers 502 for a stalled upstream, see #351),
     `timeout`, or `blocked_by_stream_limit`.

It never writes anything to the platform: tokens are short-lived and only bytes are read.

Usage (needs the channel-list code of an ACTIVE test device; it is a credential, so it comes from
the environment and never from this file):

    DZHOOF_TV_CODE=<code> python3 scripts/qa/playback-sample.py
    DZHOOF_TV_CODE=<code> python3 scripts/qa/playback-sample.py --sample 10 --seed 7
    DZHOOF_TV_CODE=<code> python3 scripts/qa/playback-sample.py --json /tmp/sample.json

Options:
    --sample N     how many channels to sample (default 10)
    --seed N       fixes the random selection so a before/after comparison uses the same channels
    --strategy S   `random` (default, seeded), `spread` (evenly across the catalog, deterministic)
                   or `first`
    --bytes N      how many bytes count as "it streams" (default 4096)
    --timeout S    per-request timeout in seconds (default 20)
    --fail-under R exit non-zero when the success ratio is below R (e.g. 0.8); off by default
"""

import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("DZHOOF_BASE_URL", "https://iptv.ld-11.net").rstrip("/")
CODE = os.environ.get("DZHOOF_TV_CODE", "").strip()


def die(message):
    sys.stderr.write(message.rstrip() + "\n")
    raise SystemExit(2)


def call(path, method="GET", body=None, timeout=60):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("X-TV-Code", CODE)
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode() or "{}")
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read().decode() or "{}")
        except Exception:
            return error.code, {}
    except Exception as error:  # noqa: BLE001 - reported verbatim to the operator
        return 0, {"_err": str(error)}


def stream_format(url):
    """The container the channel's own URL uses — the axis this incident turned on."""
    if not url:
        return "none"
    path = url.split("?", 1)[0].split("#", 1)[0].lower()
    if path.endswith(".m3u8"):
        return "m3u8"
    if path.endswith(".ts"):
        return "ts"
    if path.endswith(".mp4"):
        return "mp4"
    return "other"


def sample_channels(channels, size, seed, strategy):
    if strategy == "first":
        return channels[:size]
    if strategy == "spread":
        if size >= len(channels):
            return list(channels)
        step = len(channels) / float(size)
        return [channels[int(index * step)] for index in range(size)]
    rng = random.Random(seed)
    return rng.sample(channels, min(size, len(channels)))


def read_bytes(url, limit, timeout):
    """
    Open `url` and read up to `limit` bytes.

    Returns (status, bytes_read, sniff, error). A 200 that never produces a byte is the failure
    mode this tool exists for, so "no bytes" is its own outcome rather than an exception.
    """
    request = urllib.request.Request(url, headers={"Accept": "*/*", "Connection": "close"})
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.status
            received = response.read(limit)
            elapsed = time.time() - started
            return status, len(received), received[:16], None, elapsed
    except urllib.error.HTTPError as error:
        return error.code, 0, b"", "HTTP %s" % error.code, time.time() - started
    except Exception as error:  # noqa: BLE001 - timeouts and resets are expected data here
        return 0, 0, b"", str(error), time.time() - started


def sniff(data):
    if not data:
        return ""
    if data.startswith(b"#EXTM3U"):
        return "hls-manifest"
    if data[0] == 0x47:
        return "mpeg-ts"
    return "?"


def classify(status, received, error):
    if received > 0:
        return "ok"
    if error and "HTTP" not in str(error) and status == 0:
        return "timeout" if "timed out" in str(error).lower() else "error"
    if status == 200:
        return "empty_200"
    if status == 429:
        return "blocked_by_stream_limit"
    if status:
        return "http_error"
    return "error"


def main():
    parser = argparse.ArgumentParser(description="Sample live channels through the app path.")
    parser.add_argument("--sample", type=int, default=10)
    parser.add_argument("--seed", type=int, default=20260921)
    parser.add_argument("--strategy", choices=["random", "spread", "first"], default="random")
    parser.add_argument("--bytes", type=int, default=4096)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--fail-under", type=float, default=None)
    parser.add_argument("--json", dest="json_path", default=None)
    args = parser.parse_args()

    status, payload = call("/api/v1/channels")
    if status != 200:
        die("GET /api/v1/channels failed: HTTP %s %s" % (status, str(payload)[:200]))
    channels = payload.get("data") or []
    if not channels:
        die("No channels returned for this code.")

    picked = sample_channels(channels, args.sample, args.seed, args.strategy)
    print("Sampling %d of %d channels (%s, seed=%d) against %s" % (
        len(picked), len(channels), args.strategy, args.seed, BASE))
    print("-" * 100)

    rows = []
    for index, channel in enumerate(picked, start=1):
        channel_id = channel.get("channelId")
        name = (channel.get("channelName") or "")[:28]
        upstream = channel.get("channelUrl") or ""
        fmt = stream_format(upstream)

        token_status, token_payload = call(
            "/api/v1/tv/playback-token", "POST", {"channelId": channel_id, "slot": 0}, timeout=args.timeout + 10)
        data = token_payload.get("data") or {}
        relay_url = data.get("playbackUrl")
        direct_url = data.get("directUrl") or data.get("directHlsUrl")

        row = {
            "channelId": channel_id,
            "channelName": channel.get("channelName"),
            "group": channel.get("channelGroup"),
            "upstreamFormat": fmt,
            "tokenStatus": token_status,
            "relay": None,
            "direct": None,
            "result": "token_failed",
        }

        if token_status == 200 and relay_url:
            relay_status, received, head, error, elapsed = read_bytes(relay_url, args.bytes, args.timeout)
            row["relay"] = {
                "status": relay_status,
                "bytes": received,
                "sniff": sniff(head),
                "elapsedSec": round(elapsed, 2),
                "error": error,
            }
            row["result"] = classify(relay_status, received, error)
        else:
            row["tokenError"] = token_payload.get("code") or token_payload.get("error")
            if token_status == 429:
                row["result"] = "blocked_by_stream_limit"

        if direct_url:
            direct_status, received, head, error, elapsed = read_bytes(direct_url, args.bytes, args.timeout)
            row["direct"] = {
                "status": direct_status,
                "bytes": received,
                "sniff": sniff(head),
                "elapsedSec": round(elapsed, 2),
                "error": error,
            }

        rows.append(row)
        print("%2d. %-28s %-5s relay=%-14s bytes=%-6s direct=%s" % (
            index, name, fmt, row["result"],
            (row.get("relay") or {}).get("bytes", "-"),
            row["direct"]["bytes"] if row["direct"] else "-"))

    played = [row for row in rows if row["result"] == "ok"]
    blocked = [row for row in rows if row["result"] == "blocked_by_stream_limit"]
    counted = len(rows) - len(blocked)
    ratio = (len(played) / float(counted)) if counted else 0.0

    print("-" * 100)
    by_format = {}
    for row in rows:
        bucket = by_format.setdefault(row["upstreamFormat"], {"total": 0, "ok": 0})
        bucket["total"] += 1
        if row["result"] == "ok":
            bucket["ok"] += 1
    print("Played %d/%d through the app path (%.0f%%)" % (len(played), counted, ratio * 100))
    if blocked:
        print("  %d channel(s) skipped: subscription stream limit (not a stream failure)" % len(blocked))
    for fmt, bucket in sorted(by_format.items()):
        print("  format %-5s: %d/%d" % (fmt, bucket["ok"], bucket["total"]))

    failures = [row for row in rows if row["result"] not in ("ok", "blocked_by_stream_limit")]
    if failures:
        print("\nFailures (report these to the provider with the channel id):")
        for row in failures:
            print("  %-10s %-28s %-12s %s" % (
                row["channelId"], (row["channelName"] or "")[:28], row["result"],
                (row["relay"] or {}).get("error") or row.get("tokenError") or ""))

    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as handle:
            json.dump({"base": BASE, "sampledAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                       "ratio": ratio, "rows": rows}, handle, ensure_ascii=False, indent=2)
        print("\nWrote %s" % args.json_path)

    if args.fail_under is not None and ratio < args.fail_under:
        print("FAIL: ratio %.2f is below --fail-under %.2f" % (ratio, args.fail_under))
        return 1
    return 0


if __name__ == "__main__":
    if not CODE:
        die(
            "DZHOOF_TV_CODE is not set.\n"
            "The channel-list code is a bearer credential for the managed API: it can read the\n"
            "catalog, pull EPG and mint playback tokens. Pass it through the environment and never\n"
            "commit it:\n"
            "    DZHOOF_TV_CODE=<code from an ACTIVE test device> python3 scripts/qa/playback-sample.py"
        )
    raise SystemExit(main())
