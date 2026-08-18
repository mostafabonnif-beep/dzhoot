#!/usr/bin/env node
/**
 * DZ HOOF — Restore Drill Seed Data
 * ----------------------------------
 * Inserts a small, synthetic dataset into the "source" database used by the
 * scheduled restore-drill workflow, so the drill has something real to back
 * up and restore. Never run this against a production MONGODB_URI — it is
 * only intended for the disposable CI database service.
 *
 * Usage: MONGODB_URI="mongodb://localhost:27017/dzhoof_drill_source" node scripts/seed-drill-data.mjs
 */
import { MongoClient, ObjectId } from 'mongodb';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required.');
    process.exit(2);
  }
  if (!/drill|test|scratch|local/i.test(uri)) {
    console.error('Refusing to seed: MONGODB_URI does not look like a drill/test database.');
    process.exit(2);
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();

    await db.collection('users').deleteMany({});
    await db.collection('channels').deleteMany({});
    await db.collection('m3usources').deleteMany({});
    await db.collection('subscriptions').deleteMany({});

    await db.collection('users').insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        _id: new ObjectId(),
        email: `drill-user-${i}@example.test`,
        role: i === 0 ? 'admin' : 'user',
        createdAt: new Date(),
      }))
    );

    const source = { _id: new ObjectId(), name: 'Drill Test Source', type: 'm3u', createdAt: new Date() };
    await db.collection('m3usources').insertOne(source);

    await db.collection('channels').insertMany(
      Array.from({ length: 20 }, (_, i) => ({
        _id: new ObjectId(),
        name: `Drill Channel ${i}`,
        sourceId: source._id,
        category: i % 3 === 0 ? 'news' : i % 3 === 1 ? 'sports' : 'entertainment',
        createdAt: new Date(),
      }))
    );

    await db.collection('subscriptions').insertMany(
      Array.from({ length: 3 }, (_, i) => ({
        _id: new ObjectId(),
        plan: 'trial',
        status: 'active',
        createdAt: new Date(),
      }))
    );

    console.log('Seeded drill database with synthetic users/channels/sources/subscriptions.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
