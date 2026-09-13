/**
 * Verify that what the update API serves matches the provenance manifest of the APK
 * that was actually published.
 *
 * Why: the release job (`scripts/ci/write-release-manifest.sh`) records the identity of
 * the artifact it uploaded — versionName, versionCode, size, sha256 — and the update API
 * serves its own view of the newest active release. Nothing forced the two to agree: a
 * hand-edited row, a re-pointed URL or a stale release could leave devices downloading
 * bytes the reviewed manifest never described. This compares them field by field and
 * exits non-zero on any disagreement, so it can gate a deploy or a publish.
 *
 * It is read-only and talks only to the public update endpoint, so it needs no admin
 * session and no database access.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/verify-release-provenance.ts \
 *     --manifest ./dzhoof-tv-v1.4.2-official.release.json \
 *     --api https://iptv.ld-11.net
 *
 * Options:
 *   --manifest <path>   required; the release.json produced by the release workflow
 *   --api <baseUrl>     required (or DZHOOF_API_URL / PUBLIC_BASE_URL)
 *   --platform <name>   default android-tv; sent as the client platform
 *   --timeout <ms>      default 15000
 *
 * Exit codes: 0 every field agrees, 1 a field disagrees, 2 the input was unusable.
 */

export interface ReleaseManifest {
  schemaVersion?: number;
  packageName?: string;
  versionName?: string;
  versionCode?: number;
  releaseChannel?: string;
  distribution?: string;
  apkFileName?: string;
  sizeBytes?: number;
  sha256?: string;
  signerSha256?: string;
  minSdk?: number;
  targetSdk?: number;
  commit?: string;
  builtAt?: string;
}

/** The subset of `latestVersion` this check compares (see routes/app-update.js). */
export interface ServedRelease {
  versionName?: string | null;
  versionCode?: number | null;
  releaseChannel?: string | null;
  distribution?: string | null;
  downloadUrl?: string | null;
  sha256?: string | null;
  sizeBytes?: number | null;
  apkFileName?: string | null;
}

export interface FieldComparison {
  field: string;
  manifest: string | number | null;
  served: string | number | null;
  match: boolean;
  note?: string;
}

const REQUIRED_FIELDS: (keyof ReleaseManifest)[] = [
  'versionName',
  'versionCode',
  'releaseChannel',
  'distribution',
  'apkFileName',
  'sizeBytes',
  'sha256',
];

/**
 * Rejects a manifest that cannot prove an artifact's identity. Fails closed: a manifest
 * missing its checksum or size must never be treated as "verified".
 */
export function parseManifest(raw: unknown): ReleaseManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('manifest is not an object');
  }
  const manifest = raw as ReleaseManifest;
  const missing = REQUIRED_FIELDS.filter((field) => {
    const value = manifest[field];
    return value === undefined || value === null || value === '';
  });
  if (missing.length) {
    throw new Error(`manifest is missing required field(s): ${missing.join(', ')}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(String(manifest.sha256))) {
    throw new Error('manifest sha256 is not a 64-character hex digest');
  }
  if (!(Number(manifest.versionCode) > 0)) {
    throw new Error('manifest versionCode is not a positive number');
  }
  if (!(Number(manifest.sizeBytes) > 0)) {
    throw new Error('manifest sizeBytes is not a positive number');
  }
  return manifest;
}

function normalizeSha(value: unknown): string | null {
  const match = String(value || '')
    .toLowerCase()
    .match(/[a-f0-9]{64}/);
  return match ? match[0] : null;
}

function fileNameOf(url: unknown): string | null {
  try {
    const parsed = new URL(String(url));
    const name = parsed.pathname.split('/').filter(Boolean).pop();
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Field-by-field comparison. Pure: no I/O, so every verdict is testable.
 *
 * `apkFileName` is compared through the served download URL, because the API's contract
 * is the URL a device will fetch — a URL that names a different file is a real mismatch
 * even when every other field agrees.
 */
export function compareManifestToServed(manifest: ReleaseManifest, served: ServedRelease): FieldComparison[] {
  const comparisons: FieldComparison[] = [
    {
      field: 'versionName',
      manifest: manifest.versionName ?? null,
      served: served.versionName ?? null,
      match: String(manifest.versionName) === String(served.versionName),
    },
    {
      field: 'versionCode',
      manifest: Number(manifest.versionCode),
      served: served.versionCode === null || served.versionCode === undefined ? null : Number(served.versionCode),
      match: Number(manifest.versionCode) === Number(served.versionCode),
    },
    {
      field: 'sha256',
      manifest: normalizeSha(manifest.sha256),
      served: normalizeSha(served.sha256),
      match: normalizeSha(manifest.sha256) !== null && normalizeSha(manifest.sha256) === normalizeSha(served.sha256),
      ...(served.sha256 ? {} : { note: 'the API served no checksum, so a device cannot verify the download' }),
    },
    {
      field: 'sizeBytes',
      manifest: Number(manifest.sizeBytes),
      served: served.sizeBytes === null || served.sizeBytes === undefined ? null : Number(served.sizeBytes),
      match: Number(manifest.sizeBytes) === Number(served.sizeBytes),
    },
    {
      field: 'releaseChannel',
      manifest: manifest.releaseChannel ?? null,
      served: served.releaseChannel ?? null,
      match: String(manifest.releaseChannel) === String(served.releaseChannel),
    },
    {
      field: 'distribution',
      manifest: manifest.distribution ?? null,
      served: served.distribution ?? null,
      match: String(manifest.distribution) === String(served.distribution),
    },
  ];

  const servedFileName = fileNameOf(served.downloadUrl);
  comparisons.push({
    field: 'apkFileName (via downloadUrl)',
    manifest: manifest.apkFileName ?? null,
    served: servedFileName ?? (served.downloadUrl ? served.downloadUrl : null),
    match:
      servedFileName !== null &&
      served.downloadUrl !== null &&
      served.downloadUrl !== undefined &&
      String(servedFileName) === String(manifest.apkFileName),
    ...(served.downloadUrl
      ? {}
      : { note: 'the API served no downloadUrl (off-allowlist or non-HTTPS), so devices cannot download at all' }),
  });

  return comparisons;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = 'true';
    }
  }
  return args;
}

/** The shape of `GET /api/v1/app/version` that this check reads. */
interface VersionPayload {
  success?: boolean;
  updateAvailable?: boolean;
  latestVersion?: ServedRelease | null;
  message?: string;
}

interface VerifyOptions {  manifestPath: string;
  apiBaseUrl: string;
  platform?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

export interface VerifyResult {
  ok: boolean;
  comparisons: FieldComparison[];
  server?: { version?: string | null; commit?: string | null; builtAt?: string | null };
  served?: ServedRelease;
}

/**
 * Fetches what a device would receive and compares it with the manifest.
 * Throws only for unusable input; a plain mismatch is reported through `ok: false`.
 */
export async function verifyReleaseProvenance(options: VerifyOptions): Promise<VerifyResult> {
  const doFetch = options.fetchImpl || fetch;
  const log = options.log || (() => {});
  const platform = options.platform || 'android-tv';
  const timeoutMs = options.timeoutMs || 15000;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  if (!fs.existsSync(options.manifestPath)) {
    throw new Error(`manifest not found: ${options.manifestPath}`);
  }
  const manifest = parseManifest(JSON.parse(fs.readFileSync(options.manifestPath, 'utf8')));

  const base = options.apiBaseUrl.replace(/\/+$/, '');
  // Ask as a device one code below the published build, so the API offers this exact
  // release instead of answering "up to date".
  const probeCode = Math.max(1, Number(manifest.versionCode) - 1);
  const query =
    `&channel=${encodeURIComponent(String(manifest.releaseChannel))}` +
    `&platform=${encodeURIComponent(platform)}`;
  // `currentVersionCode` is the contract name; deployments still running the pre-contract
  // build only accept `currentVersion`. Try the contract first, then fall back, so this
  // tool works against both rather than reporting a false failure.
  const urls = [
    `${base}/api/v1/app/version?currentVersionCode=${probeCode}${query}`,
    `${base}/api/v1/app/version?currentVersion=${probeCode}${query}`,
  ];

  let payload: VersionPayload | null = null;
  let lastError: Error | null = null;
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (response.ok) {
        payload = (await response.json()) as VersionPayload;
        break;
      }
      const body = await response.text().catch(() => '');
      lastError = new Error(
        `the update API answered HTTP ${response.status} for ${url}${body ? ` — ${body.slice(0, 200)}` : ''}`
      );
      // Only a parameter rejection justifies the fallback; any other status is real.
      if (response.status !== 400) break;
    } catch (error) {
      lastError = error as Error;
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  if (!payload) {
    throw lastError || new Error('the update API could not be reached');
  }

  if (!payload.latestVersion) {
    throw new Error(
      `the update API served no release to compare (${payload.message || 'latestVersion is null'}) — ` +
        'the artifact is not reachable by devices'
    );
  }

  const comparisons = compareManifestToServed(manifest, payload.latestVersion);
  const ok = comparisons.every((comparison) => comparison.match);

  let server: VerifyResult['server'];
  try {
    const healthResponse = await doFetch(`${base}/health/version`, { headers: { accept: 'application/json' } });
    if (healthResponse.ok) {
      const health = (await healthResponse.json()) as { version?: string; commit?: string; builtAt?: string };
      server = { version: health.version ?? null, commit: health.commit ?? null, builtAt: health.builtAt ?? null };
    }
  } catch {
    // Context only — a server that does not answer /health/version is not a mismatch.
  }

  log(`manifest ${options.manifestPath}`);
  log(`api      ${base}`);
  log('');
  for (const comparison of comparisons) {
    log(
      `${comparison.match ? 'OK  ' : 'FAIL'} ${comparison.field.padEnd(28)} manifest=${String(comparison.manifest)} served=${String(comparison.served)}`
    );
    if (comparison.note) log(`     ↳ ${comparison.note}`);
  }
  log('');
  if (server) {
    log(`server build: version=${server.version} commit=${server.commit} builtAt=${server.builtAt}`);
  }
  log(ok ? 'RESULT: the API serves exactly the artifact this manifest describes.' : 'RESULT: MISMATCH — do not deploy/publish until this is resolved.');

  return { ok, comparisons, server, served: payload.latestVersion };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args.manifest;
  const apiBaseUrl = args.api || process.env.DZHOOF_API_URL || process.env.PUBLIC_BASE_URL;

  if (!manifestPath || !apiBaseUrl) {
    console.error(
      'usage: npx tsx src/scripts/verify-release-provenance.ts --manifest <release.json> --api <https://host> [--platform android-tv]'
    );
    process.exit(2);
  }

  try {
    const result = await verifyReleaseProvenance({
      manifestPath,
      apiBaseUrl,
      platform: args.platform,
      timeoutMs: args.timeout ? Number(args.timeout) : undefined,
      log: (line) => console.log(line),
    });
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(`verification could not run: ${(error as Error).message}`);
    process.exit(2);
  }
}

if (require.main === module) {
  run();
}
