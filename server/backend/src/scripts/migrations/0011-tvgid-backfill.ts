/**
 * Migration 0011 — Backfill empty channel tvgId from the Xtream provider's
 * epg_channel_id.
 *
 * Why: channels imported before tvgId-backfill existed have an empty tvgId, so
 * they can never match an EPG programme (EPG coverage was ~7%). The Xtream
 * panel already exposes epg_channel_id per live stream; this migration fetches
 * the live-stream list once per ACTIVE xtream source and fills ONLY channels
 * whose tvgId is still blank — operator-assigned tvgIds are never touched.
 *
 * Safe to re-run (idempotent). Run with:
 *   npm run migrate:tvgid-backfill
 */
import mongoose from 'mongoose';
import XtreamSource from '../../models/XtreamSource';
import Channel from '../../models/Channel';
import { buildXtreamApiUrl } from '../../services/xtream-service';
import { decryptSecret } from '../../utils/crypto';
import axios from 'axios';

const BATCH = 500;

async function backfillSource(source: any): Promise<{ scanned: number; filled: number }> {
  const creds = {
    serverUrl: source.serverUrl,
    username: decryptSecret(source.usernameEncrypted),
    password: decryptSecret(source.passwordEncrypted),
  };
  const url = buildXtreamApiUrl(creds, 'get_live_streams');
  const res = await axios.get(url, { timeout: 120000 });
  const streams = Array.isArray(res.data) ? res.data : [];

  const tvgByStreamId = new Map<string, string>();
  for (const item of streams) {
    const tvg = String(item?.epg_channel_id || '').trim();
    if (tvg) tvgByStreamId.set(String(item.stream_id), tvg);
  }

  let filled = 0;
  const sourceId = String(source._id);
  // Only channels of this source whose tvgId is blank.
  const cursor = Channel.find({
    ownerId: null,
    'metadata.xtreamSourceId': sourceId,
    $or: [{ tvgId: { $exists: false } }, { tvgId: '' }, { tvgId: null }],
  })
    .select('channelId metadata.xtreamStreamId tvgId')
    .lean()
    .cursor();

  let bulk: any[] = [];
  for await (const ch of cursor as any) {
    const streamId = String(ch?.metadata?.xtreamStreamId || '');
    const tvg = tvgByStreamId.get(streamId);
    if (!tvg) continue;
    bulk.push({ updateOne: { filter: { _id: ch._id }, update: { $set: { tvgId: tvg } } } });
    if (bulk.length >= BATCH) {
      const r = await (Channel as any).bulkWrite(bulk);
      filled += r.modifiedCount || 0;
      bulk = [];
    }
  }
  if (bulk.length) {
    const r = await (Channel as any).bulkWrite(bulk);
    filled += r.modifiedCount || 0;
  }
  return { scanned: streams.length, filled };
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dzhoof-iptv';
  await mongoose.connect(uri);
  const sources = await XtreamSource.find({ status: 'Active' }).lean();
  console.log(`[tvgid-backfill] ${sources.length} active xtream source(s)`);
  for (const source of sources) {
    try {
      const { scanned, filled } = await backfillSource(source);
      console.log(`[tvgid-backfill] ${source.name}: scanned=${scanned} filled=${filled}`);
    } catch (err: any) {
      console.error(`[tvgid-backfill] ${source.name} failed: ${err?.message || err}`);
    }
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[tvgid-backfill] fatal:', err?.message || err);
  process.exit(1);
});
