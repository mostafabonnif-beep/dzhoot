package com.dzhoof.iptv.data.model.dto

/**
 * Wire models for the cross-device Continue Watching API
 * (`/api/v1/watch-progress` on the DZ HOOF backend).
 *
 * Every field is nullable on purpose: the server owns these documents, Gson fills
 * what the payload carries, and a stricter shape would crash the app on a
 * harmless additive change. Callers treat a missing field as "not usable"
 * instead of trusting the type.
 *
 * `positionSec` / `durationSec` are SECONDS on the wire, while the local Room
 * table (`playback_positions`) stores MILLISECONDS — the conversion lives in
 * `WatchProgressSyncRepositoryImpl` so no UI code has to remember it.
 */
data class WatchProgressDto(
    val contentId: String? = null,
    val contentType: String? = null,
    val positionSec: Double? = null,
    val durationSec: Double? = null,
    val completed: Boolean? = null,
    val updatedAt: String? = null,
)

/** `GET /api/v1/watch-progress` — the Continue Watching list, newest first. */
data class WatchProgressListResponse(
    val success: Boolean? = null,
    val data: List<WatchProgressDto>? = null,
)

/**
 * `PUT /api/v1/watch-progress/{contentType}/{contentId}` body.
 *
 * The server ignores a position below 10 seconds (it deletes any stale row) and
 * marks the row completed at 95% of `durationSec`, so both server-side rules
 * keep working without the app replicating them.
 */
data class WatchProgressUpsertRequest(
    val positionSec: Double,
    val durationSec: Double? = null,
)

/** `PUT /api/v1/watch-progress/{contentType}/{contentId}` response. */
data class WatchProgressUpsertResponse(
    val success: Boolean? = null,
    val data: WatchProgressDto? = null,
)

/** Body of the `DELETE` responses: how many rows went away. */
data class WatchProgressRemovedData(
    val removed: Boolean? = null,
)

/** `DELETE /api/v1/watch-progress/{contentType}/{contentId}` response. */
data class WatchProgressRemovedResponse(
    val success: Boolean? = null,
    val data: WatchProgressRemovedData? = null,
)
