import express from 'express';
import request from 'supertest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tvRouter = require('./tv');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', tvRouter);
  return app;
}

const legacyEnvironment = ['ALLOW_LEGACY_TV_CODE', 'ALLOW_LEGACY_PLAYBACK_TOKEN'] as const;
let savedEnvironment: Record<string, string | undefined>;

beforeEach(() => {
  savedEnvironment = Object.fromEntries(legacyEnvironment.map((key) => [key, process.env[key]]));
  delete process.env.ALLOW_LEGACY_TV_CODE;
  delete process.env.ALLOW_LEGACY_PLAYBACK_TOKEN;
});

afterEach(() => {
  for (const key of legacyEnvironment) {
    const value = savedEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('legacy channel-list code gate', () => {
  it.each([
    ['GET', '/playlist/ABC123'],
    ['GET', '/playlist/ABC123/json'],
    ['GET', '/verify/ABC123'],
    ['GET', '/epg/ABC123'],
    ['GET', '/epg/ABC123/json'],
  ])('returns 410 for %s %s by default', async (method, path) => {
    const response = await request(buildApp())[method.toLowerCase() as 'get'](path);

    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({ success: false, code: 'LEGACY_TV_CODE_DISABLED' });
  });

  it('rejects the old pairing route by default', async () => {
    const response = await request(buildApp()).post('/pair').send({ code: 'ABC123' });

    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({ success: false, code: 'LEGACY_TV_CODE_DISABLED' });
  });
});
