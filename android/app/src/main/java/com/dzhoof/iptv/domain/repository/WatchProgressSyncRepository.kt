package com.dzhoof.iptv.domain.repository

import com.dzhoof.iptv.data.model.Result

/**
 * Mirrors the local resume positions (`playback_positions`) to the account so
 * Continue Watching follows the viewer across devices.
 *
 * The local Room table stays the single source of truth for the UI: pushes are
 * fire-and-forget and a pull only ever fills gaps or replaces an older local
 * row. Nothing here can block playback, and every failure is swallowed into a
 * [Result.Error] the caller may ignore — an offline TV must behave exactly as it
 * did before this existed.
 *
 * Requirements: US-004.4 (playback position saved and restored)
 */
interface WatchProgressSyncRepository {

    /**
     * Queues a mirror of one local position. Never suspends on the caller and
     * never throws: the local write has already succeeded by the time this runs.
     *
     * @param localKey the `playback_positions.channelId` key (`vod:movie:<id>` or a channel id)
     * @param positionMs position in MILLISECONDS (converted to seconds for the wire)
     * @param durationMs total duration in MILLISECONDS, 0 when unknown (live TV)
     */
    fun enqueueSave(localKey: String, positionMs: Long, durationMs: Long)

    /** Queues removal of one position (finished, or the viewer dismissed it). */
    fun enqueueDelete(localKey: String)

    /**
     * Fetches the account's Continue Watching list and merges it into the local
     * table, newest wins.
     *
     * @return the number of local rows created, updated or removed.
     */
    suspend fun pullIntoLocal(limit: Int = 20): Result<Int>
}
