package com.dzhoof.iptv.data.source.local.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import com.dzhoof.iptv.data.source.local.entity.ChannelPrefsEntity
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for per-channel preference flags (hidden / locked).
 *
 * Tables are decoupled from `channels` (no FK) so a channel sync that replaces
 * every row never cascades into user prefs. Prefs for channels that disappear
 * from the playlist are simply orphaned until the channel returns — Room
 * boolean columns are stored as INTEGER 0/1, so filters use `= 1`.
 */
@Dao
interface ChannelPrefsDao {

    /** Insert or update a channel's prefs row (one row per channel). */
    @Upsert
    suspend fun upsert(entity: ChannelPrefsEntity)

    /** Update only the hidden flag of an existing row (no-op when absent). */
    @Query("UPDATE channel_prefs SET hidden = :hidden WHERE channelId = :channelId")
    suspend fun setHidden(channelId: String, hidden: Boolean)

    /** Update only the locked flag of an existing row (no-op when absent). */
    @Query("UPDATE channel_prefs SET locked = :locked WHERE channelId = :channelId")
    suspend fun setLocked(channelId: String, locked: Boolean)

    /** Remove a channel's prefs row entirely (both flags back to default). */
    @Query("DELETE FROM channel_prefs WHERE channelId = :channelId")
    suspend fun delete(channelId: String)

    /** Observe every prefs row. */
    @Query("SELECT * FROM channel_prefs")
    fun observeAll(): Flow<List<ChannelPrefsEntity>>

    /** Observe ids of channels currently marked hidden. */
    @Query("SELECT channelId FROM channel_prefs WHERE hidden = 1")
    fun observeHiddenIds(): Flow<List<String>>

    /** Observe ids of channels currently marked locked. */
    @Query("SELECT channelId FROM channel_prefs WHERE locked = 1")
    fun observeLockedIds(): Flow<List<String>>

    /** Fetch a single channel's prefs synchronously (null = defaults). */
    @Query("SELECT * FROM channel_prefs WHERE channelId = :channelId")
    suspend fun get(channelId: String): ChannelPrefsEntity?
}
