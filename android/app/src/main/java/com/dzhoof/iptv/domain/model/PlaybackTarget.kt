package com.dzhoof.iptv.domain.model

/**
 * Server-authorized playback target. The URL is opaque by design; mimeType
 * tells Media3 how to create the correct media source when the URL has no
 * recognizable file extension. proxyUrl (when present) is a server-relayed
 * fallback for the same stream — used by the error-recovery manager when the
 * direct URL fails from the viewer's network.
 */
data class PlaybackTarget(
    val url: String,
    val proxyUrl: String? = null,
    val mimeType: String? = null,
)
