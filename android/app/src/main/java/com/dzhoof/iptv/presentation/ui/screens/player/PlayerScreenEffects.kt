package com.dzhoof.iptv.presentation.ui.screens.player

import android.content.Context
import androidx.annotation.OptIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.source.MediaSource
import com.dzhoof.iptv.domain.model.PlaybackTarget
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.dzhoof.iptv.ComposeMainActivity
import com.dzhoof.iptv.PipController
import com.dzhoof.iptv.data.AppPreferences
import com.dzhoof.iptv.data.source.remote.playlist.StreamUrlTemplate
import com.dzhoof.iptv.presentation.model.ChannelUiModel
import com.dzhoof.iptv.presentation.ui.player.ErrorRecoveryManager
import com.dzhoof.iptv.presentation.ui.player.isTvDevice
import com.dzhoof.iptv.presentation.viewmodel.PlayerViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

private fun mediaItem(url: String, mimeType: String?): MediaItem {
    val builder = MediaItem.Builder().setUri(url)
    if (!mimeType.isNullOrBlank()) builder.setMimeType(mimeType)
    return builder.build()
}

/**
 * True when the server-described stream is HLS. Media3's
 * MimeTypes.APPLICATION_M3U8 constant is "application/x-mpegURL", while the
 * ecosystem (and older server builds) commonly send
 * "application/vnd.apple.mpegurl". A plain equals() against the constant
 * misses that and routes the playlist to the PROGRESSIVE extractor, which
 * sniffs the playlist text and dies instantly with
 * ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED — before fetching any segment.
 */
internal fun isHlsMimeType(mimeType: String): Boolean {
    val m = mimeType.trim().lowercase()
    return m.contains("mpegurl") || m.contains("m3u8") || m.contains("apple.streaming")
}

/**
 * Point the player at a channel: builds the live stream slots (primary +
 * alternates, each with an optional proxy fallback) or the Xtream catch-up
 * archive URL, arms the recovery manager, and prepares playback.
 * Returns false when the channel has no usable stream URL.
 */
@OptIn(UnstableApi::class)
internal suspend fun prepareChannelStream(
    context: Context,
    exoPlayer: ExoPlayer,
    errorRecoveryManager: ErrorRecoveryManager,
    channel: ChannelUiModel,
    catchupStartMs: Long,
    catchupDurationMin: Int,
    resolvePlaybackUrl: suspend (channelId: String, slot: Int, catchupStartMs: Long, catchupDurationMin: Int) -> PlaybackTarget?,
    buildHlsMediaSource: (url: String) -> MediaSource,
): Boolean {
    errorRecoveryManager.reset()
    val serverUrl = AppPreferences.getServerUrl(context).trimEnd('/')
    val tvCode = AppPreferences.getTvCode(context)
    val useTokenizedServerPlayback = serverUrl.isNotBlank() && tvCode.isNotEmpty()

    if (useTokenizedServerPlayback) {
        if (catchupStartMs > 0) {
            val catchupTarget = resolvePlaybackUrl(channel.id, 0, catchupStartMs, catchupDurationMin)
                ?: return false
            errorRecoveryManager.setStreamSlots(
                listOf(ErrorRecoveryManager.StreamSlot(catchupTarget.url, null, isPrimary = true, mimeType = catchupTarget.mimeType)),
            )
            exoPlayer.setMediaSource(buildHlsMediaSource(catchupTarget.url))
        } else {
            val slotTargets = coroutineScope {
                (0..3).map { slot ->
                    async { resolvePlaybackUrl(channel.id, slot, 0L, 0) }
                }.mapNotNull { it.await() }
            }
            val primaryTarget = slotTargets.firstOrNull() ?: return false
            val slots = slotTargets.mapIndexed { index, playbackTarget ->
                ErrorRecoveryManager.StreamSlot(
                    directUrl = playbackTarget.url,
                    // Server-relayed fallback for direct-mode sources: the
                    // recovery manager retries through it after direct fails.
                    proxyUrl = playbackTarget.proxyUrl,
                    isPrimary = index == 0,
                    mimeType = playbackTarget.mimeType,
                )
            }
            errorRecoveryManager.setStreamSlots(slots)
            // Server playback serves a normalized HLS media playlist for HLS
            // upstreams, but relays progressive MPEG-TS upstreams (e.g. the
            // backup source) as a raw TS stream. Force an explicit HLS source
            // only for HLS/null mime; otherwise hand the TS stream to the
            // progressive extractor via the server's mimeType hint. Forcing
            // HLS on a TS passthrough fails with
            // ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED ("تنسيق البث غير
            // متوافق") because HlsMediaSource never fetches a segment.
            val primaryMime = primaryTarget.mimeType
            if (primaryMime.isNullOrBlank() || isHlsMimeType(primaryMime)) {
                exoPlayer.setMediaSource(buildHlsMediaSource(primaryTarget.url))
            } else {
                exoPlayer.setMediaItem(
                    MediaItem.Builder()
                        .setUri(primaryTarget.url)
                        .setMimeType(primaryMime)
                        .build(),
                )
            }
        }
        exoPlayer.prepare()
        return true
    }

    val url = channel.streamUrl?.let { StreamUrlTemplate.resolve(context, it) }
    if (url.isNullOrEmpty()) return false

    // Local/demo playback may use its configured direct source. Paired server
    // playback always takes the tokenized branch above and never reaches here.
    val catchupUrl = if (catchupStartMs > 0) {
        buildCatchupUrl(context, channel.id, catchupStartMs, catchupDurationMin)
    } else null

    if (catchupUrl != null) {
        errorRecoveryManager.setStreamSlots(
            listOf(ErrorRecoveryManager.StreamSlot(catchupUrl, null, isPrimary = true)),
        )
        exoPlayer.setMediaItem(MediaItem.Builder().setUri(catchupUrl).build())
    } else {
        val slots = mutableListOf<ErrorRecoveryManager.StreamSlot>()
        slots.add(ErrorRecoveryManager.StreamSlot(url, null, isPrimary = true))
        channel.alternateStreamUrls.orEmpty().take(3).forEach { alternate ->
            val resolvedAlternate = StreamUrlTemplate.resolve(context, alternate).trim()
            if (resolvedAlternate.isNotEmpty() && resolvedAlternate != url) {
                slots.add(
                    ErrorRecoveryManager.StreamSlot(
                        resolvedAlternate,
                        null,
                        isPrimary = false,
                    ),
                )
            }
        }
        errorRecoveryManager.setStreamSlots(slots)
        exoPlayer.setMediaItem(MediaItem.Builder().setUri(url).build())
    }
    exoPlayer.prepare()
    return true
}

/**
 * Build an Xtream catch-up (timeshift) URL for a past program:
 * `{host}/timeshift/{user}/{pass}/{durationMin}/{yyyy-MM-dd:HH-mm}/{streamId}.m3u8`.
 * Returns null when the source isn't Xtream or credentials are missing.
 */
private fun buildCatchupUrl(
    context: Context,
    channelId: String,
    startMs: Long,
    durationMin: Int
): String? {
    if (!channelId.startsWith("xtream-")) return null
    val host = AppPreferences.getXtreamHost(context).trimEnd('/')
    val user = AppPreferences.getXtreamUser(context)
    val pass = AppPreferences.getXtreamPass(context)
    if (host.isBlank() || user.isBlank()) return null
    val streamId = channelId.removePrefix("xtream-")
    val duration = durationMin.coerceAtLeast(1)
    val start = java.time.Instant.ofEpochMilli(startMs)
        .atZone(java.time.ZoneOffset.UTC)
        .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd:HH-mm"))
    return "$host/timeshift/$user/$pass/$duration/$start/$streamId.m3u8"
}

/**
 * Playback listener lifecycle: buffering + play-state into the ViewModel,
 * PiP params refresh on mobile, thumbnail capture + player release on dispose.
 */
@Composable
internal fun PlayerPlaybackListenerEffect(
    exoPlayer: ExoPlayer,
    viewModel: PlayerViewModel,
    isMobile: Boolean,
    pipController: PipController?,
    errorRecoveryManager: ErrorRecoveryManager,
    getPlayerView: () -> PlayerView?,
    shouldCaptureThumbnail: () -> Boolean
) {
    DisposableEffect(exoPlayer) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                viewModel.updateBufferingState(playbackState == Player.STATE_BUFFERING)
                if (playbackState == Player.STATE_ENDED) {
                    viewModel.updatePlaybackState(
                        isPlaying = false,
                        position = exoPlayer.currentPosition,
                        duration = exoPlayer.duration.coerceAtLeast(0)
                    )
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                ComposeMainActivity.isPlayerPlaying = isPlaying
                if (isMobile) pipController?.update(isPlaying, canZap = true)
                viewModel.updatePlaybackState(
                    isPlaying = isPlaying,
                    position = exoPlayer.currentPosition,
                    duration = exoPlayer.duration.coerceAtLeast(0)
                )
            }
        }
        exoPlayer.addListener(listener)

        onDispose {
            // Capture thumbnail before releasing player
            if (shouldCaptureThumbnail()) {
                capturePlayerThumbnail(getPlayerView())?.let { bitmap ->
                    viewModel.saveThumbnailFromPlayer(bitmap)
                }
            }
            exoPlayer.removeListener(listener)
            errorRecoveryManager.release()
            exoPlayer.stop()
            exoPlayer.release()
        }
    }
}

/** On TV devices: pause playback when backgrounded, resume when foregrounded. */
@Composable
internal fun TvBackgroundPauseEffect(exoPlayer: ExoPlayer) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var wasPlayingBeforeStop by remember { mutableStateOf(true) }
    DisposableEffect(lifecycleOwner, exoPlayer) {
        if (!isTvDevice(context)) {
            onDispose { }
        } else {
            val observer = LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_STOP -> {
                        wasPlayingBeforeStop = exoPlayer.isPlaying
                        exoPlayer.pause()
                    }
                    Lifecycle.Event.ON_START -> {
                        if (wasPlayingBeforeStop) exoPlayer.play()
                    }
                    else -> {}
                }
            }
            lifecycleOwner.lifecycle.addObserver(observer)
            onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
        }
    }
}

/** PiP RemoteActions (prev/next channel) route into the ViewModel while composed. */
@Composable
internal fun PipRemoteActionsEffect(
    isMobile: Boolean,
    pipController: PipController?,
    viewModel: PlayerViewModel
) {
    DisposableEffect(Unit) {
        if (isMobile && pipController != null) {
            pipController.attach()
            pipController.onPipAction = { action ->
                when (action) {
                    PipController.PipAction.PREV_CHANNEL -> viewModel.previousChannel()
                    PipController.PipAction.NEXT_CHANNEL -> viewModel.nextChannel()
                }
            }
        }
        onDispose {
            if (isMobile && pipController != null) {
                pipController.onPipAction = null
                pipController.clearAutoEnter() // browsing screens must never auto-PiP
            }
        }
    }
}
