#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const { performance } = require('perf_hooks');

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_REDIRECTS = 5;

function redact(value) {
  return String(value || '')
    .replace(/(username|user|password|pass|token|jwt|key|auth|signature)=([^&\s]+)/gi, '$1=REDACTED')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1REDACTED');
}

function safeUrl(value) {
  try {
    const parsed = new URL(value);
    for (const key of ['username', 'password']) parsed.searchParams.set(key, 'REDACTED');
    for (const key of ['token', 'jwt', 'auth', 'signature']) {
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

function profileHeaders(profile) {
  const profiles = {
    native: { 'User-Agent': 'DZ-HOOF-Diagnostic/1.0', Accept: '*/*', 'Accept-Encoding': 'identity' },
    browser: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36', Accept: '*/*', 'Accept-Encoding': 'identity' },
    vlc: { 'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18', Accept: '*/*', 'Accept-Encoding': 'identity' },
  };
  return profiles[profile] || profiles.native;
}

async function dnsInfo(url) {
  try {
    const hostname = new URL(url).hostname;
    const records = await dns.lookup(hostname, { all: true });
    return { hostname, addresses: records.map((record) => record.address) };
  } catch (error) {
    return { error: redact(error.message) };
  }
}

async function request(url, profile, options = {}) {
  const started = performance.now();
  const headers = { ...profileHeaders(profile), ...(options.headers || {}) };
  const redirectChain = [];
  let current = url;
  let response;
  let firstByteMs = null;
  let body = Buffer.alloc(0);
  let error = null;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const dnsResult = await dnsInfo(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
      const fetchStarted = performance.now();
      response = await fetch(current, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
      firstByteMs = Math.round(performance.now() - fetchStarted);
      const location = response.headers.get('location');
      const contentLength = response.headers.get('content-length');
      const contentType = response.headers.get('content-type');
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        const next = new URL(location, current).toString();
        redirectChain.push({ status: response.status, from: safeUrl(current), to: safeUrl(next), dns: dnsResult, headers: { location: safeUrl(next), contentType, contentLength } });
        current = next;
        continue;
      }
      const reader = response.body?.getReader();
      const chunks = [];
      let total = 0;
      if (reader) {
        while (total < MAX_BODY_BYTES) {
          const part = await reader.read();
          if (part.done) break;
          const chunk = Buffer.from(part.value);
          chunks.push(chunk);
          total += chunk.length;
        }
        try { await reader.cancel(); } catch {}
      }
      body = Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES);
      clearTimeout(timer);
      return {
        url: safeUrl(url), finalUrl: safeUrl(current), profile, dns: dnsResult,
        status: response.status, httpVersion: 'fetch-runtime',
        headers: { contentType, contentLength, transferEncoding: response.headers.get('transfer-encoding'), location: location ? safeUrl(location) : null, cookie: response.headers.has('set-cookie') ? 'PRESENT' : 'ABSENT' },
        timing: { responseMs: Math.round(performance.now() - started), ttfbMs: firstByteMs },
        redirects: redirectChain, bytes: body.length,
        firstBytesHex: body.subarray(0, 16).toString('hex'),
        textPreview: body.toString('utf8', 0, 512).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').trim(),
        body,
      };
    } catch (caught) {
      error = caught;
      clearTimeout(timer);
      break;
    }
  }
  return { url: safeUrl(url), profile, error: redact(error?.name === 'AbortError' ? 'TIMEOUT' : error?.message || 'request failed'), redirects: redirectChain, timing: { responseMs: Math.round(performance.now() - started), ttfbMs: firstByteMs } };
}

function parseM3u(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const channels = [];
  let metadata = null;
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) metadata = line;
    else if (metadata && !line.startsWith('#')) {
      channels.push({ metadata, url: line });
      metadata = null;
    }
  }
  return channels;
}

function isHls(result) {
  const contentType = String(result.headers?.contentType || '').toLowerCase();
  return result.textPreview?.startsWith('#EXTM3U') || contentType.includes('mpegurl') || /\.m3u8(?:\?|$)/i.test(result.finalUrl || '');
}

function extractHlsLinks(text, baseUrl) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).slice(0, 3).map((line) => new URL(line, baseUrl).toString());
}

async function diagnoseUrl(url, profile) {
  const result = await request(url, profile);
  const chain = [{ stage: 'live', ...result, body: undefined }];
  if (result.body && isHls(result)) {
    const childUrls = extractHlsLinks(result.body.toString('utf8'), result.finalUrl || url);
    for (const childUrl of childUrls) {
      const child = await request(childUrl, profile);
      chain.push({ stage: 'hls-child-or-segment', ...child, body: undefined });
      if (child.body && isHls(child)) {
        for (const segmentUrl of extractHlsLinks(child.body.toString('utf8'), child.finalUrl || childUrl)) {
          const segment = await request(segmentUrl, profile);
          chain.push({ stage: 'hls-segment', ...segment, body: undefined });
        }
      }
    }
  }
  return chain;
}

async function main() {
  const args = process.argv.slice(2);
  const m3uArg = args.indexOf('--m3u');
  const urlArg = args.indexOf('--url');
  const profileArg = args.indexOf('--profile');
  const profile = profileArg >= 0 ? args[profileArg + 1] : 'native';
  let sourceUrl = urlArg >= 0 ? args[urlArg + 1] : null;
  let playlistSummary = null;
  if (m3uArg >= 0) {
    const input = args[m3uArg + 1];
    const text = /^https?:\/\//i.test(input) ? (await request(input, profile)).body?.toString('utf8') || '' : fs.readFileSync(path.resolve(input), 'utf8');
    const channels = parseM3u(text);
    playlistSummary = { channels: channels.length, source: sourceUrl ? safeUrl(sourceUrl) : null };
    sourceUrl = sourceUrl || channels[0]?.url;
  }
  if (!sourceUrl) throw new Error('Use --url URL or --m3u PATH_OR_URL');
  const chains = {};
  for (const selectedProfile of profile === 'matrix' ? ['native', 'browser', 'vlc'] : [profile]) {
    chains[selectedProfile] = await diagnoseUrl(sourceUrl, selectedProfile);
  }
  const output = { generatedAt: new Date().toISOString(), playlist: playlistSummary, sourceUrl: safeUrl(sourceUrl), chains };
  console.log(JSON.stringify(output, (key, value) => key === 'body' ? undefined : value, 2));
}

main().catch((error) => { console.error(JSON.stringify({ error: redact(error.message) })); process.exitCode = 1; });
