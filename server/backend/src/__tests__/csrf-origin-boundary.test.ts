import express from 'express';
import request from 'supertest';
import type { RequestHandler } from 'express';

describe('CSRF full origin boundary', () => {
  const originalOrigins = process.env.ALLOWED_ORIGINS;
  const originalAppUrl = process.env.APP_URL;
  let csrfProtection: RequestHandler;

  beforeEach(() => {
    process.env.ALLOWED_ORIGINS = 'https://allowed.example';
    delete process.env.APP_URL;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      csrfProtection = require('../middleware/csrfProtection').csrfProtection;
    });
  });

  afterEach(() => {
    if (originalOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = originalOrigins;
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
  });

  function app(trustProxy = false) {
    const instance = express();
    instance.set('trust proxy', trustProxy ? 'loopback' : false);
    instance.use(csrfProtection);
    instance.all('/change', (_req, res) => { res.sendStatus(204); });
    return instance;
  }

  it('preserves an explicitly allowed cross-origin request', async () => {
    const res = await request(app()).post('/change')
      .set('Host', 'mirror.example').set('Origin', 'https://allowed.example');
    expect(res.status).toBe(204);
  });

  it('preserves a same-origin HTTP request', async () => {
    const res = await request(app()).post('/change')
      .set('Host', 'mirror.example').set('Origin', 'http://mirror.example');
    expect(res.status).toBe(204);
  });

  it('preserves HTTPS behind an explicitly trusted proxy', async () => {
    const res = await request(app(true)).post('/change')
      .set('Host', 'mirror.example').set('X-Forwarded-Proto', 'https')
      .set('Origin', 'https://mirror.example');
    expect(res.status).toBe(204);
  });

  it('rejects a different scheme on the same hostname', async () => {
    const res = await request(app(true)).post('/change')
      .set('Host', 'mirror.example').set('X-Forwarded-Proto', 'https')
      .set('Origin', 'http://mirror.example');
    expect(res.status).toBe(403);
  });

  it('rejects a different port on the same hostname', async () => {
    const res = await request(app()).post('/change')
      .set('Host', 'mirror.example:8080').set('Origin', 'http://mirror.example:9090');
    expect(res.status).toBe(403);
  });

  it('accepts the same non-default port', async () => {
    const res = await request(app()).post('/change')
      .set('Host', 'mirror.example:8080').set('Origin', 'http://mirror.example:8080');
    expect(res.status).toBe(204);
  });

  it('normalizes default ports for same-origin comparison', async () => {
    const res = await request(app(true)).post('/change')
      .set('Host', 'mirror.example:443').set('X-Forwarded-Proto', 'https')
      .set('Origin', 'https://mirror.example');
    expect(res.status).toBe(204);
  });

  it('does not trust a forwarded scheme from an untrusted peer', async () => {
    const res = await request(app()).post('/change')
      .set('Host', 'mirror.example').set('X-Forwarded-Proto', 'https')
      .set('Origin', 'https://mirror.example');
    expect(res.status).toBe(403);
  });

  it('uses the same boundary for Referer fallback', async () => {
    const res = await request(app()).post('/change')
      .set('Host', 'mirror.example:8080')
      .set('Referer', 'http://mirror.example:9090/settings');
    expect(res.status).toBe(403);
  });

  it('accepts a same-origin Referer with a path', async () => {
    const res = await request(app()).post('/change')
      .set('Host', 'mirror.example:8080')
      .set('Referer', 'http://mirror.example:8080/settings');
    expect(res.status).toBe(204);
  });

  it('does not override a rejected Origin with a valid Referer', async () => {
    const res = await request(app()).post('/change')
      .set('Host', 'mirror.example').set('Origin', 'http://other.example')
      .set('Referer', 'http://mirror.example/settings');
    expect(res.status).toBe(403);
  });

  it.each(['null', 'not-a-url', 'http://other.example'])('rejects origin %s', async (origin) => {
    const res = await request(app()).post('/change')
      .set('Host', 'mirror.example').set('Origin', origin);
    expect(res.status).toBe(403);
  });

  it('preserves requests without browser origin headers', async () => {
    expect((await request(app()).post('/change')).status).toBe(204);
  });

  it.each(['x-session-id', 'authorization', 'x-tv-code'])('preserves custom credential header %s', async (header) => {
    const res = await request(app()).post('/change')
      .set('Origin', 'http://other.example').set(header, 'test-only');
    expect(res.status).toBe(204);
  });

  it('preserves safe methods', async () => {
    const res = await request(app()).get('/change').set('Origin', 'http://other.example');
    expect(res.status).toBe(204);
  });
});
