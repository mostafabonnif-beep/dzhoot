import request from 'supertest';

// server.js now exports the app without opening a listener when imported by Jest.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app } = require('../server');

describe('health endpoints', () => {
  it('GET /health/live returns an always-live process probe', async () => {
    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(typeof response.body.uptime).toBe('number');
  });

  it('GET /health/ready reports MongoDB readiness', async () => {
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.mongodb).toBe('connected');
    expect(response.body).toHaveProperty('redis');
  });

  it('GET /health returns the compact health summary', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body).toHaveProperty('version');
    expect(response.body).toHaveProperty('requestId');
    // Operational details are not part of the public payload (audit-remediation-v1).
    expect(response.body).not.toHaveProperty('mongodb');
    expect(response.body).not.toHaveProperty('redis');
    expect(response.body).not.toHaveProperty('uptime');
  });

  it('GET /health?details=true includes operational details', async () => {
    const response = await request(app).get('/health?details=true');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.details).toEqual(
      expect.objectContaining({
        sources: expect.any(Object),
        epg: expect.any(Object),
        scheduler: expect.any(Object),
        alerting: expect.any(Object),
      }),
    );
    expect(response.body.details).toHaveProperty('mongodb');
    expect(response.body.details).toHaveProperty('redis');
    expect(response.body.details).toHaveProperty('uptime');
  });
});
