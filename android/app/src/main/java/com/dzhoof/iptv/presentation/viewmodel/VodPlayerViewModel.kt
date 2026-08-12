package com.dzhoof.iptv.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.repository.CatalogRepository
import com.dzhoof.iptv.presentation.ui.player.PlayerFactory
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch


data class VodPlayerUiState(
    val playbackUrl: String? = null,
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class VodPlayerViewModel @Inject constructor(
    private val catalogRepository: CatalogRepository,
    private val playerFactory: PlayerFactory,
) : ViewModel() {
    private val _uiState = MutableStateFlow(VodPlayerUiState())
    val uiState: StateFlow<VodPlayerUiState> = _uiState.asStateFlow()

    private var contentType: String = ""
    private var contentId: String = ""
    private var refreshJob: Job? = null
    private var refreshAttempts = 0

    fun createPlayer(): ExoPlayer {
        val player = playerFactory.create()
        player.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                refreshPlaybackUrl()
            }
        })
        return player
    }

    fun start(contentType: String, contentId: String) {
        if (this.contentType == contentType && this.contentId == contentId && _uiState.value.playbackUrl != null) return
        this.contentType = contentType
        this.contentId = contentId
        refreshAttempts = 0
        requestPlaybackUrl(isInitial = true)
    }

    fun retry() {
        refreshAttempts = 0
        requestPlaybackUrl(isInitial = false)
    }

    private fun refreshPlaybackUrl() {
        if (refreshJob?.isActive == true || contentId.isBlank() || refreshAttempts >= 2) return
        refreshAttempts += 1
        requestPlaybackUrl(isInitial = false)
    }

    private fun requestPlaybackUrl(isInitial: Boolean) {
        refreshJob?.cancel()
        refreshJob = viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = isInitial,
                isRefreshing = !isInitial,
                error = null,
            )
            when (val result = catalogRepository.authorizePlayback(contentType, contentId)) {
                is Result.Success -> _uiState.value = VodPlayerUiState(
                    playbackUrl = result.data.url,
                    isLoading = false,
                    isRefreshing = false,
                )
                is Result.Error -> _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    isRefreshing = false,
                    error = result.exception.message ?: "Unable to authorize playback",
                )
            }
        }
    }
}
