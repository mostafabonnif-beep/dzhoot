const Sentry = require('@sentry/node');
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { randomUUID } = require('crypto');
const rateLimit = require('express-rate-limit');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { redactSensitiveText } = require('./services/audit-log');

Sentry.init({
  dsn: process.env.BACKEND_SENTRY_DSN,
  integrations: [Sentry.httpIntegration()],
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV ?? 'development',
  enabled: !!process.env.BACKEND_SENTRY_DSN,
});

// Validate required environment variables
{
  const required = [
    'MONGODB_URI',
    'REDIS_URL',
    'PUBLIC_BASE_URL',
    'ALLOWED_ORIGINS',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'PLAYBACK_TOKEN_SECRET',
    'XTREAM_SECRET_KEY',
    'TOTP_ENCRYPTION_KEY',
    'SUPER_ADMIN_PASSWORD',
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    if (process.env.NODE_ENV === 'production') {
      console.error(`Missing required environment variables: ${missing.join(', ')}`);
      process.exit(1);
    } else {
      console.warn(
        `WARNING: Missing environment variables: ${missing.join(', ')} — some features may not work`,
      );
    }
  }
}

// Reject known-default / weak secrets in production
if (process.env.NODE_ENV === 'production') {
  const PLACEHOLDER_SECRETS = new Set([
    'your-access-secret',
    'your-refresh-secret',
    'dev-access-secret-change-me',
    'dev-refresh-secret-change-me',
    'CHANGE-ME',
    'CHANGE_ME',
    'change-me',
  ]);
  const isWeakSecret = (val) =>
    !val || PLACEHOLDER_SECRETS.has(val) || /^change[-_]?me/i.test(val) || val.length < 32;
  const isPlaceholder = (val) => {
    const normalized = String(val || '').trim().toLowerCase();
    return !normalized ||
      normalized.includes('change-me') ||
      normalized.includes('change_me') ||
      normalized.includes('your-') ||
      normalized.includes('example.com') ||
      normalized === 'changemenow123!';
  };

  const problems = [];
  if (isWeakSecret(process.env.JWT_ACCESS_SECRET))
    problems.push('JWT_ACCESS_SECRET is a default/placeholder or shorter than 32 characters');
  if (isWeakSecret(process.env.JWT_REFRESH_SECRET))
    problems.push('JWT_REFRESH_SECRET is a default/placeholder or shorter than 32 characters');
  if (isWeakSecret(process.env.PLAYBACK_TOKEN_SECRET))
    problems.push('PLAYBACK_TOKEN_SECRET is a default/placeholder or shorter than 32 characters');
  if (isWeakSecret(process.env.XTREAM_SECRET_KEY))
    problems.push('XTREAM_SECRET_KEY is a default/placeholder or shorter than 32 characters');
  if (!/^[a-f0-9]{64}$/i.test(String(process.env.TOTP_ENCRYPTION_KEY || '')))
    problems.push('TOTP_ENCRYPTION_KEY must be a 64-character hexadecimal value');
  const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (!/^https:\/\/[^\s/]+(?:\/.*)?$/i.test(publicBaseUrl) || /example\.com|localhost|127\.0\.0\.1/i.test(publicBaseUrl))
    problems.push('PUBLIC_BASE_URL must be a real HTTPS URL, not localhost or a placeholder');
  if (!String(process.env.ALLOWED_ORIGINS || '').trim() || String(process.env.ALLOWED_ORIGINS).split(',').some((origin) => !/^https:\/\/[^\s/]+$/i.test(origin.trim())))
    problems.push('ALLOWED_ORIGINS must contain only explicit HTTPS origins');
  if (isPlaceholder(process.env.SUPER_ADMIN_PASSWORD) || String(process.env.SUPER_ADMIN_PASSWORD || '').length < 16)
    problems.push('SUPER_ADMIN_PASSWORD is a placeholder or shorter than 16 characters');
  if (isPlaceholder(process.env.SUPER_ADMIN_EMAIL))
    problems.push('SUPER_ADMIN_EMAIL is a placeholder address');

  if (problems.length > 0) {
    console.error(`[SECURITY] Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
}

// Resolve paths relative to project root (two levels up from backend/src/)
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const app = express();

// Trust reverse proxy (Docker/Portainer/nginx) so rate-limiter
// uses the real client IP from X-Forwarded-For.
// ASSUMPTION: production runs behind Cloudflare, so the real client IP is
// carried in the CF-Connecting-IP header. With two proxy hops (CF edge -> our
// reverse proxy), req.ip resolves to the CF edge IP, which would collapse all
// clients into one rate-limit bucket. clientIp() below prefers CF-Connecting-IP.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Resolve the client IP used for rate-limit keys.
// CF-Connecting-IP is only trustworthy when Cloudflare actually fronts the app —
// otherwise it's an attacker-controlled header that lets a client mint a fresh
// rate-limit bucket per request. So only honor it when explicitly opted in
// (set TRUST_CF_CONNECTING_IP=true only when deployed behind Cloudflare).
// IPv6 is collapsed to its /64 prefix so a single allocation can't rotate
// through addresses to dodge the limiter.
const TRUST_CF_CONNECTING_IP = process.env.TRUST_CF_CONNECTING_IP === 'true';

function normalizeIp(ip) {
  if (!ip) return ip;
  const v = ip.startsWith('::ffff:') ? ip.slice(7) : ip; // unwrap IPv4-mapped IPv6
  if (v.includes(':')) {
    return v.split(':').slice(0, 4).join(':') + '::/64'; // key on the /64 network
  }
  return v;
}

function clientIp(req) {
  if (TRUST_CF_CONNECTING_IP) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return normalizeIp(String(cf).split(',')[0].trim());
  }
  return normalizeIp(req.ip);
}

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);
app.use(compression());

// Attach a bounded correlation ID to every request so logs and support reports
// can be joined without trusting arbitrary header content.
app.use((req, res, next) => {
  const incoming = String(req.get('x-request-id') || '').trim();
  req.requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
      : process.env.NODE_ENV === 'production'
        ? false
        : ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
  }),
);

// Cookie parser (needed for OAuth state cookies)
const cookieParser = require('cookie-parser');
app.use(cookieParser());

// Route-specific larger body limit for M3U import (must be BEFORE the global 5MB parser)
app.use('/api/v1/admin/channels/import-m3u', express.json({ limit: '50mb' }));

// Default body limit is 5MB for all other routes
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Redact session/JWT credentials and upstream stream URLs from access logs.
morgan.token('url-redacted', (req) =>
  (req.originalUrl || req.url).replace(
    /([?&](?:sid|token|url|username|password|api[_-]?key|secret)=)[^&]*/gi,
    '$1REDACTED',
  ),
);
morgan.token('request-id', (req) => req.requestId || '-');
// 'combined' format with the redacted URL and correlation ID.
app.use(
  morgan(
    ':remote-addr - :remote-user [:date[clf]] ":method :url-redacted HTTP/:http-version" ' +
      ':status :res[content-length] ":referrer" ":user-agent" "rid=:request-id"',
  ),
);

// CSRF protection: validate Origin/Referer on state-changing requests
const { csrfProtection } = require('./middleware/csrfProtection');
app.use(csrfProtection);

// Rate limiting
const Session = require('./models/Session');
const jwt = require('jsonwebtoken');

// In-memory TTL cache for admin-session lookups to avoid hitting MongoDB
// on every single API request. Entries expire after 60 seconds.
const adminSessionCache = new Map(); // key: sessionId, value: { isAdmin, expiresAt }
const ADMIN_CACHE_TTL_MS = 60_000;
const ADMIN_CACHE_MAX_SIZE = 5_000;

function getCachedAdminSession(sessionId) {
  const entry = adminSessionCache.get(sessionId);
  if (!entry) return null;
  if (Date.now() > entry.cachedUntil) {
    adminSessionCache.delete(sessionId);
    return null;
  }
  return entry;
}

function setCachedAdminSession(sessionId, isAdmin, expiresAt) {
  if (adminSessionCache.size >= ADMIN_CACHE_MAX_SIZE) {
    // Evict oldest entry instead of clearing all — prevents thundering herd
    const oldestKey = adminSessionCache.keys().next().value;
    if (oldestKey) adminSessionCache.delete(oldestKey);
  }
  adminSessionCache.set(sessionId, {
    isAdmin,
    expiresAt,
    cachedUntil: Date.now() + ADMIN_CACHE_TTL_MS,
  });
}

// Resolve a per-user rate-limit key from session or JWT, falling back to IP.
// Keys are always anchored to the client IP so that an attacker cannot bypass
// the rate limit by cycling fake session IDs or JWTs.
function resolveRateLimitIdentity(req) {
  const ip = clientIp(req);
  // Session-based auth (frontend dashboard)
  const sessionId = req.headers['x-session-id'];
  if (sessionId) return { key: `sess:${sessionId}:${ip}`, sessionId };

  // JWT auth (TV app / API clients)
  const auth = req.headers.authorization || '';
  const [, token] = auth.split(' ');
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
        algorithms: ['HS256'],
      });
      if (payload.sub) return { key: `jwt:${payload.sub}:${ip}` };
    } catch {
      // Invalid/expired token — fall through to IP-based limiting
    }
  }

  return null;
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  // Key by user identity + IP when authenticated, otherwise by IP alone
  keyGenerator: (req) => {
    const identity = resolveRateLimitIdentity(req);
    return identity ? identity.key : clientIp(req);
  },
  // Skip rate limiting entirely for authenticated admin sessions (cached)
  skip: async (req) => {
    try {
      const sessionId = req.headers['x-session-id'];
      if (!sessionId) return false;

      // Check in-memory cache first
      const cached = getCachedAdminSession(sessionId);
      if (cached) {
        return cached.isAdmin && cached.expiresAt > new Date();
      }

      // Cache miss — query MongoDB and cache the result
      const session = await Session.findOne({ sessionId }, { role: 1, expiresAt: 1 }).lean();
      const isAdmin = !!(session && session.role === 'Admin' && session.expiresAt > new Date());
      setCachedAdminSession(sessionId, isAdmin, session?.expiresAt);
      return isAdmin;
    } catch {
      return false;
    }
  },
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
});
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);
app.use('/api/v1/auth/verify-email', authLimiter);
app.use('/api/v1/auth/reset-password', authLimiter);
app.use('/api/v1/jwt/login', authLimiter);

// Stricter rate limit for forgot-password and resend-verification
// Per-IP limit: 3 requests per hour
const emailActionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
});
// Per-account limit: key by email in request body (prevents abuse of a single account)
const emailAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = (req.body && req.body.email) || '';
    return `email-action:${email.toLowerCase().trim()}:${clientIp(req)}`;
  },
});
app.use('/api/v1/auth/forgot-password', emailActionLimiter, emailAccountLimiter);
app.use('/api/v1/auth/resend-verification', emailActionLimiter, emailAccountLimiter);

// OAuth rate limiting — prevent abuse of OAuth initiation endpoints
const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
});
app.use('/api/v1/oauth/google/start', oauthLimiter);
app.use('/api/v1/oauth/github/start', oauthLimiter);

// Read-only TV-code endpoints still expose bearer-like credentials. Keep a
// separate, less aggressive limiter so normal playlist/EPG refreshes work while
// distributed guessing from one client is throttled.
const tvCodeReadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  message: { success: false, error: 'Too many TV code requests, please slow down' },
});
app.use('/api/v1/tv/playlist', tvCodeReadLimiter);
app.use('/api/v1/tv/epg', tvCodeReadLimiter);

// Strict rate limiting for TV pairing mutation endpoints (prevent PIN brute-force)
const pairingLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 attempts per 5 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  message: { success: false, error: 'Too many pairing attempts, please try again later' },
});
app.use('/api/v1/tv/pairing/confirm', pairingLimiter);
app.use('/api/v1/tv/pair', pairingLimiter);
app.use('/api/v1/tv/verify', pairingLimiter);

// Permissive rate limiting for pairing status polling (TV polls this endpoint repeatedly)
// PIN expires in 10 minutes; allow up to 120 polls per 10-minute window (~1 every 5 seconds)
const pairingStatusLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  message: { success: false, error: 'Too many status requests, please slow down' },
});
app.use('/api/v1/tv/pairing/status', pairingStatusLimiter);

// Strict activation-code redemption limiter: 5 attempts per 10 minutes per user/IP.
// This protects hashed codes from online guessing without changing redemption semantics.
const activationRedeemLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = req.user?.id || req.headers['x-session-id'] || 'anonymous';
    return `activation-redeem:${userId}:${clientIp(req)}`;
  },
  message: { success: false, error: 'Too many activation attempts, please try again later', code: 'RATE_LIMITED' },
});
app.use('/api/v1/activation/redeem', activationRedeemLimiter);

// Static files for uploads
app.use('/uploads', express.static(path.join(PROJECT_ROOT, 'uploads')));

// Routes
const { router: authRouter } = require('./routes/auth');
const { router: jwtRouter } = require('./routes/jwt');
const publicAuthRouter = require('./routes/publicAuth');
const oauthRouter = require('./routes/oauth');
const userPlaylistRouter = require('./routes/user-playlist');
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/jwt', jwtRouter);
app.use('/api/v1/public', publicAuthRouter);
app.use('/api/v1/oauth', oauthRouter);
app.use('/api/v1/user-playlist', userPlaylistRouter);
app.use('/api/v1/channels', require('./routes/channels'));
app.use('/api/v1/categories', require('./routes/categories'));
app.use('/api/v1/favorites', require('./routes/favorites'));
// App update routes (GitHub-based APK delivery)
app.use('/api/v1/app', require('./routes/app-update'));
app.use('/api/v1/admin', require('./routes/admin'));
// Subscription & activation (commercial backbone)
app.use('/api/v1/admin/plans', require('./routes/admin-plans'));
app.use('/api/v1/admin/activation-codes', require('./routes/admin-activation-codes'));
app.use('/api/v1/admin/resellers', require('./routes/admin-resellers'));
app.use('/api/v1/admin/reseller-debts', require('./routes/admin-reseller-debts'));
app.use('/api/v1/admin/code-batches', require('./routes/admin-code-batches'));
app.use('/api/v1/reseller/auth', require('./routes/reseller-auth'));
app.use('/api/v1/reseller', require('./routes/reseller'));
app.use('/api/v1/activation', require('./routes/activation'));
app.use('/api/v1/me', require('./routes/me'));
// Xtream Codes sources + VOD catalog
app.use('/api/v1/admin/xtream-sources', require('./routes/admin-xtream-sources'));
app.use('/api/v1/admin/m3u-sources', require('./routes/admin-m3u-sources'));
app.use('/api/v1/catalog', require('./routes/catalog'));
// Stream authorization + dynamic home + notifications + runtime settings
app.use('/api/v1/streams', require('./routes/streams'));
app.use('/api/v1/home', require('./routes/home'));
app.use('/api/v1/admin/notifications', require('./routes/admin-notifications'));
app.use('/api/v1/admin/app-settings', require('./routes/admin-app-settings'));
app.use('/api/v1/admin/vod', require('./routes/admin-vod'));
app.use('/api/v1/admin/recordings', require('./routes/admin-recordings'));
app.use('/api/v1/iptv-org', require('./routes/iptv-org'));
app.use('/api/v1/external-sources', require('./routes/external-sources'));
app.use('/api/v1/test', require('./routes/channel-test'));
app.use('/api/v1/image-proxy', require('./routes/image-proxy'));
app.use('/api/v1/stream-proxy', require('./routes/stream-proxy'));
app.use('/api/v1/users', require('./routes/users'));
app.use('/api/v1/tv', require('./routes/tv'));
app.use('/api/v1/epg', require('./routes/epg'));
app.use('/api/v1/movies', require('./routes/movies'));
app.use('/api/v1/series', require('./routes/series'));
app.use('/api/v1/config', require('./routes/config'));
app.use('/api/v1/activity', require('./routes/activity'));
app.use('/api/v1/scheduler', require('./routes/scheduler'));

// Initialize Redis (optional - app works without it)
const { getRedisClient, isRedisReady, closeRedis } = require('./services/redis');

function summarizeSourceHealth(sources) {
  const active = sources.filter((source) => source.status === 'Active').length;
  const syncing = sources.filter((source) => source.syncStatus === 'syncing').length;
  const errors = sources.filter((source) => source.syncStatus === 'error').length;
  const latest = sources
    .filter((source) => source.lastSyncAt)
    .sort((a, b) => new Date(b.lastSyncAt).getTime() - new Date(a.lastSyncAt).getTime())[0];
  return {
    total: sources.length,
    active,
    syncing,
    errors,
    lastSyncAt: latest?.lastSyncAt || null,
    lastError: latest?.lastError ? redactSensitiveText(latest.lastError) : null,
  };
}

async function collectHealthDetails() {
  const mongoHealthy = mongoose.connection.readyState === 1;
  const details = {
    sources: {
      m3uActive: null,
      xtreamActive: null,
      m3u: null,
      xtream: null,
    },
    epg: { programs: null, channels: null },
    scheduler: { enabled: process.env.DISABLE_SCHEDULER !== 'true', tasks: [] },
    alerting: { webhookConfigured: Boolean(String(process.env.ALERT_WEBHOOK_URL || '').trim()) },
  };
  if (!mongoHealthy) return details;

  const [M3USource, XtreamSource, EpgProgram] = [
    require('./models/M3USource'),
    require('./models/XtreamSource'),
    require('./models/EpgProgram'),
  ];
  const [m3uSources, xtreamSources, programs, epgChannels] = await Promise.all([
    M3USource.find().select('status syncStatus lastSyncAt lastError').lean(),
    XtreamSource.find().select('status syncStatus lastSyncAt lastError').lean(),
    EpgProgram.countDocuments(),
    EpgProgram.distinct('channelEpgId').then((ids) => ids.length),
  ]);
  const m3uHealth = summarizeSourceHealth(m3uSources);
  const xtreamHealth = summarizeSourceHealth(xtreamSources);
  details.sources = {
    m3uActive: m3uHealth.active,
    xtreamActive: xtreamHealth.active,
    m3u: m3uHealth,
    xtream: xtreamHealth,
  };
  details.epg = { programs, channels: epgChannels };

  try {
    const { schedulerService } = require('./services/scheduler-service');
    const tasks = await schedulerService.getTasksWithStatus();
    details.scheduler.tasks = tasks.map((task) => ({
      name: task.name,
      displayName: task.displayName,
      intervalMs: task.intervalMs,
      isRunning: task.isRunning,
      nextRunAt: task.nextRunAt,
      lastRun: task.lastRun
        ? {
            status: task.lastRun.status,
            startedAt: task.lastRun.startedAt,
            completedAt: task.lastRun.completedAt,
            durationMs: task.lastRun.durationMs,
            error: task.lastRun.error ? redactSensitiveText(task.lastRun.error) : null,
          }
        : null,
    }));
  } catch (error) {
    details.scheduler.error = redactSensitiveText(error);
  }
  return details;
}

// Liveness never depends on MongoDB or Redis and is suitable for process probes.
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), requestId: req.requestId });
});

// Readiness requires MongoDB; Redis is optional for this application.
app.get('/health/ready', (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'degraded',
    mongodb: ready ? 'connected' : 'disconnected',
    redis: isRedisReady() ? 'connected' : 'disconnected',
    requestId: req.requestId,
  });
});

// Health check. The public payload is intentionally minimal (audit-remediation-v1):
// connectivity/uptime details are operational data and are only exposed with
// ?details=true (for internal monitoring); the anonymous endpoint shows just
// enough to confirm the service is alive and which build is running.
app.get('/health', async (req, res) => {
  const healthy = mongoose.connection.readyState === 1;
  const response = {
    status: healthy ? 'ok' : 'degraded',
    version: process.env.APP_VERSION || '0.0.0',
    requestId: req.requestId,
  };
  if (req.query.details === 'true') {
    try {
      let alertingConfigured = Boolean(String(process.env.ALERT_WEBHOOK_URL || '').trim());
      try {
        const AppSetting = require('./models/AppSetting').default || require('./models/AppSetting');
        const doc = await AppSetting.findOne({ key: 'alert_webhook_url' }).lean().exec();
        if (doc && String(doc.value || '').trim()) alertingConfigured = true;
      } catch {
        // env value already considered above
      }
      response.details = {
        uptime: process.uptime(),
        mongodb: healthy ? 'connected' : 'disconnected',
        redis: isRedisReady() ? 'connected' : 'disconnected',
        alertingConfigured,
        ...(await collectHealthDetails()),
      };
    } catch (error) {
      response.details = { error: redactSensitiveText(error) };
      response.status = 'degraded';
    }
  }
  res.status(healthy ? 200 : 503).json(response);
});

// Sentry error handler must come before the default error handler
app.use(Sentry.expressErrorHandler());

// Error handling middleware
app.use((err, req, res, _next) => {
  console.error(JSON.stringify({ level: 'error', requestId: req.requestId, message: redactSensitiveText(err) }));
  const status = err.status || 500;
  res.status(status).json({
    error: {
      message: status === 500 ? 'Internal Server Error' : err.message,
      status,
      requestId: req.requestId,
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Route not found',
      status: 404,
      requestId: req.requestId,
    },
  });
});

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dzhoof-iptv';
const PORT = process.env.PORT || 3000;
let httpServer = null;

/**
 * Connect to MongoDB, initialize background services, and start the HTTP server.
 * Kept behind the main-module guard so route-level tests can import `app` without
 * opening a database connection or listening on a real port.
 */
function startServer() {
  return mongoose
    .connect(MONGODB_URI, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    })
    .then(async () => {
      console.log('✅ Connected to MongoDB');
      getRedisClient();

      // Initialize Super Admin user
      const { initializeSuperAdmin } = require('./utils/initSuperAdmin');
      await initializeSuperAdmin();

      // Initialize optional test user (only if TEST_USER_USERNAME is set)
      const { initializeTestUser } = require('./utils/initTestUser');
      await initializeTestUser();

      // Load seed channels from JSON (YouTube Live + Prasar Bharati)
      const { initializeSeedChannels } = require('./utils/initSeedChannels');
      await initializeSeedChannels();

      // Initialize IPTV-org cache (populate from DB or fetch if empty)
      const { iptvOrgCacheService } = require('./services/iptv-org-cache');
      iptvOrgCacheService.initializeOnStartup().catch((err) => {
        console.error('iptv-org cache initialization failed:', err.message);
      });

      // Initialize EPG service (auto-fetch program guides)
      const { epgService } = require('./services/epg-service');
      epgService.initializeOnStartup().catch((err) => {
        console.error('EPG service initialization failed:', err.message);
      });

      // Initialize scheduler service (liveness checks, EPG refresh, cache refresh)
      // Only start interval timers if the external scheduler container is not running
      if (process.env.DISABLE_SCHEDULER !== 'true') {
        const { schedulerService } = require('./services/scheduler-service');
        schedulerService.start().catch((err) => {
          console.error('Scheduler service start failed:', err.message);
        });
      } else {
        console.log('[scheduler] Disabled — running in separate container');
      }

      // Start server
      httpServer = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📺 DZ HOOF Server v${process.env.APP_VERSION || '0.0.0'}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📧 Email provider: ${process.env.MAIL_PROVIDER || 'mailhog'}`);
      });
      return httpServer;
    })
    .catch((err) => {
      console.error('❌ MongoDB connection error:', err);
      process.exit(1);
    });
}

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`${signal} received: shutting down gracefully`);
  try {
    const { epgService } = require('./services/epg-service');
    epgService.stopBackgroundUpdates();
  } catch {
    /* ignore if not loaded */
  }
  try {
    const { schedulerService } = require('./services/scheduler-service');
    schedulerService.stop();
  } catch {
    /* ignore if not loaded */
  }
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
    console.log('HTTP server closed — no longer accepting connections');
  }
  await closeRedis();
  await mongoose.connection.close();
  console.log('MongoDB and Redis connections closed');
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
