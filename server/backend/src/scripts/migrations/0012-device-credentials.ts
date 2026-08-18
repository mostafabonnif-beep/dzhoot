import mongoose from 'mongoose';
import Device from '../../models/Device';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(uri);
  const result = await Device.updateMany(
    { credentialVersion: { $exists: false } },
    { $set: { credentialVersion: 1, credentialRevokedAt: null } },
  );
  console.log(`Backfilled ${result.modifiedCount} device credential records`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
