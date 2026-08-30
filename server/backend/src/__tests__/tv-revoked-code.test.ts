import request from 'supertest';
import express from 'express';
import User from '../models/User';

/**
 * Regression: a REVOKED channel-list code must not pair new devices
 * (POST /pair) nor report as valid (GET /verify/:code).
 *
 * Before this fix, /pair only checked isActive — a code revoked via the admin
 * "revoke channel list code" action kept working for device pairing, while the
 * playlist/stream endpoints (findUserByCode) already rejected it.
 */
jest.mock('../middleware/requireTvOrSessionAuth', () => ({
  requireTvOrSessionAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'u1', username: 'tvuser', role: 'User', channels: [], channelListCode: 'TVTEST', isActive: true };
    next();
  },
}));

jest.mock('../services/subscription-service', () => ({
  isSubscriptionRequired: jest.fn().mockResolvedValue(false),
  getActiveSubscription: jest.fn().mockResolvedValue(null),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tvRouter = require('../routes/tv');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/tv', tvRouter);
  return app;
}

const ACTIVE_CODE = 'ACT123';
const REVOKED_CODE = 'REV123';

describe('tv routes: revoked channel-list code', () => {
  beforeEach(async () => {
    await User.create({
      username: 'active-user',
      password: 'password123',
      email: 'active@example.com',
      channelListCode: ACTIVE_CODE,
      role: 'User',
    });
    await User.create({
      username: 'revoked-user',
      password: 'password123',
      email: 'revoked@example.com',
      channelListCode: REVOKED_CODE,
      role: 'User',
      codeRevokedAt: new Date(),
    });
  });

  it('POST /pair rejects a revoked code with 403', async () => {
    const res = await request(buildApp())
      .post('/api/v1/tv/pair')
      .send({ code: REVOKED_CODE, deviceName: 'TV', deviceModel: 'SM-S906B' });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/revoked/i);
  });

  it('POST /pair still accepts an active code', async () => {
    const res = await request(buildApp())
      .post('/api/v1/tv/pair')
      .send({ code: ACTIVE_CODE, deviceName: 'TV', deviceModel: 'SM-S906B' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /verify/:code reports a revoked code as invalid (without leaking why)', async () => {
    const res = await request(buildApp()).get(`/api/v1/tv/verify/${REVOKED_CODE}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/revoked/i);
  });

  it('GET /verify/:code still validates an active code', async () => {
    const res = await request(buildApp()).get(`/api/v1/tv/verify/${ACTIVE_CODE}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });
});
