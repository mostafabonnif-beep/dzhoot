package com.dzhoof.iptv.presentation.model

/**
 * One resume card in the on-demand Continue Watching row.
 *
 * Carries [contentType] and [contentId] (not just a key) because the row's click
 * has to start playback: the route needs both, and re-deriving them from the key
 * in the UI layer would put a data-layer concern in a composable.
 */
data class ContinueWatchingUiModel(
    /** Local identity of the position — the key to resume or dismiss. */
    val localKey: String,
    /** `movie` or `episode`, as `/streams/authorize` expects it. */
    val contentType: String,
    val contentId: String,
    val title: String,
    val subtitle: String?,
    val posterUrl: String?,
    /** 0f..1f for the poster bar, or null when the duration is unknown. */
    val progress: Float?,
)
