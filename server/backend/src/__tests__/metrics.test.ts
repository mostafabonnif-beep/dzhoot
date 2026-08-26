import request from 'supertest';

process.env.METRICS_BEARER_TOKEN = 'metrics-test-token';
// server.js exports the app without opening a listener when imported by Jest.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app } = require('../server');

describe('internal metrics endpoint', () => {
  it('does not disclose the endpoint without a valid bearer token', async () => {
    const response = await request(app).get('/internal/metrics');

    expect(response.status).toBe(404);
  });

  it('returns Prometheus metrics only with the configured bearer token', async () => {
    const response = await request(app)
      .get('/internal/metrics')
      .set('Authorization', 'Bearer metrics-test-token');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).toContain('dzhoof_http_requests_total');
    expect(response.text).toContain('dzhoof_dependency_up');
    expect(response.text).not.toContain('metrics-test-token');
  });

  it('records bounded HTTP labels without exposing request paths', async () => {
    await request(app).get('/health/live');

    const response = await request(app)
      .get('/internal/metrics')
      .set('Authorization', 'Bearer metrics-test-token');

    expect(response.text).toMatch(/dzhoof_http_requests_total\{[^}]*method="GET"[^}]*status_class="2xx"[^}]*\}/);
    expect(response.text).not.toContain('/health/live');
  });
});
