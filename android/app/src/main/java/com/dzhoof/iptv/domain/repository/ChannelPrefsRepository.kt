package com.dzhoof.iptv.domain.repository

import com.dzhoof.iptv.domain.model.ChannelPrefs
import kotlinx.coroutines.flow.Flow

/**
 * Repository for per-channel management preferences (hidden / locked).
 *
 * Local-only by design: these flags describe how *this* device's user wants
 * its channel list and playback gating to behave, so they are never pushed to
 * the server and survive channel-list syncs.
 */
interface ChannelPrefsRepository {

    /** Reactive set of channel ids currently hidden from browse lists. */
    fun observeHiddenIds(): Flow<Set<String>>

    /** Reactive set of channel ids currently locked behind the parental PIN. */
    fun observeLockedIds(): Flow<Set<String>>

    /** Reactive map of channelId → prefs for every channel that has any flag set. */
    fun observePrefs(): Flow<Map<String, ChannelPrefs>>

    /** Mark a channel hidden (true) or visible (false). */
    suspend fun setHidden(channelId: String, hidden: Boolean)

    /** Mark a channel locked (true) or unlocked (false). */
    suspend fun setLocked(channelId: String, locked: Boolean)

    /** Current hidden flag for a channel (false when no prefs row exists). */
    suspend fun isHidden(channelId: String): Boolean

    /** Current locked flag for a channel (false when no prefs row exists). */
    suspend fun isLocked(channelId: String): Boolean
}
