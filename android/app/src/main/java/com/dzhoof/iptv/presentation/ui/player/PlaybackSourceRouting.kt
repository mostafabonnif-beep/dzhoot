package com.dzhoof.iptv.presentation.ui.player

/**
 * Container family a stream must be demuxed as.
 *
 * The server relay hands back an opaque, extension-less URL plus an optional
 * mimeType hint that it guesses from the *upstream* URL extension — and returns
 * null when that upstream is extension-less. Routing logic therefore lives in
 * exactly one place ([PlaybackSourceRouting]) so the initial prepare and every
 * recovery attempt make the identical decision.
 */
enum class PlaybackContainer {
    HLS,
    PROGRESSIVE,
}

/**
 * Decides how a tokenized/relayed URL should be demuxed.
 *
 * Key rule (production bug D1): a null/blank mimeType is NOT evidence of HLS.
 * The relay serves raw MPEG-TS for TS upstreams, and those URLs are
 * extension-less, so defaulting null to HLS made HlsMediaSource fail with
 * ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED before fetching a segment.
 * Unknown mime now defaults to PROGRESSIVE (the extractor sniffs the container),
 * and [ErrorRecoveryManager] retries the same URL once with the opposite
 * container if that guess was wrong.
 */
object PlaybackSourceRouting {

    /**
     * True when [mimeType] describes an HLS playlist. Media3's
     * [androidx.media3.common.MimeTypes.APPLICATION_M3U8] constant is
     * "application/x-mpegURL", while the ecosystem (and older server builds)
     * commonly send "application/vnd.apple.mpegurl" — a plain equals() against
     * the constant misses that and routes the playlist to the PROGRESSIVE
     * extractor, which sniffs the playlist text and dies instantly.
     */
    fun isHlsMimeType(mimeType: String): Boolean {
        val m = mimeType.trim().lowercase()
        return m.contains("mpegurl") || m.contains("m3u8") || m.contains("apple.streaming")
    }

    /**
     * Resolve the container for [url] from the server's [mimeType] hint, falling
     * back to the URL extension only when no hint is present.
     *
     * - explicit HLS mime (any spelling) -> HLS
     * - explicit non-HLS mime -> PROGRESSIVE
     * - null/blank mime + `.m3u8` URL -> HLS
     * - null/blank mime + anything else (extension-less relay, `.ts`, `.mp4`) -> PROGRESSIVE
     */
    fun containerFor(url: String, mimeType: String?): PlaybackContainer {
        if (!mimeType.isNullOrBlank()) {
            return if (isHlsMimeType(mimeType)) PlaybackContainer.HLS else PlaybackContainer.PROGRESSIVE
        }
        val path = url.substringBefore('?').substringBefore('#').lowercase()
        return if (path.endsWith(".m3u8")) PlaybackContainer.HLS else PlaybackContainer.PROGRESSIVE
    }

    /** The other container, used for the one-shot opposite-container retry. */
    fun opposite(container: PlaybackContainer): PlaybackContainer =
        if (container == PlaybackContainer.HLS) PlaybackContainer.PROGRESSIVE
        else PlaybackContainer.HLS
}
