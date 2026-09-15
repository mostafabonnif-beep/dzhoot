import WatchProgress, { IWatchProgressDocument, WatchContentType } from '../models/WatchProgress';

export interface UpsertProgressInput {
  userId: string;
  contentId: string;
  contentType: WatchContentType;
  positionSec: number;
  durationSec?: number | null;
}

const MIN_RESUME_SEC = 10;
const COMPLETED_THRESHOLD_RATIO = 0.95;
const MAX_CONTINUE_WATCHING = 50;

/**
 * Upsert a single watch-progress row. Rows with position < MIN_RESUME_SEC
 * are ignored (too early to be useful for resume). Rows that reached >= 95%
 * of duration are marked completed (they drop out of Continue Watching).
 */
export async function upsertProgress(input: UpsertProgressInput): Promise<IWatchProgressDocument | null> {
  const { userId, contentId, contentType, positionSec, durationSec } = input;
  if (!userId || !contentId || !contentType) return null;
  if (!Number.isFinite(positionSec) || positionSec < 0) return null;

  const completed = durationSec != null && durationSec > 0
    ? positionSec >= durationSec * COMPLETED_THRESHOLD_RATIO
    : false;

  if (!completed && positionSec < MIN_RESUME_SEC) {
    // Too early to be a meaningful resume point — remove any stale row.
    await WatchProgress.deleteOne({ userId, contentId });
    return null;
  }

  const doc = await WatchProgress.findOneAndUpdate(
    { userId, contentId },
    {
      $set: {
        contentType,
        positionSec,
        durationSec: durationSec ?? null,
        completed,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Keep the per-user list bounded.
  if (!completed) {
    const excess = await WatchProgress.countDocuments({ userId, completed: false });
    if (excess > MAX_CONTINUE_WATCHING) {
      const toRemove = await WatchProgress.find({ userId, completed: false })
        .sort({ updatedAt: -1 })
        .skip(MAX_CONTINUE_WATCHING)
        .select('_id');
      if (toRemove.length > 0) {
        await WatchProgress.deleteMany({ _id: { $in: toRemove.map((r) => r._id) } });
      }
    }
  }

  return doc;
}

/** Continue Watching list: active (not completed), most recent first. */
export async function listContinueWatching(userId: string, limit = 20): Promise<IWatchProgressDocument[]> {
  return WatchProgress.find({ userId, completed: false })
    .sort({ updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 50));
}

/** Single-row lookup for resume. */
export async function getProgress(userId: string, contentId: string): Promise<IWatchProgressDocument | null> {
  return WatchProgress.findOne({ userId, contentId });
}

/** Remove a row (user dismissed it or finished it). */
export async function removeProgress(userId: string, contentId: string): Promise<boolean> {
  const res = await WatchProgress.deleteOne({ userId, contentId });
  return res.deletedCount > 0;
}

/** Clear the whole list for a user. */
export async function clearProgress(userId: string): Promise<number> {
  const res = await WatchProgress.deleteMany({ userId });
  return res.deletedCount ?? 0;
}
