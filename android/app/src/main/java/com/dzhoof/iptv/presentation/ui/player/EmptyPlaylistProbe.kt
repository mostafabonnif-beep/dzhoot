package com.dzhoof.iptv.presentation.ui.player

/**
 * Decides whether a fetched HLS manifest is an *empty* playlist, i.e. the
 * provider currently publishes no segments for this channel (event channels
 * between events). Such a channel answers HTTP 200 with a zero-length or
 * header-only body, which the player reports as a manifest parsing error —
 * indistinguishable at that level from a genuinely broken stream.
 *
 * Pure and synchronous so it is trivially unit-testable; the network part
 * lives in [StreamManifestFetcher].
 */
object EmptyPlaylistProbe {

    fun isPlaylistEmpty(body: String?): Boolean {
        if (body.isNullOrBlank()) return true
        val text = body.trim()
        // A master playlist points at variants; let the player follow it.
        if (text.contains("#EXT-X-STREAM-INF", ignoreCase = true)) return false
        // Any media segment means there IS content.
        if (text.contains("#EXTINF", ignoreCase = true)) return false
        // A media playlist with no segments is the "no broadcast now" case.
        if (text.startsWith("#EXTM3U", ignoreCase = true)) return true
        // Unknown shape: never claim it is empty.
        return false
    }
}
