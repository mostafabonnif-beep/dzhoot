package com.dzhoof.iptv.domain.model

/**
 * One resumable on-demand title, ready to render as a Continue Watching card.
 *
 * The player already stores a resume position per title; what it never stored is
 * anything a person can read. A position key is `vod:movie:<id>` — no title, no
 * poster — so the rail that shows them has to resolve each key against the
 * catalog, and this model is the result of that resolution.
 *
 * [title]/[posterUrl] belong to the parent work (the series for an episode), with
 * [subtitle] carrying the position inside it ("الموسم 2 · الحلقة 3"), which is what
 * makes two episodes of the same series distinguishable in a row of cards.
 */
data class VodContinueWatchingItem(
    /** Local Room key, e.g. `vod:movie:<id>` — the identity to resume or dismiss. */
    val localKey: String,
    /** Server content type: `movie`, `episode` or `series`. */
    val contentType: String,
    /** Server content id (catalog id), the value `/streams/authorize` expects. */
    val contentId: String,
    val title: String,
    val posterUrl: String?,
    /** Secondary line, already localised, or null when there is nothing useful to add. */
    val subtitle: String?,
    val positionMs: Long,
    val durationMs: Long,
    /** 0f..1f, or 0f when the duration is unknown (an unfinished/live-like asset). */
    val progress: Float,
)
