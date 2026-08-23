/**
 * Backfill codeEnc (AES-256-GCM encrypted plaintext) for legacy activation
 * codes that only have a verification hash.
 *
 * Because legacy codes are stored hash-only, the plaintext cannot be recovered.
 * This script REGENERATES a fresh random code for every non-activated legacy
 * code (UNUSED / REVOKED / EXPIRED), updating its hash, last4, prefix and
 * encrypted copy — so the admin can view/manage it from the dashboard.
 *
 * ACTIVATED codes are intentionally left untouched: their redemption already
 * happened and the hash does not need to be recoverable.
 *
 * Usage:
 *   MONGODB_URI=mongodb://... npx tsx backend/scripts/backfill-code-enc.ts [--dry-run]
 */
import mongoose from 'mongoose';
import ActivationCode from '../src/models/ActivationCode';
import { encryptSecret } from '../src/utils/crypto';
import {
  generateActivationCode,
  normalizeActivationCode,
  hashActivationCode,
  codeLast4,
} from '../src/utils/code-generator';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }
  await mongoose.connect(uri);

  const legacy = await ActivationCode.find({
    status: { $in: ['UNUSED', 'REVOKED', 'EXPIRED'] },
    $or: [{ codeEnc: { $exists: false } }, { codeEnc: null }],
  }).lean();

  console.log(`Found ${legacy.length} legacy non-activated codes without a recoverable plaintext.`);

  let migrated = 0;
  for (const code of legacy) {
    // Regenerate a fresh code under the existing prefix.
    const fresh = generateActivationCode(code.prefix || 'DZHF');
    const hash = hashActivationCode(normalizeActivationCode(fresh));
    if (dryRun) {
      console.log(`[dry-run] would regenerate ${code.prefix}-••••-${code.codeLast4} -> ${fresh}`);
      continue;
    }
    await ActivationCode.updateOne(
      { _id: code._id },
      {
        $set: {
          codeHash: hash,
          codeLast4: codeLast4(fresh),
          codeEnc: encryptSecret(fresh),
        },
      },
    );
    migrated += 1;
  }

  console.log(dryRun ? 'Dry run complete.' : `Migrated ${migrated} codes to recoverable form.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
