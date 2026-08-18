#!/usr/bin/env node
'use strict';

/**
 * DZ HOOF Source Validator
 * ------------------------------------------------------------------
 * One-command verdict on any Xtream/M3U source from the CURRENT IP.
 * Run it from the machine that will actually serve the stream
 * (home IP, VPS IP, mobile data) — the verdict is IP-specific.
 *
 * Tests:
 *   1. player_api.php  -> account validity, expiry, max_connections,
 *                         allowed output formats
 *   2. get.php playlist -> playlist endpoint reachable or blocked
 *   3. live manifest    -> real .m3u8 bytes for a real channel
 *   4. segment probe    -> actual media segment (HLS .ts) bytes
 *
 * Classifies the blocker as IP_BLOCKED / UA_BLOCKED / ACCOUNT_DEAD /
 * ACCOUNT_EXPIRED / FORMAT_ISSUE / READY so you know exactly what to fix.
 *
 * Diagnostic only. Never bypasses WAF, CAPTCHA, IP restrictions or auth.
 * Credentials are redacted in all output.
 *
 * Usage:
 *   node scripts/stream-diagnostics/source-validator.js \
 *     --server "http://tv.panel.com" \
 *     --username "abc" --password "xyz" \
 *     [--stream-id 12345] [--profile vlc|browser|native] [--json]
 */

const { performance } = require('perf_hooks');

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
const MAX_PREVIEW_BYTES = 300;
const PROFILES = {
  native: { 'User-Agent': 'DZ-HOOF-Diagnostic/1.0', Accept: '*/*', 'Accept-Encoding': 'identity' },
  browser: {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Encoding': 'identity',
    'Accept-Language': 'en-US,en;q=0.9',
  },
  vlc: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20', Accept: '*/*', 'Accept-Encoding': 'identity' },
};

function redact(value) {
  return String(value || '')
    .replace(/(username|user|password|pass|token|jwt|key|auth|signature|data|expires)=([^&\s]+)/gi, '$1=REDACTED')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1REDACTED');
}

function safeUrl(value) {
  try {
    const parsed = new URL(value);
    for (const key of ['username', 'password']) parsed.searchParams.set(key, 'REDACTED');
    for (const key of ['token', 'jwt', 'auth', 'signature', 'data', 'expires']) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, 'REDACTED');
    }
    parsed.username = '';
    parsed.password = '';
    parsed.pathname = parsed.pathname.replace(/(\/live\/)[^/]+\/[^/]+/i, '$1USER/REDACTED');
    return parsed.toString();
  } catch {
    return redact(value);
  }
}

function parseArgs(argv) {
  const args = { profile: 'vlc' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--server') args.server = value;
    else if (key === '--username') args.username = value;
    else if (key === '--password') args.password = value;
    else if (key === '--stream-id') args.streamId = value;
    else if (key === '--profile') args.profile = value;
    else if (key === '--json') args.json = true;
  }
  if (!args.server || !args.username || !args.password) {
    console.error('Usage: source-validator.js --server <panel-url> --username <u> --password <p> [--stream-id N] [--profile vlc|browser|native] [--json]');
    process.exit(2);
  }
  args.server = String(args.server).replace(/\/+$/, '');
  if (!PROFILES[args.profile]) args.profile = 'vlc';
  return args;
}

async function httpGet(url, profile, { timeoutMs = DEFAULT_TIMEOUT_MS, stream = false } = {}) {
  const started = performance.now();
  const headers = { ...PROFILES[profile] };
  const redirectChain = [];
  let current = url;
  let response;
  let firstByteMs = null;
  let body = Buffer.alloc(0);
  let error = null;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const fetchStarted = performance.now();
      response = await fetch(current, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
      firstByteMs = Math.round(performance.now() - fetchStarted);
      const location = response.headers.get('location');
      const contentType = response.headers.get('content-type') || '';
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        const next = new URL(location, current).toString();
        redirectChain.push({ from: safeUrl(current), to: safeUrl(next), status: response.status });
        current = next;
        continue;
      }
      if (!stream) {
        body = Buffer.from(await response.arrayBuffer());
      } else {
        // For live streams: read only the first chunk then abort (we only need the verdict).
        const reader = response.body.getReader();
        const chunk = await reader.read();
        body = chunk.value ? Buffer.from(chunk.value) : Buffer.alloc(0);
        await reader.cancel().catch(() => {});
      }
      break;
    } catch (err) {
      error = err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message;
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  const status = response ? response.status : null;
  const contentType = response ? response.headers.get('content-type') || '' : '';
  return {
    status,
    statusText: response ? response.statusText : '',
    contentType,
    contentLength: response ? response.headers.get('content-length') : null,
    bytes: body.length,
    firstByteMs,
    totalMs: Math.round(performance.now() - started),
    redirectChain,
    preview: body.slice(0, MAX_PREVIEW_BYTES).toString('utf8').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ').trim(),
    error,
    body,
  };
}

function isHtmlLike(contentType, preview) {
  return contentType.includes('text/html') || /^<!doctype|<html|<head|error occured|off-limits/i.test(preview);
}

function isM3uLike(contentType, preview) {
  return contentType.includes('mpegurl') || contentType.includes('m3u') || /^#EXTM3U/.test(preview);
}

function isMediaSegment(preview) {
  // TS segment: 0x47 sync byte pattern; or ffmpeg-muxed ftyp (mp4/fMP4 HLS).
  const buf = Buffer.from(preview);
  return (buf.length >= 4 && buf[0] === 0x47) || /^ftyp/.test(preview) || /^\x00\x00\x00\x18ftyp/.test(preview);
}

function classify(status, contentType, preview) {
  if (status === 401) return 'AUTH_OR_IP_BLOCKED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 456) return 'IP_OR_STREAM_BLOCKED'; // Xtream panels: off-limits IP
  if (status === 404) return 'NOT_FOUND';
  if (status === 410) return 'GONE';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  if (status === 200 && isHtmlLike(contentType, preview)) return 'HTML_NOT_MEDIA';
  if (status === 200 && isM3uLike(contentType, preview)) return 'OK_M3U';
  if (status === 200 && isMediaSegment(preview)) return 'OK_MEDIA';
  if (status === 200) return 'OK_UNKNOWN_BODY';
  return `HTTP_${status}`;
}

function formatExpiry(ts) {
  const sec = Number(ts);
  if (!Number.isFinite(sec) || sec <= 0) return 'unknown';
  const date = new Date(sec * 1000);
  const days = Math.ceil((sec * 1000 - Date.now()) / 86400000);
  return `${date.toISOString().slice(0, 10)} (${days > 0 ? `${days} days left` : days === 0 ? 'expires today' : `EXPIRED ${-days} days ago`})`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { server, username, password, profile } = args;
  const results = { server: safeUrl(server), profile, ip: null, tests: {}, verdict: null };

  // 0. Egress IP
  try {
    const ip = await httpGet('https://ipinfo.io/json', 'native', { timeoutMs: 8000 });
    if (ip.status === 200) {
      try { results.ip = JSON.parse(ip.preview.length < 500 ? ip.body.toString() : '{}').ip || null; } catch { results.ip = null; }
    }
  } catch { results.ip = null; }

  // 1. Account status
  const apiUrl = `${server}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const api = await httpGet(apiUrl, 'native');
  results.tests.account = {
    url: safeUrl(apiUrl),
    status: api.status,
    contentType: api.contentType,
    ms: api.totalMs,
  };
  let userInfo = null;
  let serverInfo = null;
  if (api.status === 200 && api.contentType.includes('json')) {
    try {
      const parsed = JSON.parse(api.body.toString());
      userInfo = parsed.user_info || null;
      serverInfo = parsed.server_info || null;
      results.tests.account.user = userInfo
        ? {
            auth: userInfo.auth,
            status: userInfo.status,
            message: userInfo.message,
            expires: formatExpiry(userInfo.exp_date),
            maxConnections: userInfo.max_connections,
            trial: userInfo.is_trial,
            allowedFormats: userInfo.allowed_output_formats,
          }
        : null;
      results.tests.account.server = serverInfo
        ? { url: serverInfo.url, port: serverInfo.port, httpsPort: serverInfo.https_port || null, protocol: serverInfo.server_protocol, timezone: serverInfo.timezone }
        : null;
    } catch { results.tests.account.parseError = 'invalid JSON'; }
  }

  const accountDead = !userInfo || userInfo.auth !== 1 || userInfo.status !== 'Active';
  const accountExpired = userInfo && Number(userInfo.exp_date) * 1000 < Date.now();

  // 2. Playlist endpoint
  const plUrl = `${server}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus&output=m3u8`;
  const pl = await httpGet(plUrl, profile);
  results.tests.playlist = {
    url: safeUrl(plUrl),
    status: pl.status,
    contentType: pl.contentType,
    bytes: pl.bytes,
    ms: pl.totalMs,
    classification: classify(pl.status, pl.contentType, pl.preview),
    preview: pl.preview.slice(0, 200),
  };

  // 3. Real live stream (manifest + segment)
  let streamId = args.streamId;
  let manifest = null;
  let segment = null;
  if (!accountDead) {
    if (!streamId) {
      const liveUrl = `${server}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`;
      const live = await httpGet(liveUrl, 'native');
      results.tests.liveList = { status: live.status, bytes: live.bytes, ms: live.totalMs };
      if (live.status === 200) {
        try {
          const streams = JSON.parse(live.body.toString());
          const candidate = (Array.isArray(streams) ? streams : []).find((s) => s.stream_id && String(s.is_adult) !== '1' && !/^#/.test(String(s.name || '')));
          if (candidate) streamId = String(candidate.stream_id);
          results.tests.liveList.count = Array.isArray(streams) ? streams.length : null;
        } catch { results.tests.liveList.parseError = 'invalid JSON'; }
      }
    }
    if (streamId) {
      const fmt = (userInfo && userInfo.allowed_output_formats && userInfo.allowed_output_formats.includes('m3u8')) ? 'm3u8' : 'ts';
      const mUrl = `${server}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${fmt}`;
      manifest = await httpGet(mUrl, profile, { stream: true, timeoutMs: 20000 });
      results.tests.manifest = {
        url: safeUrl(mUrl),
        status: manifest.status,
        contentType: manifest.contentType,
        bytes: manifest.bytes,
        ms: manifest.totalMs,
        classification: classify(manifest.status, manifest.contentType, manifest.preview),
        preview: manifest.preview.slice(0, 200),
      };
      // Segment probe from the manifest (first #EXTINF segment)
      const manifestText = manifest.preview; // may be truncated; use body if short enough
      const fullText = manifest.bytes <= 256 * 1024 ? manifest.body.toString() : manifest.preview;
      const segLine = fullText.split('\n').find((line) => line.trim() && !line.trim().startsWith('#'));
      if (segLine && (manifest.status === 200) && isM3uLike(manifest.contentType, manifest.preview)) {
        const segUrl = new URL(segLine.trim(), mUrl).toString();
        segment = await httpGet(segUrl, profile, { stream: true, timeoutMs: 20000 });
        results.tests.segment = {
          url: safeUrl(segUrl),
          status: segment.status,
          contentType: segment.contentType,
          bytes: segment.bytes,
          ms: segment.totalMs,
          classification: classify(segment.status, segment.contentType, segment.preview),
          isMediaBytes: isMediaSegment(segment.preview),
        };
      } else {
        results.tests.segment = { skipped: 'manifest not m3u-like or no segment line found' };
      }
    }
  }

  // 4. Verdict
  const v = results.tests;
  if (accountDead || accountExpired) {
    results.verdict = accountExpired ? 'ACCOUNT_EXPIRED' : 'ACCOUNT_DEAD';
  } else if (v.playlist.classification !== 'OK_M3U' && v.playlist.status === 401) {
    results.verdict = 'PLAYLIST_IP_BLOCKED';
  } else if (!v.manifest) {
    results.verdict = 'NO_STREAM_TESTED';
  } else if (v.manifest.classification === 'OK_M3U' && v.segment && v.segment.isMediaBytes) {
    results.verdict = 'READY';
  } else if (v.manifest.status === 456 || v.manifest.classification === 'IP_OR_STREAM_BLOCKED') {
    results.verdict = 'STREAM_IP_BLOCKED';
  } else if (v.manifest.classification === 'HTML_NOT_MEDIA') {
    results.verdict = 'STREAM_RETURNS_HTML';
  } else if (v.manifest.status === 403) {
    results.verdict = 'STREAM_FORBIDDEN';
  } else {
    results.verdict = 'STREAM_UNSTABLE';
  }

  if (args.json) {
    // Drop raw bodies, keep previews only (redaction discipline).
    for (const key of Object.keys(results.tests)) {
      if (results.tests[key] && results.tests[key].body) delete results.tests[key].body;
    }
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`\n=== DZ HOOF Source Validator ===`);
    console.log(`Server : ${safeUrl(server)}`);
    console.log(`Profile: ${profile} | Egress IP: ${results.ip || 'unknown'}`);
    console.log(`\n--- 1. Account ---`);
    console.log(`  ${JSON.stringify(results.tests.account.user || results.tests.account, null, 2).replace(/"username".*$/m, '')}`);
    console.log(`\n--- 2. Playlist (get.php m3u_plus) ---`);
    console.log(`  status=${v.playlist.status} type=${v.playlist.contentType} bytes=${v.playlist.bytes} ms=${v.playlist.ms}`);
    console.log(`  classification: ${v.playlist.classification}`);
    console.log(`\n--- 3. Live stream ---`);
    if (v.manifest) {
      console.log(`  streamId=${streamId}`);
      console.log(`  manifest: status=${v.manifest.status} type=${v.manifest.contentType} bytes=${v.manifest.bytes} ms=${v.manifest.ms}`);
      console.log(`  classification: ${v.manifest.classification}`);
      if (v.segment && v.segment.status) {
        console.log(`  segment : status=${v.segment.status} type=${v.segment.contentType} bytes=${v.segment.bytes} mediaBytes=${v.segment.isMediaBytes}`);
        console.log(`  classification: ${v.segment.classification}`);
      } else if (v.segment) {
        console.log(`  segment : ${v.segment.skipped}`);
      }
    } else {
      console.log('  (skipped — account not usable)');
    }
    console.log(`\n=== VERDICT: ${results.verdict} ===\n`);
  }

  // Exit codes for CI: 0 = READY, 1 = source unusable/blocked, 2 = usage error
  process.exit(results.verdict === 'READY' ? 0 : 1);
}

main().catch((err) => {
  console.error('Validator failed:', err.message);
  process.exit(1);
});
