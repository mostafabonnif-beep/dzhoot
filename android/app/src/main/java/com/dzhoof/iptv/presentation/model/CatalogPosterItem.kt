package com.dzhoof.iptv.presentation.model

/** Lightweight display model for a poster row item (movie or series) on the home screen. */
data class CatalogPosterItem(
    val key: String,
    val title: String,
    val subtitle: String,
    val imageUrl: String?,
)
