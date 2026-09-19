package com.dzhoof.iptv.domain.model

/**
 * How long a recorded health result stays a fair description of *now*.
 *
 * A health row is evidence about the moment it was written, never a permanent property of a
 * channel. An OFFLINE row is written on every playback failure — a genuinely dead channel, but
 * also an expired token, a concurrent-stream limit, one bad network moment, or a flaky upstream.
 * On a server-managed (paired) setup the client cannot re-probe managed channels at all, because
 * their upstream URLs stay server-side, so nothing ever replaces the row.
 *
 * Without a window that stale row paints a working channel as "البث غير متاح" forever, drops it
 * from zap order, sinks it to the bottom of the list — and, counted at category level, makes the
 * player blame the source provider. One window, one number, shared by the UI (this file) and the
 * category verdict in `StreamErrorMessageResolver` so the two can never drift apart.
 */
const val HEALTH_EVIDENCE_WINDOW_MS = 3_600_000L // 1 hour

enum class ChannelHealthStatus {
    UNKNOWN,
    CHECKING,
    ONLINE,
    OFFLINE,
    UNRESPONSIVE
}

/**
 * The status to *show* for a stored health row recorded at [lastCheckedAt], read at [now].
 *
 * Only failure marks expire: OFFLINE, UNRESPONSIVE, and a CHECKING left behind by an interrupted
 * scan. Past [windowMs] the honest answer is UNKNOWN — we do not know — so the UI neither claims
 * the channel is dead nor silently drops it. A positive ONLINE mark is left as it is: it hides
 * nothing and blocks nothing.
 *
 * Pure, so the rule is unit-tested in isolation without a database or a clock.
 */
fun showableHealthStatus(
    rawStatus: String?,
    lastCheckedAt: Long,
    now: Long,
    windowMs: Long = HEALTH_EVIDENCE_WINDOW_MS,
): ChannelHealthStatus {
    val status = rawStatus
        ?.let { raw -> runCatching { ChannelHealthStatus.valueOf(raw) }.getOrNull() }
        ?: return ChannelHealthStatus.UNKNOWN

    val isFailureMark = status == ChannelHealthStatus.OFFLINE ||
        status == ChannelHealthStatus.UNRESPONSIVE ||
        status == ChannelHealthStatus.CHECKING
    if (!isFailureMark) return status

    // No timestamp at all: the mark cannot be dated, so it is not a statement about now.
    if (lastCheckedAt <= 0L) return ChannelHealthStatus.UNKNOWN

    return if (now - lastCheckedAt > windowMs) ChannelHealthStatus.UNKNOWN else status
}
