package com.dzhoof.iptv.data.source.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.dzhoof.iptv.data.source.local.entity.ChannelHealthEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ChannelHealthDao {

    @Query("SELECT * FROM channel_health")
    fun getAllHealth(): Flow<List<ChannelHealthEntity>>

    @Query("SELECT * FROM channel_health WHERE channelId = :channelId")
    fun getHealthByChannelId(channelId: String): Flow<ChannelHealthEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(health: ChannelHealthEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(health: List<ChannelHealthEntity>)

    /**
     * Upsert health fields while preserving the existing thumbnailPath.
     * Uses a subquery to carry forward the thumbnail before REPLACE deletes the row.
     */
    @Query("""
        INSERT OR REPLACE INTO channel_health
            (channelId, status, lastCheckedAt, responseTimeMs, errorMessage, thumbnailPath)
        VALUES (
            :channelId, :status, :lastCheckedAt, :responseTimeMs, :errorMessage,
            (SELECT thumbnailPath FROM channel_health WHERE channelId = :channelId)
        )
    """)
    suspend fun upsertPreservingThumbnail(
        channelId: String,
        status: String,
        lastCheckedAt: Long,
        responseTimeMs: Long?,
        errorMessage: String?
    )

    @Query("""
        SELECT c.id FROM channels c
        LEFT JOIN channel_health h ON c.id = h.channelId
        WHERE c.isActive = 1
        ORDER BY COALESCE(h.lastCheckedAt, 0) ASC
        LIMIT :limit
    """)
    suspend fun getStaleChannelIds(limit: Int): List<String>

    @Query("""
        SELECT c.id FROM channels c
        LEFT JOIN channel_health h ON c.id = h.channelId
        WHERE c.isActive = 1
        ORDER BY COALESCE(h.lastCheckedAt, 0) ASC
    """)
    suspend fun getAllChannelIdsByPriority(): List<String>

    @Query("SELECT channelId FROM channel_health WHERE status = 'ONLINE' AND thumbnailPath IS NULL")
    suspend fun getOnlineChannelIdsWithoutThumbnail(): List<String>

    /**
     * Upsert thumbnail path — creates a row if none exists yet (e.g., health scan
     * hasn't run for this channel), preserving any existing health fields.
     */
    @Query("""
        INSERT OR REPLACE INTO channel_health
            (channelId, status, lastCheckedAt, responseTimeMs, errorMessage, thumbnailPath)
        VALUES (
            :channelId,
            COALESCE((SELECT status FROM channel_health WHERE channelId = :channelId), 'UNKNOWN'),
            COALESCE((SELECT lastCheckedAt FROM channel_health WHERE channelId = :channelId), 0),
            (SELECT responseTimeMs FROM channel_health WHERE channelId = :channelId),
            (SELECT errorMessage FROM channel_health WHERE channelId = :channelId),
            :path
        )
    """)
    suspend fun updateThumbnailPath(channelId: String, path: String)

    @Query("SELECT thumbnailPath FROM channel_health WHERE thumbnailPath IS NOT NULL")
    suspend fun getAllThumbnailPaths(): List<String>

    @Query("UPDATE channel_health SET thumbnailPath = NULL")
    suspend fun clearAllThumbnailPaths()

    @Query("SELECT COUNT(*) FROM channels WHERE isActive = 1")
    suspend fun getTotalActiveChannelCount(): Int

    @Query("SELECT COUNT(*) FROM channel_health WHERE status != 'UNKNOWN'")
    suspend fun getScannedChannelCount(): Int

    @Query("DELETE FROM channel_health")
    suspend fun deleteAll()

    @Query("DELETE FROM channel_health WHERE channelId NOT IN (SELECT id FROM channels)")
    suspend fun cleanupOrphaned()

    /**
     * Channels in [categoryId] whose last recorded status was OFFLINE **within the
     * window starting at [since]**.
     *
     * The window matters: an OFFLINE mark is written on every playback failure and was
     * previously counted forever, so a burst of unrelated transient failures (flaky free
     * M3U stream, expired token, concurrent-stream limit, one bad network) accumulated
     * until half the category looked dead and the player blamed the source provider. Bounding
     * both counts to the same window makes the verdict describe *now* and self-heal.
     */
    @Query("""
        SELECT COUNT(*) FROM channel_health h
        INNER JOIN channels c ON c.id = h.channelId
        WHERE c.categoryId = :categoryId AND h.status = 'OFFLINE'
          AND h.lastCheckedAt >= :since
    """)
    suspend fun getOfflineCountByCategory(categoryId: String, since: Long): Int

    /**
     * Channels in [categoryId] with a real (non-UNKNOWN) status **within the window
     * starting at [since]** — the denominator for the category-wide verdict. Must use the
     * same window as [getOfflineCountByCategory] or the ratio is meaningless.
     */
    @Query("""
        SELECT COUNT(*) FROM channel_health h
        INNER JOIN channels c ON c.id = h.channelId
        WHERE c.categoryId = :categoryId AND h.status != 'UNKNOWN'
          AND h.lastCheckedAt >= :since
    """)
    suspend fun getScannedCountByCategory(categoryId: String, since: Long): Int
}
