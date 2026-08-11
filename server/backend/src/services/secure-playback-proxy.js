const http = require('http');
const https = require('https');
const axios = require('axios');
const { validateUrlForSSRF, createPinnedLookup } = require('../utils/ssrf-guard');

async function validateRedirectTarget(options) {
  const protocol = options.protocol || 'http:';
  const hostname = String(options.hostname || '').replace(/^\[|\]$/g, '');
  const port = options.port ? `:${options.port}` : '';
  const target = `${protocol}//${hostname}${port}${options.path || '/'}`;
  const check = await validateUrlForSSRF(target);
  if (!check.safe) throw new Error(`Redirect blocked: ${check.reason}`);
  options.lookup = createPinnedLookup(check.resolvedAddresses);
  return check;
}

function rewriteManifest(data, finalUrl, proxyPath, resourceBuilder) {
  const rewrite = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return trimmed;
    if (!resourceBuilder) throw new Error('Managed playback requires a signed resource builder');
    return resourceBuilder(new URL(trimmed, finalUrl).toString(), finalUrl);
  };
  return data.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) return line.replace(/URI="([^"]+)"/gi, (match, uri) => `URI="${rewrite(uri)}"`);
    return rewrite(trimmed);
  }).join('\n');
}

async function proxyResolvedStream(req, res, url, proxyPath, resourceBuilder) {
  let httpAgent;
  let httpsAgent;
  try {
    const ssrfCheck = await validateUrlForSSRF(url);
    if (!ssrfCheck.safe) return res.status(403).send(ssrfCheck.reason);
    const pinnedLookup = createPinnedLookup(ssrfCheck.resolvedAddresses);
    httpAgent = new http.Agent({ lookup: pinnedLookup });
    httpsAgent = new https.Agent({ lookup: pinnedLookup });
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 30000,
      httpAgent,
      httpsAgent,
      headers: {
        'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
        Accept: '*/*',
        'Accept-Encoding': 'gzip, deflate',
        Connection: 'keep-alive',
      },
      maxRedirects: 5,
      beforeRedirect: async (options) => {
        await validateRedirectTarget(options);
      },
    });
    let responseDone = false;
    req.on('close', () => response.data?.destroy?.());
    const finalUrl = response.request?.res?.responseUrl || response.request?.responseURL || url;
    const contentType = (response.headers['content-type'] || '').toLowerCase();
    const isManifest = url.includes('.m3u8') || finalUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('apple.mpegurl');
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Content-Type': isManifest ? 'application/vnd.apple.mpegurl' : response.headers['content-type'] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    if (!isManifest) {
      response.data.pipe(res);
      response.data.on('error', () => {
        if (!responseDone && !res.headersSent) {
          responseDone = true;
          res.status(500).send('Stream error');
        }
      });
      return;
    }
    const chunks = [];
    let dataSize = 0;
    response.data.on('data', (chunk) => {
      dataSize += chunk.length;
      if (dataSize > 10 * 1024 * 1024) {
        response.data.destroy();
        if (!responseDone && !res.headersSent) {
          responseDone = true;
          res.status(413).send('Manifest too large');
        }
        return;
      }
      chunks.push(chunk);
    });
    response.data.on('end', () => {
      if (responseDone || res.headersSent) return;
      const rewritten = rewriteManifest(Buffer.concat(chunks).toString('utf8'), finalUrl, proxyPath, resourceBuilder);
      responseDone = true;
      res.send(rewritten);
    });
    response.data.on('error', () => {
      if (!responseDone && !res.headersSent) {
        responseDone = true;
        res.status(500).send('Stream error');
      }
    });
  } catch (error) {
    if (res.headersSent) return;
    if (error.response) return res.status(error.response.status).send(error.response.statusText);
    if (error.code === 'ECONNABORTED') return res.status(504).send('Gateway Timeout');
    return res.status(502).send('Bad Gateway');
  } finally {
    httpAgent?.destroy();
    httpsAgent?.destroy();
  }
}

module.exports = { proxyResolvedStream, rewriteManifest };
