package com.dzhoof.iptv.presentation.model

import com.dzhoof.iptv.domain.model.SportsMatch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Ready-to-render model for one entry of the Home "مباريات اليوم" row.
 * Everything the composable needs is precomputed here so the UI stays dumb
 * and the mapping stays unit-testable.
 */
data class SportsMatchUiModel(
    val channelId: String,
    val channelName: String?,
    val iconUrl: String?,
    val title: String,
    val description: String?,
    val isLive: Boolean,
    /** Kickoff as epoch millis — used for stable keys and re-renders. */
    val startEpochMs: Long,
    /** Local kickoff time, e.g. "19:30" (Latin digits, matches the app strings). */
    val timeLabel: String
)

/** Maps a domain [SportsMatch] to its UI model, formatting the time in [zoneId]. */
fun SportsMatch.toUiModel(zoneId: ZoneId = ZoneId.systemDefault()): SportsMatchUiModel {
    val timeLabel = TIME_FORMATTER.withZone(zoneId).format(startTime)
    return SportsMatchUiModel(
        channelId = channelId,
        channelName = channelName,
        iconUrl = channelIcon,
        title = title,
        description = description,
        isLive = isLive,
        startEpochMs = startTime.toEpochMilli(),
        timeLabel = timeLabel
    )
}

/** Sorted by kickoff — live first (already started), then upcoming by start time. */
fun List<SportsMatch>.toUiModels(zoneId: ZoneId = ZoneId.systemDefault()): List<SportsMatchUiModel> =
    map { it.toUiModel(zoneId) }
        .sortedWith(
            compareByDescending<SportsMatchUiModel> { it.isLive }
                .thenBy { it.startEpochMs }
        )

private val TIME_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
