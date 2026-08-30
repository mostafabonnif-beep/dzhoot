#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ERRORS=0
fail(){ echo "FAIL: $1" >&2; ERRORS=$((ERRORS+1)); }
ok(){ echo "OK:   $1"; }

if grep -RIn --exclude-dir=node_modules --exclude-dir=build --exclude='*.md' --exclude-dir=__tests__ \
  -E "process\.env\.NODE_ENV === ['\"]production['\"][[:space:]]*\?[[:space:]]*['\"]['\"][[:space:]]*:[[:space:]]*['\"]DEMO['\"]" \
  "$ROOT/server/backend/src" >/tmp/dzhoof_demo_hits 2>/dev/null; then
  fail "implicit DEMO production fallback still present in backend source"
else
  ok "no implicit DEMO production fallback in backend source"
fi

if find "$ROOT" -type f \( -name '.env' -o -name '.env.production' \) -not -path '*/node_modules/*' -print0 | xargs -0 grep -nE '^[[:space:]]*ALLOW_DIRECT_PLAYBACK[[:space:]]*=[[:space:]]*true([[:space:]]*#.*)?$' 2>/dev/null | grep -q .; then
  fail "direct playback is explicitly enabled in a deployment environment file"
else
  ok "direct playback is not enabled by deployment environment files"
fi

if grep -q 'isMinifyEnabled = true' "$ROOT/android/app/build.gradle.kts"; then ok "Android release has R8 enabled"; else fail "Android release R8 is disabled"; fi
if grep -q 'isShrinkResources = true' "$ROOT/android/app/build.gradle.kts"; then ok "Android release resource shrinking enabled"; else fail "Android resource shrinking is disabled"; fi

for f in ".env" ".env.production" "local.properties"; do
  if find "$ROOT" -type f -name "$f" -not -path '*/.git/*' | grep -q .; then fail "secret/local file exists in source tree: $f"; fi
done
ok "no .env/.env.production/local.properties file bundled in source tree"

if [ -f "$ROOT/server/.env.production.example" ]; then ok "production environment template present"; else fail "server/.env.production.example missing"; fi
if [ -x "$ROOT/android/gradlew" ]; then ok "Android Gradle wrapper is executable"; else fail "android/gradlew is not executable"; fi

if [ "$ERRORS" -ne 0 ]; then echo "Release preflight: FAILED ($ERRORS issue(s))" >&2; exit 1; fi
echo "Release preflight: PASS (static checks only; live VPS/media/APK acceptance still required)"
