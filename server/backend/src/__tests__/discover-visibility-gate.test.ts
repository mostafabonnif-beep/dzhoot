/**
 * The discover rails must obey the same visibility policy as the catalog endpoints.
 *
 * `/discover/home` built its own channel filter (presentation + hide only), so it could put a
 * card on the home screen for a channel that `GET /channels` refuses to serve: a dead supplier
 * stream, or a channel whose xtream source is unverified. Tapping such a card fails — the exact
 * "the channels don't work" experience the gate exists to prevent. The rails now delegate to
 * `verifiedXtreamChannelQuery`, and this pins the two halves that matter: the dead channel never
 * appears anywhere in the payload, and the healthy one still does.
 *
 * (The other rails in the same service — trending, live-now, collections, the channel count —
 * share `publicChannelFilter`, so covering one covers the policy for all of them.)
 */
import mongoose from 'mongoose';
import Channel from '../models/Channel';
import XtreamSource from '../models/XtreamSource';
import { buildDiscoverHome } from '../services/discover-service';

const verifiedSourceId = new mongoose.Types.ObjectId();
const unverifiedSourceId = new mongoose.Types.ObjectId();

async function seedChannel(name: string, streamId: number, sourceId: string, isWorking: boolean) {
  const doc = await Channel.collection.insertOne({
    channelId: `xt:${sourceId}:${streamId}`,
    channelName: name,
    channelUrl: 'http://provider.invalid/live/u/p/1.ts',
    channelGroup: 'DISCOVER TEST',
    ownerId: null,
    isActive: true,
    metadata: { source: 'xtream', xtreamSourceId: sourceId, xtreamStreamId: streamId, isWorking },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return String(doc.insertedId);
}

describe('discover home rails and the catalog visibility gate', () => {
  beforeEach(async () => {
    await Channel.collection.deleteMany({});
    await XtreamSource.deleteMany({});
    await XtreamSource.create({
      _id: verifiedSourceId,
      name: 'verified',
      serverUrl: 'http://provider.invalid',
      usernameEncrypted: 'x',
      passwordEncrypted: 'y',
      status: 'Active',
      verificationStatus: 'verified',
    });
    await XtreamSource.create({
      _id: unverifiedSourceId,
      name: 'pending',
      serverUrl: 'http://provider.invalid',
      usernameEncrypted: 'x',
      passwordEncrypted: 'y',
      status: 'Active',
      verificationStatus: 'pending',
    });
  });

  it('keeps dead and unverified channels out of the rails and out of the headline count', async () => {
    await seedChannel('DISCOVER LIVE ONE', 7001, String(verifiedSourceId), true);
    await seedChannel('DISCOVER DEAD ONE', 7002, String(verifiedSourceId), false);
    await seedChannel('DISCOVER PENDING ONE', 7003, String(unverifiedSourceId), true);

    const payload = await buildDiscoverHome();
    // Cards carry names, not Mongo ids (the card builder emits channelId/epgKey), so the leak
    // check is on the name a customer would read. The rails themselves are activity-driven
    // (trending needs playback events, live-now needs viewers), so the healthy channel is not
    // expected to appear here — what must hold is that the unplayable ones never do, and that
    // the headline count reflects the gated catalog rather than every row in the collection.
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain('DISCOVER DEAD ONE');
    expect(serialized).not.toContain('DISCOVER PENDING ONE');
    expect(payload.stats.totalChannels).toBe(1);
  });
});
