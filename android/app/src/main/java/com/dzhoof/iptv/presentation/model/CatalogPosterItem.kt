package com.dzhoof.iptv.presentation.model

/** Lightweight display model for a poster row item (movie or series) on the home screen. */
data class CatalogPosterItem(
    val key: String,
    val title: String,
    val subtitle: String,
    val imageUrl: String?,
    /**
     * Resume progress (0f..1f) drawn as a bar on the poster, or null for a row that
     * is not about resuming. Null keeps every existing caller pixel-identical.
     */
    val progress: Float? = null,
)
