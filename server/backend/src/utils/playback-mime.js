'use strict';

/**
 * Playback container inference for tokenized playback URLs.
 *
 * The playback token URL itself is opaque (no real file extension), so the
 * server tells the client which container the UPSTREAM carries. Media3's
 * MimeTypes.APPLICATION_M3U8 constant is "application/x-mpegURL" — returning
 * "application/vnd.apple.mpegurl" here made the Android client miss its HLS
 * branch (plain equals against the constant) and hand the playlist to the
 * PROGRESSIVE extractor, which sniffs the playlist text and dies instantly
 * with ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED — before ever fetching a
 * segment. Always emit the Media3-native value for HLS.
 */
const HLS_MIME_TYPE = 'application/x-mpegurl';

function inferPlaybackMimeType(streamUrl) {
  const raw = String(streamUrl || '').toLowerCase();
  const path = raw.split(/[?#]/, 1)[0];
  if (/\.(m3u8|m3u)$/.test(path) || raw.includes('output=m3u8')) {
    return HLS_MIME_TYPE;
  }
  if (/\.(ts|mpeg|mp2t)$/.test(path) || raw.includes('output=ts')) {
    return 'video/mp2t';
  }
  if (/\.mp4$/.test(path)) {
    return 'video/mp4';
  }
  if (/\.(mkv|mk3d)$/.test(path)) {
    return 'video/x-matroska';
  }
  if (/\.avi$/.test(path)) {
    return 'video/avi';
  }
  if (/\.(m4v|mov)$/.test(path)) {
    return 'video/quicktime';
  }
  return null;
}

module.exports = { inferPlaybackMimeType, HLS_MIME_TYPE };
