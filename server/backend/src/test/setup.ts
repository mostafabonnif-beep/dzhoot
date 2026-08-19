import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongoServer: MongoMemoryServer | undefined;

function requiresMongo(): boolean {
  const testPath = expect.getState().testPath || '';
  return !/\/(stream-session-service|playback-access-service)\.test\./.test(testPath);
}

beforeAll(async () => {
  if (!requiresMongo()) return;
  mongoServer = await MongoMemoryServer.create({
    instance: {
      args: ['--wiredTigerCacheSizeGB', '0.25'],
    },
  });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  // Build schema indexes (incl. unique constraints) up front so tests that rely on
  // them — e.g. duplicate-key handling — are deterministic instead of racing the
  // background autoIndex build.
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
}, 60000);

afterAll(async () => {
  if (!mongoServer) return;
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  if (!mongoServer) return;
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});
