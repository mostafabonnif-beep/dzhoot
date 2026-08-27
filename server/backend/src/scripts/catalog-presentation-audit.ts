/**
 * Customer catalog presentation audit and soft-archive tool.
 *
 * This deliberately never deletes a Channel document or its source/right metadata.
 * The default mode only writes a JSON report containing identifiers and reasons; it
 * never emits stream URLs, credentials, logo URLs, or raw channel labels.
 *
 * Usage (from server/backend):
 *   npx tsx src/scripts/catalog-presentation-audit.ts
 *   npx tsx src/scripts/catalog-presentation-audit.ts --report /secure/path/catalog-audit.json
 *   npx tsx src/scripts/catalog-presentation-audit.ts --apply --confirm
 *
 * Before --apply: take and verify a MongoDB backup, review the report, and obtain
 * the designated operator's change approval. --apply only sets isActive=false;
 * source provenance and audit history remain intact for authorized review.
 */
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';

require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

import Channel from '../models/Channel';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dzhoof-iptv';
const APPLY = process.argv.includes('--apply');
const CONFIRM = process.argv.includes('--confirm');
const reportFlagIndex = process.argv.indexOf('--report');
const REPORT_PATH = reportFlagIndex >= 0 && process.argv[reportFlagIndex + 1]
  ? path.resolve(process.cwd(), process.argv[reportFlagIndex + 1])
  : path.resolve(process.cwd(), `catalog-presentation-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

const HASH_MARKER = /#{3,}/u;
const UPSTREAM_NAME_MARKER = /(?:^|[\s|_-])neo(?:[\s|_-]|$)/iu;
const DISPLAY_FIELDS = ['channelName', 'tvgName', 'channelGroup', 'channelImg', 'tvgLogo'];

function reasonsFor(channel: Record<string, unknown>): string[] {
  const reasons = new Set<string>();
  for (const field of DISPLAY_FIELDS) {
    const value = typeof channel[field] === 'string' ? channel[field] : '';
    if (HASH_MARKER.test(value)) reasons.add('decorative-hash-marker');
    if (UPSTREAM_NAME_MARKER.test(value)) reasons.add('upstream-name-marker');
  }
  return [...reasons].sort();
}

async function run(): Promise<void> {
  if (APPLY && !CONFIRM) {
    throw new Error('Refusing to write: use both --apply and --confirm after reviewing a backup and report.');
  }

  await mongoose.connect(MONGODB_URI);
  const candidates = await Channel.find({
    ownerId: null,
    $or: DISPLAY_FIELDS.flatMap((field) => [
      { [field]: HASH_MARKER },
      { [field]: UPSTREAM_NAME_MARKER },
    ]),
  }, { _id: 1, channelId: 1, isActive: 1, channelName: 1, tvgName: 1, channelGroup: 1, channelImg: 1, tvgLogo: 1 }).lean();

  const entries = candidates.map((candidate: any) => ({
    id: String(candidate._id),
    channelId: typeof candidate.channelId === 'string' ? candidate.channelId : null,
    isActive: candidate.isActive !== false,
    reasons: reasonsFor(candidate),
  }));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    scope: 'shared catalog only (ownerId: null)',
    action: APPLY ? 'soft archive (isActive=false)' : 'no database writes',
    matchedCount: entries.length,
    activeMatchedCount: entries.filter((entry) => entry.isActive).length,
    entries,
    operatorNotes: [
      'No source URLs, credentials, raw display labels, or source metadata are included in this report.',
      'The customer API independently filters these channels before any archive is approved.',
      'This operation does not delete documents or remove provenance/rights data.',
    ],
  };

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(REPORT_PATH, 0o600);

  if (APPLY && entries.length > 0) {
    const ids = entries.filter((entry) => entry.isActive).map((entry) => new mongoose.Types.ObjectId(entry.id));
    const result = ids.length > 0
      ? await Channel.updateMany({ _id: { $in: ids } }, { $set: { isActive: false } })
      : { modifiedCount: 0 };
    console.log(`Soft-archived ${result.modifiedCount} shared catalog channels. Report: ${REPORT_PATH}`);
  } else {
    console.log(`Dry-run complete: ${entries.length} shared catalog channels matched. Report: ${REPORT_PATH}`);
  }

  await mongoose.connection.close();
}

run().catch(async (error) => {
  console.error('Catalog presentation audit failed:', error instanceof Error ? error.message : error);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
