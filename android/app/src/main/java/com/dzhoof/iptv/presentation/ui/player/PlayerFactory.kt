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
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import dagger.hilt.android.qualifiers.ApplicationContext
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Builds ExoPlayer instances and media sources tuned for live IPTV rather than
 * ExoPlayer's VOD defaults.
 *
 * The defaults are the main reason IPTV apps feel like they "buffer more than
 * others": VOD-sized buffers, no HTTP timeouts, and no decoder fallback. This
 * factory fixes all three:
 *  - [DefaultLoadControl] with IPTV-appropriate buffers (smaller on low-RAM boxes)
 *    and a ~1s startup gate so first frame is not gated on a 2.5s buffer;
 *  - [OkHttpDataSource] over the app's OkHttp client with short connect/read
 *    timeouts, so a stalled segment fails fast and recovery kicks in instead of
 *    hanging;
 *  - [IptvLoadErrorHandlingPolicy] so parsing errors surface immediately and
 *    network errors self-heal at most once;
 *  - a TS extractor tuned for IPTV MPEG-TS (open-GOP/non-IDR keyframes,
 *    access-unit detection) and applied to BOTH progressive and HLS sources;
 *  - decoder fallback so a failing hardware decoder retries in software instead
 *    of killing the channel (common on cheap Fire TV sticks).
 *
 * [createMediaSource] is the single source-building entry point. The initial
 * prepare ([com.dzhoof.iptv.presentation.ui.screens.player.prepareChannelStream])
 * and [ErrorRecoveryManager] both call it, so container routing can never
 * diverge between the two (defects D1/D2).
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

    /** Shared fast-fail policy: 0 retries for parsing, 1 for network/IO. */
    private val loadErrorHandlingPolicy = IptvLoadErrorHandlingPolicy()

    /**
     * IPTV MPEG-TS is often open-GOP (non-IDR I-frames) and lacks access unit
     * delimiters, which the default H.264 reader rejects or mis-segments.
     * AC-3/E-AC-3 need no flag here: [DefaultTsPayloadReaderFactory] creates an
     * Ac3Reader for TS_STREAM_TYPE_AC3/E_AC3 by default, and
     * [DefaultHlsExtractorFactory] already lists [androidx.media3.common.FileTypes.AC3].
     */
    private val extractorsFactory = DefaultExtractorsFactory()
        .setTsExtractorFlags(TS_PAYLOAD_READER_FLAGS)

    private val mediaSourceFactory = DefaultMediaSourceFactory(dataSourceFactory, extractorsFactory)
        .setLoadErrorHandlingPolicy(loadErrorHandlingPolicy)

    /**
     * Build the media source for [url], honouring the server's [mimeType] hint
     * and the URL extension (see [PlaybackSourceRouting]).
     *
     * @param container when non-null, force this container regardless of the
     *   mime/extension guess. Used by the opposite-container retry (D4).
     */
    fun createMediaSource(
        url: String,
        mimeType: String?,
        container: PlaybackContainer? = null,
    ): MediaSource {
        val resolved = container ?: PlaybackSourceRouting.containerFor(url, mimeType)
        return when (resolved) {
            PlaybackContainer.HLS -> createHlsMediaSource(url)
            PlaybackContainer.PROGRESSIVE -> createProgressiveMediaSource(url, mimeType)
        }
    }

    /**
     * Build an explicit HLS media source for tokenized server playback.
     *
     * The URL alone cannot identify the container: the relay URL is opaque and
     * extension-less, so the source type must be forced explicitly. The factory
     * gets a TS-aware [DefaultHlsExtractorFactory] because HLS segments of an
     * IPTV TS upstream are raw MPEG-TS.
     */
    fun createHlsMediaSource(url: String): MediaSource {
        val mediaItem = MediaItem.Builder()
            .setUri(url)
            .setMimeType(MimeTypes.APPLICATION_M3U8)
            .build()
        return HlsMediaSource.Factory(dataSourceFactory)
            .setExtractorFactory(
                DefaultHlsExtractorFactory(
                    TS_PAYLOAD_READER_FLAGS,
                    /* exposeCea608WhenMissingDeclarations= */ true,
                )
            )
            .setLoadErrorHandlingPolicy(loadErrorHandlingPolicy)
            .createMediaSource(mediaItem)
    }

    /**
     * Build a progressive media source. An HLS mime hint is deliberately dropped
     * here: this path is also used for the forced opposite-container retry, and
     * feeding "application/x-mpegURL" to the progressive extractor would only
     * reproduce the same parsing failure. With no hint the extractor sniffs.
     */
    private fun createProgressiveMediaSource(url: String, mimeType: String?): MediaSource {
        val builder = MediaItem.Builder().setUri(url)
        if (!mimeType.isNullOrBlank() && !PlaybackSourceRouting.isHlsMimeType(mimeType)) {
            builder.setMimeType(mimeType)
        }
        return mediaSourceFactory.createMediaSource(builder.build())
    }

    fun create(): ExoPlayer {
        val lowRam = (context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)
            ?.isLowRamDevice == true

        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                if (lowRam) 8_000 else 15_000,   // min buffer
                if (lowRam) 30_000 else 50_000,  // max buffer
                BUFFER_FOR_PLAYBACK_MS,          // buffer before playback starts (~1s)
                BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS
            )
            .build()

        // Reuse the app's OkHttp (cert pinning, interceptors) but with stream-appropriate
        // timeouts so a dead segment fails in seconds rather than 30s.
        // 25s (not 8s): Upstream's stream nodes can take ~10s to allocate a session for a
        // channel that hasn't been played recently — an 8s timeout aborts the FIRST
        // request of every cold session and the player reports a source-provider error.
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
        /** Startup/re-buffer gates (D6): 1000/2000 instead of Media3's 2500/5000. */
        internal const val BUFFER_FOR_PLAYBACK_MS = 1_000
        internal const val BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS = 2_000

        /**
         * TS payload reader flags for IPTV MPEG-TS:
         *  - FLAG_ALLOW_NON_IDR_KEYFRAMES: open-GOP/backup feeds use non-IDR I-frames;
         *  - FLAG_DETECT_ACCESS_UNITS: many IPTV multiplexes omit AUD NALs.
         */
        internal const val TS_PAYLOAD_READER_FLAGS =
            DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or
                DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS
    }
}
