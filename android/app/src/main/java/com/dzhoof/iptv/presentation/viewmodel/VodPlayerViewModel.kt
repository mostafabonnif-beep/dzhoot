package com.dzhoof.iptv.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.repository.CatalogRepository
import com.dzhoof.iptv.domain.repository.PlaybackRepository
import com.dzhoof.iptv.presentation.ui.player.PlayerFactory
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch


data class VodPlayerUiState(
    val playbackUrl: String? = null,
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val resumePositionMs: Long = 0L,
    val error: String? = null,
)

@HiltViewModel
class VodPlayerViewModel @Inject constructor(
    private val catalogRepository: CatalogRepository,
    private val playbackRepository: PlaybackRepository,
    private val playerFactory: PlayerFactory,
) : ViewModel() {
    private val _uiState = MutableStateFlow(VodPlayerUiState())
    val uiState: StateFlow<VodPlayerUiState> = _uiState.asStateFlow()

    private var contentType: String = ""
    private var contentId: String = ""
    private var refreshJob: Job? = null
    private var refreshAttempts = 0
    private var progressJob: Job? = null
    private var currentPlayer: ExoPlayer? = null

    fun createPlayer(): ExoPlayer {
        val player = playerFactory.create()
        currentPlayer = player
        player.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                progressJob?.cancel()
                refreshPlaybackUrl()
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) startProgressSaver(player) else progressJob?.cancel()
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_ENDED) {
                    progressJob?.cancel()
                    viewModelScope.launch { playbackRepository.deletePlaybackPosition(progressKey()) }
                }
            }
        })
        return player
    }

    fun start(contentType: String, contentId: String) {
        if (this.contentType == contentType && this.contentId == contentId && _uiState.value.playbackUrl != null) return
        this.contentType = contentType
        this.contentId = contentId
        refreshAttempts = 0
        progressJob?.cancel()
        viewModelScope.launch {
            val saved = playbackRepository.getPlaybackPosition(progressKey()).first()
            val position = (saved as? Result.Success)?.data ?: 0L
            _uiState.value = _uiState.value.copy(resumePositionMs = position)
        }
        requestPlaybackUrl(isInitial = true)
    }

    fun retry() {
        refreshAttempts = 0
        requestPlaybackUrl(isInitial = false)
    }

    private fun progressKey(): String = "vod:${contentType.lowercase()}:$contentId"

    private fun startProgressSaver(player: ExoPlayer) {
        if (progressJob?.isActive == true) return
        progressJob = viewModelScope.launch {
            while (isActive) {
                delay(10_000)
                val duration = player.duration.takeIf { it > 0 } ?: 0L
                val position = player.currentPosition.coerceAtLeast(0L)
                if (position > 0L) {
                    playbackRepository.savePlaybackPosition(progressKey(), position, duration)
                }
            }
        }
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
                is Result.Success -> _uiState.value = _uiState.value.copy(
                    playbackUrl = result.data.url,
                    isLoading = false,
                    isRefreshing = false,
                    error = null,
                )
                is Result.Error -> _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    isRefreshing = false,
                    error = result.exception.message ?: "تعذر تفويض تشغيل المحتوى",
                )
            }
        }
    }

    fun saveCurrentProgress() {
        val player = currentPlayer ?: return
        if (contentId.isBlank()) return
        val duration = player.duration.takeIf { it > 0 } ?: 0L
        val position = player.currentPosition.coerceAtLeast(0L)
        if (position > 0L) {
            viewModelScope.launch { playbackRepository.savePlaybackPosition(progressKey(), position, duration) }
        }
    }

    override fun onCleared() {
        progressJob?.cancel()
        currentPlayer = null
        super.onCleared()
    }
}
