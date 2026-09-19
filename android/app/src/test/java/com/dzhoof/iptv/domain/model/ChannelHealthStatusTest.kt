package com.dzhoof.iptv.domain.model

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Regression: a failure mark must stop describing the present after the evidence window.
 *
 * The app stores health rows in SQLite and paints them onto channel cards
 * ("البث غير متاح"), zap order and list sorting. An OFFLINE row is written on every playback
 * failure, and on a server-managed setup nothing ever replaces it, so without expiry one bad
 * moment marked a channel dead forever — the exact illusion of "channels don't work" this fixes.
 */
class ChannelHealthStatusTest {

    private val now = 1_700_000_000_000L
    private val hour = 3_600_000L

    @Test
    fun `a fresh offline mark is shown`() {
        assertEquals(
            ChannelHealthStatus.OFFLINE,
            showableHealthStatus("OFFLINE", now - 1_000L, now),
        )
    }

    @Test
    fun `an offline mark exactly at the window edge is still shown`() {
        assertEquals(
            ChannelHealthStatus.OFFLINE,
            showableHealthStatus("OFFLINE", now - hour, now),
        )
    }

    @Test
    fun `an offline mark past the window decays to UNKNOWN`() {
        assertEquals(
            ChannelHealthStatus.UNKNOWN,
            showableHealthStatus("OFFLINE", now - hour - 1, now),
        )
    }

    @Test
    fun `a week-old offline mark is not shown`() {
        assertEquals(
            ChannelHealthStatus.UNKNOWN,
            showableHealthStatus("OFFLINE", now - 7L * 24 * hour, now),
        )
    }

    @Test
    fun `a stale checking mark from an interrupted scan is not shown`() {
        assertEquals(
            ChannelHealthStatus.UNKNOWN,
            showableHealthStatus("CHECKING", now - hour - 1, now),
        )
        assertEquals(
            ChannelHealthStatus.CHECKING,
            showableHealthStatus("CHECKING", now - 1_000L, now),
        )
    }

    @Test
    fun `an undatable failure mark is not shown`() {
        assertEquals(ChannelHealthStatus.UNKNOWN, showableHealthStatus("OFFLINE", 0L, now))
        assertEquals(ChannelHealthStatus.UNKNOWN, showableHealthStatus("UNRESPONSIVE", 0L, now))
    }

    @Test
    fun `a positive mark never expires`() {
        assertEquals(
            ChannelHealthStatus.ONLINE,
            showableHealthStatus("ONLINE", now - 30L * 24 * hour, now),
        )
        assertEquals(ChannelHealthStatus.ONLINE, showableHealthStatus("ONLINE", 0L, now))
    }

    @Test
    fun `an unknown or unparsable status is UNKNOWN`() {
        assertEquals(ChannelHealthStatus.UNKNOWN, showableHealthStatus(null, now, now))
        assertEquals(ChannelHealthStatus.UNKNOWN, showableHealthStatus("", now, now))
        assertEquals(ChannelHealthStatus.UNKNOWN, showableHealthStatus("healthy", now, now))
    }

    @Test
    fun `the window matches the one the player's category verdict uses`() {
        assertEquals(
            com.dzhoof.iptv.presentation.ui.player.StreamErrorMessageResolver.RECENT_WINDOW_MS,
            HEALTH_EVIDENCE_WINDOW_MS,
        )
    }
}
