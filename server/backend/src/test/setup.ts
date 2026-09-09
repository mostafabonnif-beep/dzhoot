// Pin NODE_ENV before ANY test file (and its top-level imports) loads in this
// worker. Several suites temporarily set NODE_ENV='production'; if such a value
// leaks to the next file that imports src/server.js at top level, the server's
// SECURITY_ENFORCED guard calls process.exit(1) at import time — the worker
// dies, jest silently retries the file in a fresh worker, and the run ends
// "all tests passed" yet exits 1 (seen on CI, order/cache dependent).
process.env.NODE_ENV = 'test';

import { createHash } from 'crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongoServer: MongoMemoryServer | undefined;
let usingExternalTestMongo = false;

function isolatedTestMongoUri(baseUri: string): string {
  const testPath = expect.getState().testPath || 'unknown-test';
  const databaseName = `dzhoof_test_${createHash('sha256').update(testPath).digest('hex').slice(0, 16)}`;
  const url = new URL(baseUri);
  url.pathname = `/${databaseName}`;
  url.search = '';
  return url.toString();
}

function requiresMongo(): boolean {
  const testPath = expect.getState().testPath || '';
  return !/\/(stream-session-service|playback-access-service|metrics|tv-pairing-log-safety)\.test\./.test(testPath);
}

beforeAll(async () => {
  if (!requiresMongo()) return;

  // CI can provide an isolated MongoDB service so tests do not depend on downloading
  // a MongoDB binary at runtime. Local development still falls back to MongoMemoryServer.
  const uri = process.env.TEST_MONGO_URI;
  if (uri) {
    usingExternalTestMongo = true;
    await mongoose.connect(isolatedTestMongoUri(uri));
  } else {
    mongoServer = await MongoMemoryServer.create({
      instance: {
        args: ['--wiredTigerCacheSizeGB', '0.25'],
      },
    });
    await mongoose.connect(mongoServer.getUri());
  }
  // Build schema indexes (incl. unique constraints) up front so tests that rely on
  // them — e.g. duplicate-key handling — are deterministic instead of racing the
  // background autoIndex build.
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
}, 60000);

afterAll(async () => {
  if (!mongoServer && !usingExternalTestMongo) return;
  if (usingExternalTestMongo && mongoose.connection.db) {
    await mongoose.connection.db.dropDatabase();
  }
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

afterEach(async () => {
  if (!mongoServer && !usingExternalTestMongo) return;
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});
