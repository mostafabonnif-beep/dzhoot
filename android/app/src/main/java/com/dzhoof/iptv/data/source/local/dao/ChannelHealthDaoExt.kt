package com.dzhoof.iptv.data.source.local.dao

import android.util.Log
import com.dzhoof.iptv.data.source.local.entity.ChannelHealthEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch

/**
 * A [ChannelHealthDao.getAllHealth] that cannot take a screen down with it.
 *
 * Health rows are supplementary: they only decorate a channel with a score badge.
 * Every ViewModel combined that flow with the channel list, and a Room failure
 * (corruption, a full disk, a closed database) escaped the `combine` into the
 * `viewModelScope.launch` that collected it — an unhandled coroutine exception,
 * i.e. a crash, over data the user does not even need to see the list.
 *
 * The channel-list flows already degrade this way internally (`.catch { emit(Result.Error) }`);
 * this is the same contract for the health side: log once and continue with no
 * health data instead of failing.
 */
fun ChannelHealthDao.getAllHealthResilient(): Flow<List<ChannelHealthEntity>> =
    getAllHealth().catch { error ->
        Log.w(TAG, "channel_health read failed; continuing without health data", error)
        emit(emptyList())
    }

private const val TAG = "ChannelHealthDao"
