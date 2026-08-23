package com.dzhoof.iptv.presentation.ui.player

import android.app.ActivityManager
import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import dagger.hilt.android.qualifiers.ApplicationContext
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Builds ExoPlayer instances tuned for live IPTV rather than ExoPlayer's VOD defaults.
 *
 * The defaults are the main reason IPTV apps feel like they "buffer more than others":
 * VOD-sized buffers, no HTTP timeouts, and no decoder fallback. This factory fixes all
 * three:
 *  - [DefaultLoadControl] with IPTV-appropriate buffers (smaller on low-RAM boxes).
 *  - [OkHttpDataSource] over the app's OkHttp client with short connect/read timeouts,
 *    so a stalled segment fails fast and recovery kicks in instead of hanging.
 *  - A retrying [DefaultLoadErrorHandlingPolicy] so transient HTTP hiccups self-heal
 *    before [ErrorRecoveryManager] escalates to proxy/alternate fallback.
 *  - Decoder fallback so a failing hardware decoder retries in software instead of
 *    killing the channel (common on cheap Fire TV sticks).
 */
@Singleton
@OptIn(UnstableApi::class)
class PlayerFactory @Inject constructor(
    @ApplicationContext private val context: Context,
    private val okHttpClient: OkHttpClient
) {
    private val streamingClient = okHttpClient.newBuilder()
        .connectTimeout(25, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .build()

    private val dataSourceFactory = DefaultDataSource.Factory(
        context,
        OkHttpDataSource.Factory(streamingClient)
    )

    /**
     * Build an explicit HLS media source for tokenized server playback.
     *
     * Server playback URLs (/api/v1/tv/playback/...) ALWAYS serve an HLS
     * playlist — the proxy normalizes every upstream into a media playlist.
     * Forcing [MimeTypes.APPLICATION_M3U8] here bypasses
     * DefaultMediaSourceFactory's container inference, which — when the
     * server's mimeType hint is null or a raw .ts extension is present —
     * falls back to ProgressiveMediaSource and fails the playlist text with
     * ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED without ever fetching segments.
     */
    fun createHlsMediaSource(url: String): MediaSource {
        val mediaItem = MediaItem.Builder()
            .setUri(url)
            .setMimeType(MimeTypes.APPLICATION_M3U8)
            .build()
        return HlsMediaSource.Factory(dataSourceFactory)
            .setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(RETRY_COUNT))
            .createMediaSource(mediaItem)
    }

    fun create(): ExoPlayer {
        val lowRam = (context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)
            ?.isLowRamDevice == true

        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                if (lowRam) 8_000 else 15_000,   // min buffer
                if (lowRam) 30_000 else 50_000,  // max buffer
                2_500,                           // buffer before playback starts
                5_000                            // buffer before playback resumes after a rebuffer
            )
            .build()

        // Reuse the app's OkHttp (cert pinning, interceptors) but with stream-appropriate
        // timeouts so a dead segment fails in seconds rather than 30s.
        // 25s (not 8s): Upstream's stream nodes can take ~10s to allocate a session for a
        // channel that hasn't been played recently — an 8s timeout aborts the FIRST
        // request of every cold session and the player reports a source-provider error.
        val mediaSourceFactory = DefaultMediaSourceFactory(dataSourceFactory)
            .setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(RETRY_COUNT))

        val renderersFactory = DefaultRenderersFactory(context)
            .setEnableDecoderFallback(true)

        return ExoPlayer.Builder(context, renderersFactory)
            .setMediaSourceFactory(mediaSourceFactory)
            .setLoadControl(loadControl)
            .setTrackSelector(DefaultTrackSelector(context))
            .build()
            .apply { playWhenReady = true }
    }

    companion object {
        private const val RETRY_COUNT = 4
    }
}
