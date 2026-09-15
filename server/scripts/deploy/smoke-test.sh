#!/usr/bin/env bash
# Post-deploy smoke test for the DZ HOOF production stack.
#
# Runs the checks the operations brief (§3) lists after a deploy, plus the
# update-metadata invariants that the 2026-09-15 incident broke:
#
#   /health          /health/live      /health/ready    /health/version
#   /api/v1/app/version  (update contract: a checksum must come with an offered update)
#   /                (public portal)   /admin           (admin shell)
#   static chunks    (same build as the HTML that references them)
#
# Every check is read-only. Exit 0 only when all of them pass, so a caller
# (atomic-deploy.sh) can treat a non-zero exit as a reason to roll back.
#
# Usage:
#   scripts/deploy/smoke-test.sh --domain iptv.example.net \
#     [--commit <sha>] [--image-id sha256:...] [--base-url https://host] [--json]
#
# Environment equivalents:
#   DZHOOF_DOMAIN, EXPECTED_COMMIT, EXPECTED_IMAGE_ID, SMOKE_BASE_URL
#
# Exit: 0 all checks passed, 1 a check failed, 2 usage error.
set -Eeuo pipefail

DOMAIN="${DZHOOF_DOMAIN:-}"
BASE_URL="${SMOKE_BASE_URL:-}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-}"
EXPECTED_IMAGE_ID="${EXPECTED_IMAGE_ID:-}"
OUTPUT_JSON=0
# Version code 1 = oldest possible client, so the update endpoint is asked for the
# newest published release rather than answering "you are up to date".
PROBE_VERSION_CODE="${SMOKE_PROBE_VERSION_CODE:-1}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --base-url) BASE_URL="${2:?--base-url needs a value}"; shift 2 ;;
    --commit) EXPECTED_COMMIT="${2:?--commit needs a value}"; shift 2 ;;
    --image-id) EXPECTED_IMAGE_ID="${2:?--image-id needs a value}"; shift 2 ;;
    --json) OUTPUT_JSON=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) printf '[smoke][ABORT] unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

if [ -z "$BASE_URL" ]; then
  [ -n "$DOMAIN" ] || { printf '[smoke][ABORT] --domain or --base-url is required\n' >&2; exit 2; }
  BASE_URL="https://${DOMAIN}"
fi

command -v curl >/dev/null || { printf '[smoke][ABORT] curl is required\n' >&2; exit 2; }
command -v python3 >/dev/null || { printf '[smoke][ABORT] python3 is required\n' >&2; exit 2; }

SMOKE_BASE_URL="$BASE_URL" \
EXPECTED_COMMIT="$EXPECTED_COMMIT" \
EXPECTED_IMAGE_ID="$EXPECTED_IMAGE_ID" \
PROBE_VERSION_CODE="$PROBE_VERSION_CODE" \
OUTPUT_JSON="$OUTPUT_JSON" \
python3 <<'PY'
import json
import os
import re
import sys
import urllib.error
import urllib.request

BASE = os.environ["SMOKE_BASE_URL"].rstrip("/")
EXPECTED_COMMIT = os.environ.get("EXPECTED_COMMIT", "").strip()
EXPECTED_IMAGE_ID = os.environ.get("EXPECTED_IMAGE_ID", "").strip()
PROBE = os.environ.get("PROBE_VERSION_CODE", "1")
AS_JSON = os.environ.get("OUTPUT_JSON") == "1"
TIMEOUT = float(os.environ.get("SMOKE_TIMEOUT_SECONDS", "20"))

results = []


def log(line):
    print(line, flush=True)


def fetch(path, *, accept="application/json", max_bytes=2_000_000):
    """Returns (status, headers, body_text). HTTP errors are results, not exceptions."""
    url = f"{BASE}{path}"
    request = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "dzhoof-smoke/1"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            body = response.read(max_bytes).decode("utf-8", "replace")
            return response.status, dict(response.headers), body
    except urllib.error.HTTPError as error:
        body = error.read(max_bytes).decode("utf-8", "replace")
        return error.code, dict(error.headers or {}), body
    except Exception as error:  # noqa: BLE001 - any transport failure is a failed check
        return None, {}, f"{type(error).__name__}: {error}"


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    if not AS_JSON:
        log(f"{'PASS' if ok else 'FAIL'}  {name}{(' — ' + detail) if detail else ''}")
    return ok


def as_json(body):
    try:
        return json.loads(body)
    except Exception:  # noqa: BLE001
        return None


SHA256_RE = re.compile(r"^[a-f0-9]{64}$")

# --- 1. /health ------------------------------------------------------------
status, _, body = fetch("/health")
payload = as_json(body) or {}
check(
    "/health returns 200 with status ok",
    status == 200 and payload.get("status") == "ok",
    f"HTTP {status} status={payload.get('status')!r}",
)
if EXPECTED_COMMIT:
    served = (payload.get("release") or {}).get("commit")
    check(
        "/health reports the deployed commit",
        served == EXPECTED_COMMIT,
        f"expected {EXPECTED_COMMIT} got {served!r}",
    )

# --- 2. /health/live ------------------------------------------------------
status, _, body = fetch("/health/live")
payload = as_json(body) or {}
check("/health/live returns 200", status == 200 and payload.get("status") == "ok", f"HTTP {status}")

# --- 3. /health/ready -----------------------------------------------------
status, _, body = fetch("/health/ready")
payload = as_json(body) or {}
check(
    "/health/ready returns 200 with mongodb and redis connected",
    status == 200 and payload.get("mongodb") == "connected" and payload.get("redis") == "connected",
    f"HTTP {status} mongodb={payload.get('mongodb')!r} redis={payload.get('redis')!r}",
)

# --- 4. /health/version ---------------------------------------------------
status, _, body = fetch("/health/version")
payload = as_json(body) or {}
check(
    "/health/version reports commit and build time",
    status == 200 and bool(payload.get("commit")) and bool(payload.get("builtAt")),
    f"HTTP {status} commit={payload.get('commit')!r} builtAt={payload.get('builtAt')!r}",
)
# `unknown` is what the compose default injects when no id was recorded; it is not an
# identity, and accepting it would let a rebuild of the same commit pass this check.
image_id = str(payload.get("imageId") or "")
check(
    "/health/version reports an image identity",
    status == 200 and image_id not in ("", "unknown", "None"),
    f"imageId={payload.get('imageId')!r} imageDigest={payload.get('imageDigest')!r}",
)
if EXPECTED_IMAGE_ID:
    check(
        "/health/version reports the built image id",
        payload.get("imageId") == EXPECTED_IMAGE_ID,
        f"expected {EXPECTED_IMAGE_ID} got {payload.get('imageId')!r}",
    )

# --- 5. update endpoint contract -----------------------------------------
status, _, body = fetch(f"/api/v1/app/version?currentVersionCode={PROBE}")
payload = as_json(body) or {}
latest = payload.get("latestVersion") or {}
check(
    "update endpoint returns 200",
    status == 200 and payload.get("success") is True,
    f"HTTP {status} success={payload.get('success')!r}",
)
if payload.get("updateAvailable") is True:
    sha = latest.get("sha256")
    check(
        "an offered update carries a 64-hex checksum",
        isinstance(sha, str) and bool(SHA256_RE.match(sha)),
        f"sha256={sha!r}",
    )
    check(
        "an offered update carries a download URL and a positive size",
        isinstance(latest.get("downloadUrl"), str)
        and latest["downloadUrl"].startswith("https://")
        and isinstance(latest.get("sizeBytes"), int)
        and latest["sizeBytes"] > 0,
        f"url={latest.get('downloadUrl')!r} sizeBytes={latest.get('sizeBytes')!r}",
    )
    check(
        "an offered update carries a version name and code",
        bool(latest.get("versionName")) and isinstance(latest.get("versionCode"), int) and latest["versionCode"] > 0,
        f"versionName={latest.get('versionName')!r} versionCode={latest.get('versionCode')!r}",
    )
else:
    # Not fatal — the deployment may legitimately have nothing newer to offer — but
    # it must never be because an update exists and was withheld for a bad checksum.
    reason = payload.get("updateBlockedReason")
    check(
        "no update is offered for a bad reason",
        status == 200 and reason != "CHECKSUM_UNAVAILABLE",
        f"HTTP {status} updateAvailable={payload.get('updateAvailable')!r} blockedReason={reason!r}",
    )

# --- 6/7/8. public page, admin shell, same build --------------------------
status_home, headers_home, home = fetch("/", accept="text/html")
check(
    "public page returns 200 HTML",
    status_home == 200 and "text/html" in (headers_home.get("Content-Type") or ""),
    f"HTTP {status_home} content-type={headers_home.get('Content-Type')!r}",
)

status_admin, headers_admin, admin = fetch("/admin", accept="text/html")
check(
    "admin shell answers with HTML (200, or a redirect to the login flow)",
    status_admin in (200, 301, 302, 303, 307, 308) and "text/html" in (headers_admin.get("Content-Type") or ""),
    f"HTTP {status_admin} content-type={headers_admin.get('Content-Type')!r}",
)

BUILD_ID_RE = re.compile(r'"buildId"\s*:\s*"([^"]+)"')
home_build = BUILD_ID_RE.search(home)
admin_build = BUILD_ID_RE.search(admin)

CHUNK_RE = re.compile(r'/_next/static/[A-Za-z0-9._/-]+\.js')
home_chunks = sorted(set(CHUNK_RE.findall(home)))
admin_chunks = sorted(set(CHUNK_RE.findall(admin)))
shared_chunks = sorted(set(home_chunks) & set(admin_chunks))

if home_build and admin_build:
    check(
        "the public page and the admin shell come from the same build",
        home_build.group(1) == admin_build.group(1),
        f"home={home_build.group(1)} admin={admin_build.group(1)}",
    )
else:
    # Next.js 16 does not emit buildId in the App Router HTML, so the build identity
    # is read from the content-hashed chunk names instead: two pages served from the
    # same build share the framework/runtime chunks, and every chunk an HTML file
    # names must still exist. HTML from one release pointing at chunks from another
    # is the mixed-release failure this check exists to catch.
    check(
        "the public page and the admin shell reference shared content-hashed chunks",
        len(shared_chunks) > 0,
        f"shared={len(shared_chunks)} home={len(home_chunks)} admin={len(admin_chunks)}",
    )

sampled = sorted(set(home_chunks[:4] + admin_chunks[:4]))
missing = []
not_immutable = []
for chunk_path in sampled:
    status_chunk, headers_chunk, _ = fetch(chunk_path, accept="application/javascript")
    if status_chunk != 200:
        missing.append(f"{chunk_path} -> HTTP {status_chunk}")
    elif "immutable" not in (headers_chunk.get("Cache-Control") or ""):
        not_immutable.append(f"{chunk_path} -> {headers_chunk.get('Cache-Control')!r}")
# Each check asserts its own input as well as its verdict: an empty sample or a failed
# fetch must never read as a pass.
check(
    "every sampled chunk named by the served HTML is fetchable",
    bool(sampled) and not missing,
    "; ".join(missing) if missing else (f"{len(sampled)} chunk(s) checked" if sampled else "no chunk reference found in the HTML"),
)
check(
    "static chunks are served immutable (content-hashed)",
    bool(sampled) and not not_immutable,
    "; ".join(not_immutable) if not_immutable else ("" if sampled else "no chunk reference found in the HTML"),
)

html_cache = headers_home.get("Cache-Control") or headers_admin.get("Cache-Control") or ""
check(
    "app HTML is not cached for a year",
    bool(html_cache) and "31536000" not in html_cache,
    f"cache-control={html_cache!r}",
)

# --- summary --------------------------------------------------------------
failed = [entry for entry in results if not entry["ok"]]
if AS_JSON:
    log(json.dumps({"base": BASE, "checks": results, "failed": len(failed)}, ensure_ascii=False))
else:
    log("")
    log(f"smoke: {len(results) - len(failed)}/{len(results)} checks passed against {BASE}")

sys.exit(1 if failed else 0)
PY
