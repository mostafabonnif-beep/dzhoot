package com.dzhoof.iptv.domain.usecase

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.model.PlaybackState
import com.dzhoof.iptv.domain.repository.PlaybackRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject

/**
 * Use case for retrieving playback position.
 *
 * Retrieves the saved playback position for a channel so users
 * can resume watching from where they left off.
 *
 * Requirements: US-004.4 (Playback position saved and restored)
 */
class GetPlaybackPositionUseCase @Inject constructor(
    private val playbackRepository: PlaybackRepository
) : FlowUseCase<String, Result<PlaybackState?>>() {

    override fun execute(params: String): Flow<Result<PlaybackState?>> {
        return playbackRepository.getPlaybackPosition(params).map { result ->
            when (result) {
                is Result.Success -> {
                    val position = result.data
                    if (position != null) {
                        Result.Success(PlaybackState(
                            channelId = params,
                            position = position,
                            duration = 0L,
                            isPlaying = false
                        ))
                    } else {
                        Result.Success(null)
                    }
                }
                is Result.Error -> Result.Error(result.exception)
            }
        }
    }
}
