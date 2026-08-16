#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_LOG_BYTES = 256 * 1024;

function redact(value) {
  return String(value || '')
    .replace(/(username|user|password|pass|token|jwt|key|auth|signature|data|expires)=([^&\s]+)/gi, '$1=REDACTED')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1REDACTED')
    .replace(/(https?:\/\/[^/\s]+\/live\/)[^/\s]+\/[^/\s]+/gi, '$1USER/REDACTED');
}

function safeUrl(value) {
  try {
    const parsed = new URL(value);
    for (const key of ['username', 'password', 'token', 'jwt', 'auth', 'signature', 'data', 'expires']) {
      if (parsed.username && key === 'username') parsed.username = 'REDACTED';
      if (parsed.password && key === 'password') parsed.password = 'REDACTED';
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

function parseM3u(filePath) {
  const lines = fs.readFileSync(path.resolve(filePath), 'utf8').split(/\r?\n/).map((line) => line.trim());
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] && !lines[index].startsWith('#')) return lines[index];
  }
  throw new Error('No stream URL found in M3U file');
}

function run(command, args, outputPath, timeoutMs) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: MAX_LOG_BYTES,
  });
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  fs.writeFileSync(outputPath, redact(combined), { mode: 0o600 });
  return {
    command,
    exitCode: result.status,
    signal: result.signal || null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    outputBytes: Buffer.byteLength(combined),
  };
}

function redactFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  fs.writeFileSync(filePath, redact(content));
  fs.chmodSync(filePath, 0o600);
}

function curlArgs(rawUrl, headersPath, profile) {
  const args = [
    '-L', '--max-time', '20', '--connect-timeout', '8', '--silent', '--show-error',
    '-D', headersPath, '-o', '/dev/null',
    '-w', '%{http_code}\\t%{content_type}\\t%{size_download}\\t%{time_starttransfer}\\t%{time_total}\\t%{url_effective}\\n', rawUrl,
  ];
  if (profile === 'vlc') args.splice(7, 0, '-A', 'VLC/3.0.18 LibVLC/3.0.18', '-H', 'Accept: */*', '--compressed');
  return args;
}

function runCurlProfile(rawUrl, privateDir, runId, profile) {
  const headersPath = path.join(privateDir, `${runId}-${profile}-curl.headers`);
  const logPath = path.join(privateDir, `${runId}-${profile}-curl.log`);
  const result = run('curl', curlArgs(rawUrl, headersPath, profile), logPath, 30000);
  redactFile(headersPath);
  return { ...result, ...parseCurlMetrics(fs.readFileSync(logPath, 'utf8')) };
}

function classifyFfprobe(result, parsed, text) {
  if (result.timedOut) return 'connection_timeout';
  if (parsed?.format && Array.isArray(parsed.streams) && parsed.streams.length > 0) return 'valid_media';
  if (/<!doctype html|<html\b|text\/html/i.test(text)) return 'html_response';
  if (/timed out|timeout|connection refused|could not resolve|network is unreachable|failed to open/i.test(text)) return 'connection_failure';
  return 'invalid_media';
}

function classifyVlc(result, text) {
  const detectedMedia = /stream output|es_out|codec debug/i.test(text) && !/can't be opened|unable to open|cannot be opened|no access|error:/i.test(text);
  if (result.exitCode === null && /ENOENT|not found/i.test(text)) return { detectedMedia: false, classification: 'missing_dependency' };
  if (detectedMedia) return { detectedMedia: true, classification: 'media_detected' };
  if (result.timedOut) return { detectedMedia: false, classification: 'media_playback_timeout' };
  if (/can't be opened|unable to open|cannot be opened|no access|error:/i.test(text)) return { detectedMedia: false, classification: 'media_playback_failed' };
  return { detectedMedia: false, classification: 'process_started_no_media' };
}

function parseCurlMetrics(output) {
  const line = output.trim().split(/\r?\n/).pop() || '';
  const [httpCode, contentType, sizeDownload, timeStartTransfer, timeTotal, finalUrl] = line.split('\t');
  return {
    httpCode: Number(httpCode) || null,
    contentType: contentType || null,
    bytes: Number(sizeDownload) || 0,
    ttfbMs: timeStartTransfer ? Math.round(Number(timeStartTransfer) * 1000) : null,
    totalMs: timeTotal ? Math.round(Number(timeTotal) * 1000) : null,
    finalUrl: safeUrl(finalUrl),
  };
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf('--m3u');
  if (index < 0 || !args[index + 1]) throw new Error('Usage: v4-matrix.js --m3u PATH');
  const inputPath = args[index + 1];
  const rawUrl = parseM3u(inputPath);
  const runId = `${Date.now()}-${process.pid}`;
  const privateDir = process.env.DZ_FORENSIC_PRIVATE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'dzhoot-v4-'));
  fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateDir, 0o700);
  const ffprobeLog = path.join(privateDir, `${runId}-ffprobe.json`);
  const vlcLog = path.join(privateDir, `${runId}-vlc.log`);

  const curlNative = runCurlProfile(rawUrl, privateDir, runId, 'native');
  const curlVlcProfile = runCurlProfile(rawUrl, privateDir, runId, 'vlc');
  const ffprobe = run('ffprobe', [
    '-v', 'error', '-of', 'json', '-show_entries',
    'format=format_name,format_long_name,duration,bit_rate:stream=index,codec_name,codec_type,width,height,bit_rate',
    '-rw_timeout', '15000000', rawUrl,
  ], ffprobeLog, 30000);
  const ffprobeText = fs.readFileSync(ffprobeLog, 'utf8');
  const ffprobeJson = readJson(ffprobeLog);
  const vlc = run('cvlc', [
    '--intf', 'dummy', '--play-and-exit', '--no-video-title-show', '--network-caching=1000', rawUrl,
  ], vlcLog, 20000);
  const vlcText = fs.readFileSync(vlcLog, 'utf8');
  const vlcClassification = classifyVlc(vlc, vlcText);
  const output = {
    generatedAt: new Date().toISOString(),
    host: os.hostname(),
    source: safeUrl(rawUrl),
    artifacts: {
      privateDir,
      curlNativeHeaders: path.join(privateDir, `${runId}-native-curl.headers`),
      curlNativeLog: path.join(privateDir, `${runId}-native-curl.log`),
      curlVlcHeaders: path.join(privateDir, `${runId}-vlc-curl.headers`),
      curlVlcLog: path.join(privateDir, `${runId}-vlc-curl.log`),
      ffprobeLog,
      vlcLog,
    },
    matrix: {
      curl_native: curlNative,
      curl_vlc_profile: curlVlcProfile,
      ffprobe: {
        ...ffprobe,
        classification: classifyFfprobe(ffprobe, ffprobeJson, ffprobeText),
        format: ffprobeJson?.format ? {
          formatName: ffprobeJson.format.format_name || null,
          duration: ffprobeJson.format.duration || null,
          bitrate: ffprobeJson.format.bit_rate || null,
        } : null,
        streams: Array.isArray(ffprobeJson?.streams) ? ffprobeJson.streams.map((stream) => ({
          type: stream.codec_type || null,
          codec: stream.codec_name || null,
          width: stream.width || null,
          height: stream.height || null,
          bitrate: stream.bit_rate || null,
        })) : [],
      },
      vlc: {
        ...vlc,
        ...vlcClassification,
        errorHints: [...vlcText.matchAll(/(?:error|failed|cannot|no access|http\/\d\.\d\s+\d{3})[^\n]*/gi)].slice(0, 5).map((match) => redact(match[0])),
      },
    },
  };
  console.log(JSON.stringify(output, null, 2));
}

try { main(); } catch (error) { console.error(JSON.stringify({ error: redact(error.message) })); process.exitCode = 1; }
