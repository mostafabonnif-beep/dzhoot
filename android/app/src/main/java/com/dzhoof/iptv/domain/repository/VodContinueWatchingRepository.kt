package com.dzhoof.iptv.domain.repository

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.model.VodContinueWatchingItem
import kotlinx.coroutines.flow.Flow

/**
 * Continue Watching for on-demand content: the local resume positions, each
 * resolved into something renderable.
 *
 * Reads only the local `playback_positions` table and the catalog — never the
 * watch-progress API. Cross-device rows arrive in that same table through
 * [WatchProgressSyncRepository], so the rail is device-independent without this
 * repository knowing anything about the network.
 *
 * Resolution is best-effort per item: a title that the provider has dropped
 * resolves to nothing and is skipped, because a missing poster must not blank the
 * whole row.
 */
interface VodContinueWatchingRepository {

    /**
     * Emits the resumable on-demand items, most recently watched first.
     *
     * @param limit how many local rows to consider (the most recent ones)
     */
    fun observeItems(limit: Int = 20): Flow<Result<List<VodContinueWatchingItem>>>
}
