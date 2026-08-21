#!/usr/bin/env bash
# Stage a DZ HOOF release on the production server from a GitHub commit.
#
# Downloads the repository tarball at a pinned SHA, verifies it, and extracts
# it to /opt/dzhoot-releases/<full-sha>/server ready for an atomic deploy.
# This script NEVER touches the active stack (/opt/dzhoot) or running
# containers — it only prepares a release directory. Deploying is a separate,
# explicit step (scripts/deploy/atomic-deploy.sh).
#
# Usage:
#   ./scripts/deploy/stage-release.sh [<sha-or-ref>]   # default: main
#   RELEASES_ROOT=/opt/dzhoot-releases ./scripts/deploy/stage-release.sh e8403b3
#
# Prints "STAGED <full-sha>" on success (last line) for CI consumption.
set -Eeuo pipefail

SHA_OR_REF="${1:-main}"
REPO="${DZHOOF_REPO:-mostafabonnif-beep/dzhoot}"
RELEASES_ROOT="${RELEASES_ROOT:-/opt/dzhoot-releases}"
TARBALL_URL="https://github.com/${REPO}/archive/${SHA_OR_REF}.tar.gz"
API_URL="https://api.github.com/repos/${REPO}/commits/${SHA_OR_REF}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say() { printf '[stage-release] %s\n' "$*"; }
die() { printf '[stage-release][ABORT] %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null || die "curl is required"
command -v python3 >/dev/null || die "python3 is required (for SHA resolution)"
[ "$(id -u)" -eq 0 ] || die "run as root (release dirs are owned by root)"

say "resolving $SHA_OR_REF in $REPO ..."
FULL_SHA="$(curl -fsS --max-time 20 -H "Accept: application/vnd.github+json" \
  "$API_URL" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("sha",""))' 2>/dev/null || true)"
case "$FULL_SHA" in
  ""|*[!0-9a-f]*) die "could not resolve '$SHA_OR_REF' to a full commit SHA (API response missing 'sha')" ;;
esac
[ "${#FULL_SHA}" -eq 40 ] || die "resolved value is not a 40-character SHA (got: $FULL_SHA)"

DEST="$RELEASES_ROOT/$FULL_SHA"
if [ -f "$DEST/.staged-ok" ]; then
  say "release $FULL_SHA already staged at $DEST"
  echo "STAGED $FULL_SHA"
  exit 0
fi

say "downloading $TARBALL_URL"
curl -fsSL --max-time 300 "$TARBALL_URL" -o "$TMP/release.tar.gz" || die "tarball download failed"
[ -s "$TMP/release.tar.gz" ] || die "downloaded tarball is empty"
tar -tzf "$TMP/release.tar.gz" >/dev/null 2>&1 || die "downloaded file is not a valid tarball"

TARBALL_SHA256="$(sha256sum "$TMP/release.tar.gz" | awk '{print $1}')"
say "tarball sha256: $TARBALL_SHA256"

# Extract only server/ from the tarball. GNU tar wildcards avoid listing the
# whole archive; `head` on a tar listing would SIGPIPE tar and trip pipefail.
mkdir -p "$TMP/extract"
tar -xzf "$TMP/release.tar.gz" -C "$TMP/extract" --strip-components=1 --wildcards 'dzhoot-*/server' 2>/dev/null   || die "tarball does not contain server/ (wrong repo or SHA?)"
SRC_DIR="$TMP/extract/server"
[ -d "$SRC_DIR" ] || die "tarball does not contain server/ (wrong repo or SHA?)"

# Verify the release contains everything the deploy depends on.
for f in docker-compose.production.yml Caddyfile scripts/deploy/deploy-production.sh scripts/deploy/preflight.sh; do
  [ -f "$SRC_DIR/$f" ] || die "release missing required file: $f"
done
grep -q '^DOMAIN=' /etc/dzhoot/.env.production 2>/dev/null \
  || say "WARNING: /etc/dzhoot/.env.production has no DOMAIN — public health check will fail at deploy"

install -d -m 700 -o root -g root "$RELEASES_ROOT"
rm -rf "$DEST"
install -d -m 755 -o root -g root "$DEST"
mv "$SRC_DIR" "$DEST/server"
chmod -R u+w "$DEST/server"

cat > "$DEST/.staged-ok" <<EOF
sha=$FULL_SHA
ref=$SHA_OR_REF
fetched_at=$(date -u +%FT%TZ)
source=$TARBALL_URL
tarball_sha256=$TARBALL_SHA256
EOF
chmod 600 "$DEST/.staged-ok"

say "release staged at $DEST"
say "next step: scripts/deploy/atomic-deploy.sh $FULL_SHA   (dry-run: APPLY=0, apply: APPLY=1)"
echo "STAGED $FULL_SHA"
