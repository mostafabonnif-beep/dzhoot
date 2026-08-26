const fs = require('fs');
const { timingSafeEqual } = require('crypto');
const client = require('@prometheus-io/client');

const registry = new client.Registry();
registry.setDefaultLabels({ service: 'dzhoof-api' });
client.collectDefaultMetrics({
  prefix: 'dzhoof_',
  register: registry,
});

const httpRequestsTotal = new client.Counter({
  name: 'dzhoof_http_requests_total',
  help: 'Total completed HTTP requests handled by the DZ HOOF API.',
  labelNames: ['method', 'status_class'],
  registers: [registry],
});

const httpRequestDurationSeconds = new client.Histogram({
  name: 'dzhoof_http_request_duration_seconds',
  help: 'HTTP request duration in seconds for the DZ HOOF API.',
  labelNames: ['method', 'status_class'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const httpRequestsInFlight = new client.Gauge({
  name: 'dzhoof_http_requests_in_flight',
  help: 'Current number of in-flight HTTP requests handled by the DZ HOOF API.',
  registers: [registry],
});

const dependenciesUp = new client.Gauge({
  name: 'dzhoof_dependency_up',
  help: 'Whether a named DZ HOOF dependency is currently available (1) or unavailable (0).',
  labelNames: ['dependency'],
  registers: [registry],
});

function statusClass(statusCode, aborted) {
  if (aborted) return 'aborted';
  return `${Math.floor(Number(statusCode || 500) / 100)}xx`;
}

function observeHttpRequest(req, res, next) {
  if (req.path === '/internal/metrics') return next();

  const startedAt = process.hrtime.bigint();
  let recorded = false;
  httpRequestsInFlight.inc();

  const record = (aborted = false) => {
    if (recorded) return;
    recorded = true;

    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const labels = {
      method: req.method,
      status_class: statusClass(res.statusCode, aborted),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSeconds);
    httpRequestsInFlight.dec();
  };

  res.once('finish', () => record(false));
  res.once('close', () => record(!res.writableEnded));
  next();
}

function readConfiguredMetricsToken() {
  const fromEnvironment = String(process.env.METRICS_BEARER_TOKEN || '').trim();
  if (fromEnvironment) return fromEnvironment;

  const tokenFile = String(process.env.METRICS_BEARER_TOKEN_FILE || '').trim();
  if (!tokenFile) return '';

  try {
    return fs.readFileSync(tokenFile, 'utf8').trim();
  } catch {
    return '';
  }
}

function isAuthorizedMetricsRequest(req) {
  const expected = readConfiguredMetricsToken();
  const authorization = String(req.get('authorization') || '');
  const provided = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';

  if (!expected || !provided) return false;

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

async function renderMetrics({ mongoReady, redisReady }) {
  dependenciesUp.set({ dependency: 'mongodb' }, mongoReady ? 1 : 0);
  dependenciesUp.set({ dependency: 'redis' }, redisReady ? 1 : 0);
  return registry.metrics();
}

module.exports = {
  observeHttpRequest,
  isAuthorizedMetricsRequest,
  renderMetrics,
  registry,
};
