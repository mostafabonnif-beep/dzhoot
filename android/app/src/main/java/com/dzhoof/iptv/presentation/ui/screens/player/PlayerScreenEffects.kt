package com.dzhoof.iptv.presentation.ui.screens.player

import android.app.Activity
import android.content.Context
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.source.MediaSource
import com.dzhoof.iptv.domain.model.PlaybackTarget
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
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay

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
            // Request only the primary token on startup. Optional fallback tokens
            // are obtained on demand after a real playback failure, which makes
            // channel zapping substantially faster and avoids consuming concurrent
            // stream slots for sources that are never used.
            val primaryTarget = resolvePlaybackUrl(channel.id, 0, 0L, 0) ?: return false
            errorRecoveryManager.setStreamSlots(
                listOf(
                    ErrorRecoveryManager.StreamSlot(
                        directUrl = primaryTarget.url,
                        proxyUrl = primaryTarget.proxyUrl,
                        isPrimary = true,
                        mimeType = primaryTarget.mimeType,
                    ),
                ),
            )
            errorRecoveryManager.setFallbackResolver { slot ->
                resolvePlaybackUrl(channel.id, slot, 0L, 0)?.let { playbackTarget ->
                    ErrorRecoveryManager.StreamSlot(
                        directUrl = playbackTarget.url,
                        proxyUrl = playbackTarget.proxyUrl,
                        isPrimary = false,
                        mimeType = playbackTarget.mimeType,
                    )
                }
            }
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

/**
 * Auto-applies the current channel's saved audio/subtitle preferences once
 * track groups become available for a prepared media item, and applies the
 * resulting decision to the real player.
 *
 * One-shot flow per prepared item:
 * 1. `onTracksChanged` with empty groups ⇒ a new item is being prepared, so the
 *    ViewModel forgets the previous auto-apply for the current media key.
 * 2. `onTracksChanged` with groups ⇒ the effect snapshots the player's tracks
 *    into the pure model and hands them to [PlayerViewModel.onTrackGroupsAvailable].
 * 3. The ViewModel reads the channel's stored preferences, computes a decision
 *    and publishes it on `pendingTrackDecision`; this effect applies it via
 *    [TrackPreferenceApplier] and clears the request.
 *
 * Manual picks (PlayerTracksPanel) mark the media item in the ViewModel, which
 * makes any still-queued decision a no-op (manual wins over auto-apply).
 */
@Composable
internal fun PlayerTrackPreferenceEffect(
    exoPlayer: ExoPlayer,
    viewModel: PlayerViewModel
) {
    DisposableEffect(exoPlayer, viewModel) {
        val listener = object : Player.Listener {
            override fun onTracksChanged(tracks: Tracks) {
                val mediaKey = viewModel.currentMediaKey() ?: return
                if (tracks.groups.isEmpty()) {
                    // New item being prepared — allow one fresh auto-apply when
                    // its tracks arrive (recovery re-prepares reuse the key).
                    viewModel.resetTrackAutoApplyForCurrentItem()
                    return
                }
                val snapshot = TrackPreferenceApplier.snapshotOf(exoPlayer) ?: return
                viewModel.onTrackGroupsAvailable(mediaKey, snapshot)
            }
        }
        exoPlayer.addListener(listener)
        onDispose { exoPlayer.removeListener(listener) }
    }

    LaunchedEffect(exoPlayer) {
        viewModel.pendingTrackDecision.collect { request ->
            if (request == null) return@collect
            TrackPreferenceApplier.apply(exoPlayer, request.decision)
            // Applied (or abandoned because the item changed under us): either
            // way the request is consumed so it can never hit a later item.
            viewModel.onTrackDecisionApplied(request.mediaKey)
        }
    }
}

/**
 * Matches the display refresh rate to the video frame rate while live playback
 * runs, and restores the default mode when playback stops or the item changes.
 *
 * Why: 25/30/50 fps live streams on a fixed 60 Hz panel force 3:2 pulldown
 * judder. When the display exposes a matching mode (50 Hz for 25/50 fps,
 * 24 Hz for 24 fps, 60 Hz for 30/60 fps) the fullscreen activity window asks
 * the system for it via `preferredDisplayModeId` (see [DisplayModeHelper]).
 *
 * State machine (one poll loop, no media3 API risk):
 *  - a new media item (different media id) restores the previous item's mode;
 *  - READY + playing: read the declared container frame rate, or measure the
 *    rendered-frame cadence over a rolling window, quantize it to a canonical
 *    broadcast rate, and apply the best matching display mode once per item;
 *  - pause / ENDED / IDLE / dispose: restore the default mode.
 * Every display call is try/catch-guarded and the loop never throws.
 */
@OptIn(UnstableApi::class)
@Composable
internal fun DisplayModeMatchEffect(
    context: Context,
    exoPlayer: ExoPlayer
) {
    val activity = remember(context) { context as? Activity }
    LaunchedEffect(exoPlayer, activity) {
        if (activity == null) return@LaunchedEffect

        var lastItemToken: String? = null
        var appliedForItemToken: String? = null
        var measureWindowStartFrame = -1
        var measureWindowStartedAt = 0L
        var measureAttempts = 0

        while (true) {
            delay(DISPLAY_MODE_POLL_MS)

            val itemToken = exoPlayer.currentMediaItem?.mediaId
            if (itemToken != lastItemToken) {
                // New item prepared (zap / first load / re-prepare): if the
                // previous item had switched the mode, hand it back to default.
                if (appliedForItemToken != null && appliedForItemToken != itemToken) {
                    DisplayModeHelper.restoreDefaultMode(activity)
                }
                lastItemToken = itemToken
                appliedForItemToken = null
                measureWindowStartFrame = -1
                measureWindowStartedAt = 0L
                measureAttempts = 0
            }

            val playbackState = exoPlayer.playbackState
            when {
                playbackState == Player.STATE_ENDED || playbackState == Player.STATE_IDLE -> {
                    if (appliedForItemToken != null) {
                        DisplayModeHelper.restoreDefaultMode(activity)
                        appliedForItemToken = null
                    }
                }
                playbackState == Player.STATE_READY && exoPlayer.isPlaying -> {
                    if (appliedForItemToken != itemToken && measureAttempts < DISPLAY_MODE_MAX_MEASURE_ATTEMPTS) {
                        val fps = resolveVideoFrameRate(exoPlayer, measureWindowStartFrame, measureWindowStartedAt)
                        if (fps != null) {
                            val switched = DisplayModeHelper.applyMatchForVideo(activity, fps)
                            if (switched) {
                                appliedForItemToken = itemToken
                            }
                            // Retry on failure: the window may have produced a
                            // noisy rate that matched no mode. Bounded by attempts.
                            measureWindowStartFrame = -1
                            measureWindowStartedAt = 0L
                            measureAttempts++
                        } else if (measureWindowStartFrame < 0) {
                            // Nothing declared and no window running yet — open one.
                            measureWindowStartedAt = SystemClock.elapsedRealtime()
                            measureWindowStartFrame = DisplayModeHelper.renderedFrameCount(exoPlayer) ?: -1
                        } else if (SystemClock.elapsedRealtime() - measureWindowStartedAt >=
                            DISPLAY_MODE_MEASURE_WINDOW_MS + DISPLAY_MODE_POLL_MS
                        ) {
                            // Window finished without producing a rate (no frames
                            // rendered, counters unavailable): consume an attempt
                            // so an fps-less stream cannot spin forever.
                            measureWindowStartFrame = -1
                            measureWindowStartedAt = 0L
                            measureAttempts++
                        }
                    }
                }
                !exoPlayer.isPlaying && !exoPlayer.playWhenReady -> {
                    // Explicit pause / background stop: drop the video-rate mode.
                    if (appliedForItemToken != null) {
                        DisplayModeHelper.restoreDefaultMode(activity)
                        appliedForItemToken = null
                    }
                }
                // Buffering between items: hold whatever mode is active until
                // the new item resolves, so zapping does not flicker modes.
            }
        }
    }
}

/** Poll budget + measurement window for [DisplayModeMatchEffect]. */
private const val DISPLAY_MODE_POLL_MS = 400L
private const val DISPLAY_MODE_MEASURE_WINDOW_MS = 4_000L
private const val DISPLAY_MODE_MAX_MEASURE_ATTEMPTS = 3

/**
 * Resolve the video frame rate for [exoPlayer]: prefer the frame rate declared
 * in the container/manifest; otherwise finish a running measurement window of
 * rendered frames and quantize the result to a canonical broadcast rate.
 * Returns null while the rate is still unknown.
 */
@OptIn(UnstableApi::class)
private suspend fun resolveVideoFrameRate(
    exoPlayer: ExoPlayer,
    windowStartFrame: Int,
    windowStartedAt: Long,
): Float? {
    val declared = DisplayModeHelper.declaredVideoFrameRate(exoPlayer)
    if (declared != null && declared > 0f) return declared

    if (windowStartFrame < 0 || windowStartedAt == 0L) return null
    val now = SystemClock.elapsedRealtime()
    if (now - windowStartedAt < DISPLAY_MODE_MEASURE_WINDOW_MS) return null
    val frameCount = DisplayModeHelper.renderedFrameCount(exoPlayer) ?: return null
    if (frameCount <= windowStartFrame) return null
    val measured = (frameCount - windowStartFrame) * 1000f / (now - windowStartedAt)
    // Quantize to a canonical broadcast rate when close enough; an outlier
    // window (e.g. 26.4) stays raw and simply fails the mode match.
    return DisplayModeHelper.quantizeFrameRate(measured).takeIf { it > 0f }
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
