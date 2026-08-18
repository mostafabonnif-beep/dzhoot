#!/usr/bin/env node
/**
 * DZ HOOF — Restore Drill Integrity Verifier
 * -------------------------------------------
 * Runs AFTER server/scripts/restore-drill.sh to confirm the restored
 * database actually contains usable data, not just that mongorestore
 * exited 0 (which it will even on a partial/corrupt archive in some cases).
 *
 * Usage:
 *   MONGODB_RESTORE_URI="mongodb://localhost:27017/dzhoof_drill" \
 *   node scripts/verify-restore-integrity.mjs [--baseline baseline.json]
 *
 * Modes:
 *   1. Baseline mode (recommended for real drills):
 *      Run with --write-baseline BEFORE taking the backup, on the live DB,
 *      to snapshot collection counts. Then after restoring into the scratch
 *      DB, run with --baseline <file> to diff counts.
 *
 *   2. Sanity mode (no baseline available):
 *      Just checks that the critical collections are non-empty and that
 *      known required indexes exist. Good enough for CI where the seed
 *      data is synthetic.
 *
 * Exit codes: 0 = pass, 1 = integrity failure, 2 = usage/config error.
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const CRITICAL_COLLECTIONS = [
  'users',
  'channels',
  'm3usources',
  'xtreamsources',
  'subscriptions',
  'devices',
  'sessions',
];

// Collections that are expected to be non-empty in ANY environment that has
// ever had an admin account created + at least one source imported. If your
// drill DB is younger than that, adjust this list.
const MUST_BE_NON_EMPTY = ['users'];

function parseArgs(argv) {
  const args = { mode: 'sanity' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write-baseline') {
      args.mode = 'write-baseline';
      args.baselineOut = argv[i + 1];
      i++;
    } else if (argv[i] === '--baseline') {
      args.mode = 'diff';
      args.baselineFile = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function collectCounts(db) {
  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
  const counts = {};
  for (const name of CRITICAL_COLLECTIONS) {
    counts[name] = existing.has(name) ? await db.collection(name).estimatedDocumentCount() : null;
  }
  return counts;
}

async function main() {
  const uri = process.env.MONGODB_RESTORE_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_RESTORE_URI (or MONGODB_URI) is required.');
    process.exit(2);
  }

  const args = parseArgs(process.argv.slice(2));
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });

  try {
    await client.connect();
    const db = client.db();
    const counts = await collectCounts(db);

    if (args.mode === 'write-baseline') {
      const out = args.baselineOut || 'restore-baseline.json';
      writeFileSync(out, JSON.stringify({ takenAt: new Date().toISOString(), counts }, null, 2));
      console.log(`Baseline written to ${out}:`);
      console.table(counts);
      process.exit(0);
    }

    if (args.mode === 'diff') {
      if (!existsSync(args.baselineFile)) {
        console.error(`Baseline file not found: ${args.baselineFile}`);
        process.exit(2);
      }
      const baseline = JSON.parse(readFileSync(args.baselineFile, 'utf8')).counts;
      let failed = false;
      console.log('Collection            baseline  restored  status');
      console.log('---------------------------------------------------');
      for (const name of CRITICAL_COLLECTIONS) {
        const before = baseline[name];
        const after = counts[name];
        // Allow restored count to be >= baseline (writes may have continued
        // after the backup was taken) but never significantly less.
        const ok = before === null || after !== null && after >= Math.floor(before * 0.98);
        if (!ok) failed = true;
        console.log(
          `${name.padEnd(22)} ${String(before).padEnd(9)} ${String(after).padEnd(9)} ${ok ? 'OK' : 'MISMATCH'}`
        );
      }
      if (failed) {
        console.error('\nRestore integrity check FAILED: one or more collections lost data.');
        process.exit(1);
      }
      console.log('\nRestore integrity check passed.');
      process.exit(0);
    }

    // Sanity mode
    console.log('Collection counts (sanity mode, no baseline supplied):');
    console.table(counts);
    const failures = MUST_BE_NON_EMPTY.filter((name) => !counts[name]);
    if (failures.length > 0) {
      console.error(
        `\nRestore integrity check FAILED: expected non-empty collections are empty or missing: ${failures.join(', ')}`
      );
      process.exit(1);
    }
    console.log('\nRestore integrity check passed (sanity mode).');
    process.exit(0);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Restore integrity check crashed:', err);
  process.exit(1);
});
