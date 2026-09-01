package com.dzhoof.iptv

import android.content.Context
import android.media.tv.TvContract
import android.media.tv.TvInputManager
import android.media.tv.TvInputService
import android.net.Uri
import android.util.Log
import android.view.Surface
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import com.dzhoof.iptv.data.AppPreferences
import com.dzhoof.iptv.data.model.dto.PlaybackTokenRequest
import com.dzhoof.iptv.data.source.remote.DzhoofApiService
import com.dzhoof.iptv.data.source.remote.playlist.StreamUrlTemplate
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import javax.inject.Inject

/**
 * Fire TV / Android TV input service.
 *
 * The server strips raw upstream URLs from TV channel lists, so in paired mode
 * (server URL + TV code configured) every tune must request a short-lived
 * server playback token — the same contract the in-app player uses. Direct
 * `channelUrl` playback remains the fallback for local/unpaired setups.
 */
@AndroidEntryPoint
class DzhoofTvInputService : TvInputService() {

    @Inject
    lateinit var apiService: DzhoofApiService

    override fun onCreateSession(inputId: String): Session {
        return DzhoofSession(this)
    }

    @OptIn(UnstableApi::class)
    private inner class DzhoofSession(
        private val ctx: Context
    ) : TvInputService.Session(ctx) {

        private var player: ExoPlayer? = null
        private var currentSurface: Surface? = null
        private var currentVolume: Float = 1.0f
        private val tuneScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

        override fun onSetSurface(surface: Surface?): Boolean {
            currentSurface = surface
            player?.setVideoSurface(surface)
            return true
        }

        override fun onSetStreamVolume(volume: Float) {
            currentVolume = volume
            player?.volume = volume
        }

        override fun onTune(channelUri: Uri): Boolean {
            Log.d(TAG, "onTune: $channelUri")
            notifyVideoUnavailable(TvInputManager.VIDEO_UNAVAILABLE_REASON_TUNING)

            val channelMeta = getChannelMeta(channelUri)
            if (channelMeta == null) {
                Log.e(TAG, "No channel metadata found for: $channelUri")
                player?.release()
                player = null
                notifyVideoUnavailable(TvInputManager.VIDEO_UNAVAILABLE_REASON_UNKNOWN)
                return false
            }

            // Release existing player
            player?.release()

            val exoPlayer = ExoPlayer.Builder(ctx).build().apply {
                setVideoSurface(currentSurface)
                volume = currentVolume
                playWhenReady = true

                addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(playbackState: Int) {
                        if (playbackState == Player.STATE_READY && isPlaying) {
                            notifyVideoAvailable()
                            Log.d(TAG, "Video available for: $channelUri")
                        }
                    }

                    override fun onIsPlayingChanged(isPlaying: Boolean) {
                        if (isPlaying) {
                            notifyVideoAvailable()
                        }
                    }

                    override fun onPlayerError(error: PlaybackException) {
                        Log.e(TAG, "Player error: ${error.message}", error)
                        notifyVideoUnavailable(TvInputManager.VIDEO_UNAVAILABLE_REASON_UNKNOWN)
                    }
                })
            }

            player = exoPlayer

            val serverUrl = AppPreferences.getServerUrl(ctx).trimEnd('/')
            val tvCode = AppPreferences.getTvCode(ctx)
            val paired = serverUrl.isNotBlank() && tvCode.isNotEmpty() && channelMeta.channelId.isNotEmpty()
            if (paired) {
                // Paired mode: request a short-lived server playback token. The
                // direct upstream URL is intentionally absent for TV clients.
                tuneScope.launch {
                    try {
                        val response = apiService.issuePlaybackToken(
                            PlaybackTokenRequest(channelId = channelMeta.channelId),
                        )
                        val body = response.body()
                        val playbackUrl = body?.data?.playbackUrl
                        if (response.isSuccessful && body?.success == true && !playbackUrl.isNullOrBlank()) {
                            exoPlayer.setMediaItem(MediaItem.fromUri(playbackUrl))
                            exoPlayer.prepare()
                        } else {
                            Log.e(TAG, "Playback token request failed: HTTP ${response.code()} ${body?.error}")
                            notifyVideoUnavailable(TvInputManager.VIDEO_UNAVAILABLE_REASON_UNKNOWN)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Playback token request error", e)
                        notifyVideoUnavailable(TvInputManager.VIDEO_UNAVAILABLE_REASON_UNKNOWN)
                    }
                }
            } else {
                val streamUrl = channelMeta.channelUrl
                if (streamUrl == null) {
                    Log.e(TAG, "No stream URL for unpaired channel: $channelUri")
                    notifyVideoUnavailable(TvInputManager.VIDEO_UNAVAILABLE_REASON_UNKNOWN)
                } else {
                    exoPlayer.setMediaItem(MediaItem.fromUri(StreamUrlTemplate.resolve(ctx, streamUrl)))
                    exoPlayer.prepare()
                }
            }
            return true
        }

        override fun onSetCaptionEnabled(enabled: Boolean) {}

        override fun onRelease() {
            Log.d(TAG, "Session released")
            tuneScope.cancel()
            player?.release()
            player = null
            currentSurface = null
        }

        private fun getChannelMeta(channelUri: Uri): ChannelMeta? {
            val projection = arrayOf(TvContract.Channels.COLUMN_INTERNAL_PROVIDER_DATA)

            return try {
                ctx.contentResolver.query(channelUri, projection, null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val internalData = cursor.getString(0)
                        val json = JSONObject(internalData ?: "{}")
                        ChannelMeta(
                            channelId = json.optString("channelId"),
                            channelUrl = json.optString("channelUrl").takeIf { it.isNotEmpty() }
                                ?.let { StreamUrlTemplate.resolve(ctx, it) },
                        )
                    } else null
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error reading channel data from TIF", e)
                null
            }
        }
    }

    private data class ChannelMeta(
        val channelId: String,
        val channelUrl: String?,
    )

    companion object {
        private const val TAG = "DzhoofTvInput"
    }
}
