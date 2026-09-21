const express = require('express');
const mongoose = require('mongoose');
const { requireAuth, requireAdmin } = require('./auth');
const { isRedisReady, getRedisClient } = require('../services/redis');
const { isAllowedDownloadUrl, versionNameToCode, resolvePublishedRelease } = require('./app-update')._private;

// Admin diagnostics: /api/v1/admin/diagnostics
//
// A single, ordered list of checks with the evidence behind each verdict, so an
// operator can tell "the app can't update" from "the API is down" without reading
// logs. It reports booleans, counts, latencies and host names only: never a token,
// a connection string or a credential — including in failure messages, which carry
// the error name rather than its text (a driver message can embed the URI).
//
// Memory of the release rules it verifies:
//   - the update API advertises the newest candidate across *both* sources it serves
//     from — an active AppVersion row and the latest GitHub release — so diagnostics
//     resolves through the same `resolvePublishedRelease()` the device-facing
//     `/version` uses instead of reading the table itself. Reading only the table was
//     a false negative: production had 26 rows all `isActive: false` while `/version`
//     correctly advertised 1.3.10 straight from GitHub Releases, so the panel showed a
//     permanent red "no release published" on a healthy update path;
//   - a download URL is discarded unless it is HTTPS on an allowlisted host
//     (fail-closed), so a bad host silently disables updates;
//   - clients reject an artifact whose versionCode disagrees with its versionName.
//
// routes/admin.js already authenticates everything under /api/v1/admin/*, so only
// authenticate here when the request arrives unauthenticated (keeps the router safe
// on its own without a second session lookup); the admin role is always enforced.
const router = express.Router();

router.use((req, res, next) => (req.user ? next() : requireAuth(req, res, next)));
router.use(requireAdmin);

const PASS = 'pass';
const WARN = 'warn';
const FAIL = 'fail';

function check(id, title, status, detail) {
  return { id, title, status, detail };
}

/** Run a probe, keeping how long it took even when it throws. */
async function timed(fn) {
  const startedAt = Date.now();
  try {
    return { ok: true, value: await fn(), latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, errorName: (error && error.name) || 'Error', latencyMs: Date.now() - startedAt };
  }
}

function hostOf(url) {
  try {
    return new URL(String(url)).host;
  } catch {
    return null;
  }
}

function preview(value) {
  const text = String(value || '');
  if (text.length <= 16) return text || null;
  return `${text.slice(0, 12)}…`;
}

const NON_PRODUCTION = new Set(['production']);

/**
 * Why do customers see fewer channels than the database holds?
 *
 * This check exists because answering that question on 2026-09-20 took an SSH session and
 * an hour: the catalog held 31,868 shared channels while customers could see 2,235, and the
 * gap was entirely explainable — an admin had deleted an upstream source whose 16,706
 * channels kept pointing at the removed document (hidden by the verified-source gate),
 * 15,630 channels were deactivated by health verdicts, and the rest simply sat behind a
 * non-verified source. None of that was visible in any panel: the catalog just looked small.
 *
 * The counts are computed the same way the customer-facing reads compute them, so the
 * numbers here match what a customer receives. Read-only; a few aggregate counts over the
 * catalog, only ever served to an authenticated admin on the diagnostics page.
 */
async function catalogVisibilityCheck() {
  const startedAt = Date.now();
  try {
    const Channel = require('../models/Channel');
    const XtreamSource = require('../models/XtreamSource');
    const { verifiedXtreamChannelQuery } = require('../utils/verified-channel-query');

    const shared = { ownerId: null };
    const allSources = await XtreamSource.find({})
      .select('name status verificationStatus customerVisible directPlayback')
      .lean();
    const sourceIds = allSources.map((s) => String(s._id));
    const verifiedIds = allSources
      .filter(
        (s) =>
          (s.status === 'Active' && s.verificationStatus === 'verified') ||
          s.customerVisible === true ||
          s.directPlayback === true,
      )
      .map((s) => String(s._id));
    const unverifiedIds = sourceIds.filter((id) => !verifiedIds.includes(id));

    const [total, visible, inactive, orphaned, fromUnverified] = await Promise.all([
      Channel.countDocuments(shared),
      Channel.countDocuments(await verifiedXtreamChannelQuery(shared, { dedup: true })),
      Channel.countDocuments({ ...shared, isActive: false }),
      // Only channels that are still active: an orphaned channel that was deactivated is
      // already reported as deactivated, and counting it twice would keep this warning alive
      // forever after a deliberate cleanup (the DELETE handler in routes/admin-xtream-sources.js
      // deactivates a deleted source's channels and stamps metadata.orphanedAt).
      Channel.countDocuments({
        ...shared,
        'metadata.source': 'xtream',
        'metadata.xtreamSourceId': { $nin: sourceIds },
        isActive: { $ne: false },
      }),
      unverifiedIds.length
        ? Channel.countDocuments({ ...shared, 'metadata.xtreamSourceId': { $in: unverifiedIds } })
        : Promise.resolve(0),
    ]);

    const hidden = Math.max(0, total - visible);
    // The buckets overlap (an orphaned channel can also be deactivated), so they are listed
    // as contributing reasons rather than as a disjoint partition.
    const detail =
      `كتالوج مشترك ${total} قناة — يراها العميل ${visible}` +
      ` (مخفية ${hidden}؛ منها ${inactive} معطّلة بفحص الصحة، ${orphaned} تشير إلى مصدر محذوف، ${fromUnverified} من مصدر غير موثّق).`;

    if (total === 0) {
      // A warning, not a failure: a fresh install legitimately has an empty catalog, and
      // FAIL here would turn the endpoint's overall verdict red for reasons unrelated to
      // the infrastructure this page is meant to judge.
      return check('catalog_visibility', 'ما يراه العميل من الكتالوج', WARN, 'لا توجد قنوات مشتركة في قاعدة البيانات — استورد مصدرًا أولًا.');
    }
    if (visible === 0) {
      return check(
        'catalog_visibility',
        'ما يراه العميل من الكتالوج',
        FAIL,
        `${detail} المخفي الكامل يعني أن بوابة الرؤية ترفض كل قناة — راجع المصادر وحالة الفحص.`,
      );
    }
    // A deleted source that still owns channels is the silent case: nobody sees those
    // channels, and nothing in the UI says why. Warn even when the rest is healthy.
    if (orphaned > 0) {
      return check(
        'catalog_visibility',
        'ما يراه العميل من الكتالوج',
        WARN,
        `${detail} ${orphaned} قناة فعّالة تشير إلى مصدر محذوف ولن تظهر لأي عميل — أعِدها لمصدر قائم أو عطّلها.`,
      );
    }
    if (hidden > 0 && visible * 2 < total) {
      return check('catalog_visibility', 'ما يراه العميل من الكتالوج', WARN, `${detail} أكثر من نصف الكتالوج مخفي.`);
    }
    return check('catalog_visibility', 'ما يراه العميل من الكتالوج', PASS, detail);
  } catch (error) {
    return check(
      'catalog_visibility',
      'ما يراه العميل من الكتالوج',
      WARN,
      `تعذّر حساب رؤية الكتالوج (${(error && error.name) || 'Error'}) — ${Date.now() - startedAt}ms.`,
    );
  }
}

async function mongodbCheck() {
  const connected = mongoose.connection.readyState === 1;
  if (!connected) {
    return check('mongodb', 'قاعدة البيانات (MongoDB)', FAIL, 'الاتصال غير قائم — لن تعمل معظم الوظائف.');
  }
  const ping = await timed(() => mongoose.connection.db.admin().ping());
  if (!ping.ok) {
    return check('mongodb', 'قاعدة البيانات (MongoDB)', FAIL, `فشل اختبار الاستجابة (${ping.errorName}).`);
  }
  return check('mongodb', 'قاعدة البيانات (MongoDB)', PASS, `متصل — زمن الاستجابة ${ping.latencyMs} م.ث.`);
}

async function redisCheck() {
  if (!isRedisReady()) {
    return check('redis', 'Redis (اختياري)', WARN, 'غير متصل — التطبيق يعمل بدونه لكن الكاش وحدود المعدل ستعمل بالذاكرة المحلية.');
  }
  const client = getRedisClient();
  const ping = await timed(() => client.ping());
  if (!ping.ok) {
    return check('redis', 'Redis (اختياري)', WARN, `متصل لكن لا يستجيب (${ping.errorName}).`);
  }
  return check('redis', 'Redis (اختياري)', PASS, `متصل — زمن الاستجابة ${ping.latencyMs} م.ث.`);
}

function buildIdentityCheck(build) {
  if (!build.version || build.version === '0.0.0') {
    return check('build_identity', 'هوية البناء', FAIL, 'APP_VERSION غير معرّف — لا يمكن مطابقة ما يعمل الآن مع أي إصدار في Git.');
  }
  if (!build.commit) {
    return check('build_identity', 'هوية البناء', WARN, `الإصدار ${build.version} بلا RELEASE_COMMIT — يتعذّر تتبّع البناء إلى commit.`);
  }
  return check('build_identity', 'هوية البناء', PASS, `الإصدار ${build.version} مبني من ${String(build.commit).slice(0, 8)}.`);
}

/**
 * Resolve what devices are actually offered, through the same resolver `/version`
 * uses, then verify that artifact is installable.
 *
 * The source is deliberately not the AppVersion table alone: the update API also
 * serves straight from the latest GitHub release, and GitHub is where production
 * actually publishes. Asking the resolver is what stops this probe from reporting a
 * release outage that no device experiences. A provider failure with no database
 * fallback throws inside the resolver, so it is caught here and reported as the
 * failure it is — diagnostics must always answer, never 500.
 */
async function releaseChecks(req) {
  let resolved = null;
  let resolutionFailed = false;
  try {
    resolved = await resolvePublishedRelease(req);
  } catch {
    resolutionFailed = true;
  }

  const latest = (resolved && resolved.latest) || null;
  if (!latest) {
    return {
      latest: null,
      checks: [
        check(
          'release_published',
          'إصدار منشور',
          FAIL,
          resolutionFailed
            ? 'تعذّر تحديد أي إصدار: لا سجل مُفعَّل في قاعدة البيانات، ومصدر GitHub غير متاح — الأجهزة لن ترى أي تحديث.'
            : 'لا يوجد أي إصدار منشور — لا سجل مُفعَّل ولا إصدار على GitHub. كل الأجهزة ستحصل على «لا يوجد تحديث».'
        ),
      ],
    };
  }

  const checks = [];
  const label = `${latest.versionName} (${latest.versionCode})`;
  const source = latest.source === 'github' ? 'GitHub Releases' : 'سجل قاعدة البيانات';
  checks.push(
    check('release_published', 'إصدار منشور', PASS, `أحدث إصدار منشور: ${label} — المصدر ${source} — قناة ${latest.releaseChannel || 'stable'}.`)
  );

  const missing = [];
  if (!latest.sha256) missing.push('sha256');
  if (!latest.apkFileName) missing.push('اسم الملف');
  if (!(Number(latest.apkFileSize) > 0)) missing.push('حجم الملف');
  if (!latest.downloadUrl) missing.push('رابط التحميل');
  checks.push(
    missing.length
      ? check('release_artifact_complete', 'اكتمال بيانات الـartifact', FAIL, `ينقص: ${missing.join('، ')} — الأجهزة ترفض التثبيت بلا تحقق كامل.`)
      : check('release_artifact_complete', 'اكتمال بيانات الـartifact', PASS, `sha256 ${preview(latest.sha256)}، الحجم ${Number(latest.apkFileSize)} بايت، الملف ${latest.apkFileName}.`)
  );

  const url = String(latest.downloadUrl || '');
  const isHttps = url.startsWith('https://');
  let hostAllowed = false;
  try {
    hostAllowed = isAllowedDownloadUrl(url, { protocol: 'https', headers: {}, get: () => '' });
  } catch {
    hostAllowed = false;
  }
  if (!url) {
    checks.push(check('release_download_url', 'رابط التحميل', FAIL, 'لا يوجد رابط تحميل — التحديث مستحيل.'));
  } else if (!isHttps) {
    checks.push(check('release_download_url', 'رابط التحميل', FAIL, 'الرابط ليس HTTPS — سيُستبعد، والتحديث سيتعطّل.'));
  } else if (!hostAllowed) {
    checks.push(
      check('release_download_url', 'رابط التحميل', FAIL, `مضيف الرابط (${hostOf(url) || 'غير معروف'}) خارج القائمة المسموحة — أضفه إلى APP_UPDATE_ALLOWED_HOSTS.`)
    );
  } else {
    checks.push(check('release_download_url', 'رابط التحميل', PASS, `${hostOf(url)} — HTTPS ومضيفه مسموح.`));
  }

  const derived = versionNameToCode(latest.versionName);
  checks.push(
    Number(derived) > 0 && Number(latest.versionCode) === Number(derived)
      ? check('release_version_code', 'تطابق versionCode', PASS, `${latest.versionCode} مطابق للاشتقاق من ${latest.versionName}.`)
      : check(
          'release_version_code',
          'تطابق versionCode',
          WARN,
          `versionCode=${latest.versionCode} لا يطابق الاشتقاق ${derived} من ${latest.versionName} — الأجهزة ترفض هذا الـartifact.`
        )
  );

  const configured = String(process.env.APP_UPDATE_ALLOWED_HOSTS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const publicBase = String(process.env.PUBLIC_BASE_URL || '').trim();
  checks.push(
    configured.length || publicBase
      ? check('update_allowlist', 'قائمة مضيفي التحديث', PASS, `${configured.length} مضيف مُعرَّف صراحة${publicBase ? ' + PUBLIC_BASE_URL' : ''}.`)
      : check('update_allowlist', 'قائمة مضيفي التحديث', WARN, 'APP_UPDATE_ALLOWED_HOSTS و PUBLIC_BASE_URL غير معرَّفين — يعتمد التحقق على مضيفات GitHub ومضيف الطلب فقط.')
  );

  return {
    latest,
    checks,
  };
}

async function schedulerCheck() {
  if (process.env.DISABLE_SCHEDULER === 'true') {
    return check('scheduler', 'المجدول', WARN, 'المجدول معطَّل في هذه العملية (DISABLE_SCHEDULER=true).');
  }
  const probe = await timed(async () => {
    const { schedulerService } = require('../services/scheduler-service');
    return schedulerService.getTasksWithStatus();
  });
  if (!probe.ok) {
    return check('scheduler', 'المجدول', WARN, `تعذّر قراءة حالة المهام (${probe.errorName}).`);
  }
  const tasks = probe.value || [];
  const failed = tasks.filter((task) => task.lastRun && task.lastRun.status === 'failed');
  if (failed.length) {
    return check('scheduler', 'المجدول', FAIL, `${failed.length} من ${tasks.length} مهمة فشل تشغيلها الأخير (${failed.map((task) => task.displayName || task.name).join('، ')}).`);
  }
  return check('scheduler', 'المجدول', PASS, `${tasks.length} مهمة، ولا فشل في آخر تشغيل.`);
}

function summarize(checks) {
  if (checks.some((entry) => entry.status === FAIL)) return FAIL;
  if (checks.some((entry) => entry.status === WARN)) return WARN;
  return PASS;
}

function environmentCheck() {
  const env = process.env.NODE_ENV || 'development';
  return NON_PRODUCTION.has(env)
    ? check('environment', 'بيئة التشغيل', PASS, `الإنتاج (${env}).`)
    : check('environment', 'بيئة التشغيل', WARN, `البيئة الحالية ${env} — ليست إنتاجًا.`);
}

/**
 * GET /api/v1/admin/diagnostics
 * Admin only. Never cached: it is a point-in-time probe.
 */
router.get('/', async (req, res) => {
  try {
    const build = {
      version: process.env.APP_VERSION || '0.0.0',
      commit: process.env.RELEASE_COMMIT || null,
      builtAt: process.env.RELEASE_BUILT_AT || null,
    };

    const [mongoResult, redisResult, releaseResult, schedulerResult, catalogResult] = await Promise.all([
      mongodbCheck(),
      redisCheck(),
      releaseChecks(req),
      schedulerCheck(),
      catalogVisibilityCheck(),
    ]);

    const checks = [
      buildIdentityCheck(build),
      environmentCheck(),
      mongoResult,
      redisResult,
      ...releaseResult.checks,
      schedulerResult,
      catalogResult,
    ];

    const latest = releaseResult.latest;
    res.set('Cache-Control', 'no-store');
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      overall: summarize(checks),
      server: {
        version: build.version,
        commit: build.commit,
        builtAt: build.builtAt,
        environment: process.env.NODE_ENV || 'development',
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
      },
      release: latest
        ? {
            versionName: latest.versionName || null,
            versionCode: latest.versionCode ?? null,
            releaseChannel: latest.releaseChannel || null,
            distribution: latest.distribution || null,
            sha256Preview: preview(latest.sha256),
            downloadUrlHost: hostOf(latest.downloadUrl),
            publishedAt: latest.releasedAt || latest.createdAt || null,
          }
        : {
            versionName: null,
            versionCode: null,
            releaseChannel: null,
            distribution: null,
            sha256Preview: null,
            downloadUrlHost: null,
            publishedAt: null,
          },
      checks,
    });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', requestId: req.requestId, message: 'diagnostics failed', name: error && error.name }));
    res.status(500).json({ error: { message: 'Internal Server Error', status: 500, requestId: req.requestId } });
  }
});

module.exports = router;
module.exports._private = { summarize, preview, hostOf, catalogVisibilityCheck, PASS, WARN, FAIL };
