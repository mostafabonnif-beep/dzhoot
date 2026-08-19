#!/usr/bin/env node
/**
 * setup-demo-sources.mjs
 * ------------------------------------------------
 * Re-imports the demo IPTV sources through the DZ HOOF admin API so a fresh
 * environment (new sandbox, another MoClaw account, or the VPS) can restore
 * the same channels without re-doing the work manually.
 *
 * NO SECRETS ARE HARD-CODED. Credentials come from environment variables
 * (or a .env loaded by dotenv). Never commit real credentials.
 *
 * Usage:
 *   export DZHOOF_API_URL=http://localhost:8009
 *   export ADMIN_USERNAME=admin
 *   export ADMIN_PASSWORD=...
 *   # Xtream source (optional):
 *   export Upstream_XTREAM_NAME="Primary Upstream"
 *   export Upstream_XTREAM_URL=https://cf.upstream-host-redacted
 *   export Upstream_XTREAM_USERNAME=...
 *   export Upstream_XTREAM_PASSWORD=...
 *   # M3U source (optional):
 *   export IPTV_ORG_M3U_NAME="iptv-org (free legal)"
 *   export IPTV_ORG_M3U_URL=https://iptv-org.github.io/iptv/countries/dz.m3u
 *   node scripts/setup-demo-sources.mjs
 */

// dotenv is optional — the script also works with plain exported env vars.
try {
  const { config: loadDotenv } = await import('dotenv');
  loadDotenv({ path: new URL('../.env', import.meta.url).pathname });
} catch { /* dotenv not installed — rely on exported environment */ }

const API = process.env.DZHOOF_API_URL || 'http://localhost:8009';

async function api(path, { method = 'GET', body, sessionId } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json || {}).slice(0, 200)}`);
  }
  return json;
}

async function main() {
  const { ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD are required');
  }

  console.log(`[setup] Logging in to ${API} ...`);
  const { sessionId } = await api('/api/v1/auth/login', {
    method: 'POST',
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  console.log('[setup] Login OK.');

  // ---- Xtream source (catalog import; playback verification happens on the VPS) ----
  if (process.env.Upstream_XTREAM_URL) {
    if (!process.env.Upstream_XTREAM_USERNAME || !process.env.Upstream_XTREAM_PASSWORD) {
      throw new Error('Upstream_XTREAM_USERNAME and Upstream_XTREAM_PASSWORD are required when Upstream_XTREAM_URL is set');
    }
    console.log('[setup] Creating Xtream source:', process.env.Upstream_XTREAM_NAME || 'Primary Upstream');
    const { data: source } = await api('/api/v1/admin/xtream-sources', {
      method: 'POST',
      sessionId,
      body: {
        name: process.env.Upstream_XTREAM_NAME || 'Primary Upstream',
        serverUrl: process.env.Upstream_XTREAM_URL,
        username: process.env.Upstream_XTREAM_USERNAME,
        password: process.env.Upstream_XTREAM_PASSWORD,
      },
    });
    console.log(`[setup] Xtream source created: ${source._id}`);
    const { data: started } = await api(`/api/v1/admin/xtream-sources/${source._id}/import-catalog`, {
      method: 'POST',
      sessionId,
    });
    console.log(`[setup] Catalog import started (syncing=${started.syncing}).`);
    console.log('        Note: live channels appear progressively; episodes sync runs in the background.');
  } else {
    console.log('[setup] Skipping Xtream source (Upstream_XTREAM_URL not set).');
  }

  // ---- M3U source (test + sync; these channels are playable from most servers) ----
  if (process.env.IPTV_ORG_M3U_URL) {
    console.log('[setup] Creating M3U source:', process.env.IPTV_ORG_M3U_NAME || 'iptv-org');
    const { data: m3uSource } = await api('/api/v1/admin/m3u-sources', {
      method: 'POST',
      sessionId,
      body: {
        name: process.env.IPTV_ORG_M3U_NAME || 'iptv-org (free legal)',
        playlistUrl: process.env.IPTV_ORG_M3U_URL,
      },
    });
    console.log(`[setup] M3U source created: ${m3uSource._id}`);
    const test = await api(`/api/v1/admin/m3u-sources/${m3uSource._id}/test`, {
      method: 'POST',
      sessionId,
    });
    console.log(`[setup] Source test: ok=${test.success} channels=${test.data?.channelCount} playable=${test.data?.playableSampleCount}`);
    if (test.success) {
      const sync = await api(`/api/v1/admin/m3u-sources/${m3uSource._id}/sync`, { method: 'POST', sessionId });
      console.log(`[setup] Sync started (syncing=${sync.data?.syncing}).`);
    } else {
      console.warn('[setup] Source test did not pass — sync skipped. Check the URL from this server.');
    }
  } else {
    console.log('[setup] Skipping M3U source (IPTV_ORG_M3U_URL not set).');
  }

  console.log('\n[setup] Done. Verify in the admin dashboard: Channels / Sources pages.');
}

main().catch((err) => {
  console.error('\n[setup] FAILED:', err.message);
  process.exit(1);
});
