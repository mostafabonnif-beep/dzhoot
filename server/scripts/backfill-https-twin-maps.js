// DZ HOOF backfill: ChannelFailoverMap rows A(primary, http://) -> B(https twin)
// for channels present on BOTH sources of the same panel (name/tvgId match).
// Run AFTER the https-backup code is deployed. Idempotent (upserts).
var A = ObjectId("6a84dce7f6a082630f39a9c3"); // Business Cloud NEO (catalog primary, http)
var B = ObjectId("6a958d8114e50c61a1fa8a61"); // neo 4k backup (https CDN twin)
var d = db.getSiblingDB("dzhoof-iptv");
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim();
}
var byKey = new Map();
var indexed = 0;
d.channels
  .find(
    { "metadata.xtreamSourceId": A },
    { channelId: 1, channelName: 1, tvgId: 1, _id: 1 },
  )
  .forEach(function (c) {
    var k = norm(c.tvgId) || norm(c.channelName);
    if (k && !byKey.has(k)) {
      byKey.set(k, c);
      indexed++;
    }
  });
var ops = [];
var scanned = 0;
var skipped = 0;
d.channels
  .find(
    { "metadata.xtreamSourceId": B },
    { channelId: 1, channelName: 1, tvgId: 1, metadata: 1, _id: 1 },
  )
  .forEach(function (b) {
    scanned++;
    var k = norm(b.tvgId) || norm(b.channelName);
    var a = k ? byKey.get(k) : null;
    if (!a) {
      skipped++;
      return;
    }
    var aStream = a.metadata && a.metadata.xtreamStreamId;
    var bStream = b.metadata && b.metadata.xtreamStreamId;
    if (aStream && bStream && String(aStream) === String(bStream)) {
      skipped++; // same underlying stream — no cross-account benefit
      return;
    }
    ops.push({
      updateOne: {
        filter: { channelRef: String(a.channelId), backupSourceId: B },
        update: {
          $set: {
            channelId: a._id,
            backupChannelName: String(b.channelName || "").slice(0, 300),
            backupStreamId: String(bStream == null ? "" : bStream),
            matchedBy: "name",
            enabled: true,
            priority: 10,
          },
        },
        upsert: true,
      },
    });
  });
var applied = 0;
while (ops.length) {
  var batch = ops.splice(0, 1000);
  var r = d.channelfailovermaps.bulkWrite(batch);
  applied += (r.upsertedCount || 0) + (r.modifiedCount || 0);
}
print("A-indexed=" + indexed + " B-scanned=" + scanned + " skipped=" + skipped + " maps-applied=" + applied);
