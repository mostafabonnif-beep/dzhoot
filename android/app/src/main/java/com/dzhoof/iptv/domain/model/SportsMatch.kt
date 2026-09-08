package com.dzhoof.iptv.domain.model

import java.time.Instant

/**
 * A single sports match shown in the Home "مباريات اليوم" row.
 *
 * Returned by the paired server's `/tv/epg/:code/matches-today` endpoint:
 * today's live/upcoming sports programs detected from the EPG, each pointing
 * back to the catalog channel that carries it ([channelId]).
 */
data class SportsMatch(
    val channelId: String,
    val channelName: String?,
    val channelIcon: String?,
    val title: String,
    val description: String?,
    /** True when the program has already started ("live"); false = upcoming. */
    val isLive: Boolean,
    val startTime: Instant,
    val endTime: Instant?
)
