import request from 'supertest';

// Keep the real config helpers (other routes use them) but let the demo-code
// resolver fail on demand.
jest.mock('../routes/config', () => {
  // `routes/config` exports an Express router (a callable) with helper
  // properties attached — spreading it would produce a plain object and break
  // `app.use`. Mutate the real module instead.
  const actual = jest.requireActual('../routes/config');
  actual.resolvePublicDemoCode = jest.fn();
  return actual;
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app } = require('../server');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require('../routes/config');

/**
 * Regression cover for the hardening pass of 2026-09-16:
 *  - the public demo-code handler must answer instead of hanging on a rejection,
 *  - the 50 MB M3U body parser must sit behind authentication,
 *  - both public checkout endpoints and the public logo relay must be throttled.
 */
describe('hardening regressions', () => {
  describe('GET /api/v1/app/demo-code', () => {
    afterEach(() => {
      (config.resolvePublicDemoCode as jest.Mock).mockReset();
    });

    it('answers 503 instead of hanging when the resolver rejects', async () => {
      (config.resolvePublicDemoCode as jest.Mock).mockRejectedValue(new Error('mongo down'));

      const res = await request(app).get('/api/v1/app/demo-code');

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
    });

    it('answers 404 when no demo code is configured', async () => {
      (config.resolvePublicDemoCode as jest.Mock).mockResolvedValue(null);

      const res = await request(app).get('/api/v1/app/demo-code');

      expect(res.status).toBe(404);
    });

    it('returns the code when the resolver finds one', async () => {
      (config.resolvePublicDemoCode as jest.Mock).mockResolvedValue('DEMO-CODE-1234');

      const res = await request(app).get('/api/v1/app/demo-code');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ code: 'DEMO-CODE-1234' });
    });
  });

  describe('POST /api/v1/admin/channels/import-m3u', () => {
    it('authenticates before buffering the 50 MB body', async () => {
      // 6 MB: above the global 5 MB parser limit, so a request that reached the
      // body parser before authentication would fail with 413 instead of 401.
      const bigPlaylist = `#EXTM3U\n${'#EXTINF:-1,probe\nhttps://upstream.test/x.m3u8\n'.repeat(150000)}`;

      const res = await request(app)
        .post('/api/v1/admin/channels/import-m3u')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ m3uContent: bigPlaylist }));

      expect(res.status).toBe(401);
    }, 30000);
  });

  describe('public throttles', () => {
    it('rate-limits the CinetPay checkout like the Chargily one', async () => {
      let limited = false;
      for (let i = 0; i < 25; i += 1) {
        const res = await request(app)
          .post('/api/v1/payments/cinetpay/checkout')
          .send({ planId: '000000000000000000000000' });
        if (res.status === 429) {
          limited = true;
          break;
        }
      }
      expect(limited).toBe(true);
    }, 30000);

    it('rate-limits the public logo relay', async () => {
      let limited = false;
      for (let i = 0; i < 310; i += 1) {
        // No url param → the handler answers 400 immediately; the limiter runs first.
        const res = await request(app).get('/api/v1/tv/logo');
        if (res.status === 429) {
          limited = true;
          break;
        }
      }
      expect(limited).toBe(true);
    }, 30000);
  });
});
