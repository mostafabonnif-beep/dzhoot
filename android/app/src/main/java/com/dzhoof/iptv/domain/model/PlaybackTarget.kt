package com.dzhoof.iptv.domain.model

/**
 * Server-authorized playback target. The URL is opaque by design; mimeType
 * tells Media3 how to create the correct media source when the URL has no
 * recognizable file extension.
 */
data class PlaybackTarget(
    val url: String,
    val mimeType: String? = null,
)
