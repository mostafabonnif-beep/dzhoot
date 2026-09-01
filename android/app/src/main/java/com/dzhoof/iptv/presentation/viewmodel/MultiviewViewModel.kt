package com.dzhoof.iptv.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.exoplayer.ExoPlayer
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.model.dto.PlaybackTokenRequest
import com.dzhoof.iptv.data.source.remote.DzhoofApiService
import com.dzhoof.iptv.domain.model.Channel
import com.dzhoof.iptv.domain.usecase.GetChannelsUseCase
import com.dzhoof.iptv.presentation.ui.player.PlayerFactory
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Backs the multiview grid: exposes the first few channels and builds IPTV-tuned
 * players for each pane. Capped at [MAX_PANES] to stay within device decoder limits.
 */
@HiltViewModel
class MultiviewViewModel @Inject constructor(
    private val getChannelsUseCase: GetChannelsUseCase,
    private val playerFactory: PlayerFactory,
    private val apiService: DzhoofApiService,
) : ViewModel() {

    private val _channels = MutableStateFlow<List<Channel>>(emptyList())
    val channels: StateFlow<List<Channel>> = _channels.asStateFlow()

    init {
        viewModelScope.launch {
            getChannelsUseCase(Unit).collect { result ->
                if (result is Result.Success) {
                    // Full list — the screen picks how many panes to show and which
                    // channels fill them (via the layout selector + channel picker).
                    _channels.value = result.data
                }
            }
        }
    }

    fun createPlayer(): ExoPlayer = playerFactory.create()

    /**
     * Resolves a short-lived server playback URL for a pane. The server strips
     * raw upstream URLs from TV channel lists, so panes must go through the
     * same playback-token contract as the main player. Returns null when the
     * server cannot authorize playback (e.g. offline / unpaired).
     */
    suspend fun resolvePlaybackUrl(channelId: String): String? = try {
        val response = apiService.issuePlaybackToken(
            PlaybackTokenRequest(channelId = channelId),
        )
        val body = response.body()
        if (response.isSuccessful && body?.success == true) body.data?.playbackUrl else null
    } catch (_: Exception) {
        null
    }

    companion object {
        const val MAX_PANES = 4
    }
}
