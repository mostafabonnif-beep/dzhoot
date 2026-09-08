package com.dzhoof.iptv.presentation.model

import com.dzhoof.iptv.domain.model.SportsMatch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class SportsMatchUiModelTest {

    private val algiers = ZoneId.of("Africa/Algiers")

    private fun match(
        channelId: String,
        title: String,
        startIso: String,
        isLive: Boolean
    ) = SportsMatch(
        channelId = channelId,
        channelName = "beIN Sports",
        channelIcon = null,
        title = title,
        description = null,
        isLive = isLive,
        startTime = Instant.parse(startIso),
        endTime = null
    )

    @Test
    fun `maps domain fields and formats local kickoff time`() {
        val domain = match("ch1", "الجزائر - المغرب", "2026-09-08T19:30:00Z", isLive = false)

        val ui = domain.toUiModel(algiers)

        assertEquals("ch1", ui.channelId)
        assertEquals("beIN Sports", ui.channelName)
        assertEquals("الجزائر - المغرب", ui.title)
        assertFalse(ui.isLive)
        // UTC 19:30 == 20:30 in Algiers (UTC+1 during this date)
        assertEquals("20:30", ui.timeLabel)
    }

    @Test
    fun `marks started matches as live`() {
        val live = match("ch1", "الجزائر - المغرب", "2026-09-08T18:00:00Z", isLive = true)
        assertTrue(live.toUiModel(algiers).isLive)
    }

    @Test
    fun `sorts live first then by kickoff`() {
        val upcomingEarly = match("chA", "أ", "2026-09-08T17:00:00Z", isLive = false)
        val liveLate = match("chB", "ب", "2026-09-08T20:00:00Z", isLive = true)
        val upcomingLate = match("chC", "ج", "2026-09-08T21:00:00Z", isLive = false)
        val liveEarly = match("chD", "د", "2026-09-08T16:00:00Z", isLive = true)

        val sorted = listOf(upcomingEarly, liveLate, upcomingLate, liveEarly).toUiModels(algiers)

        assertEquals(listOf("د", "ب", "أ", "ج"), sorted.map { it.title })
        assertTrue(sorted.take(2).all { it.isLive })
        assertTrue(sorted.drop(2).none { it.isLive })
        // Within each group, ascending kickoff (local Algiers time: UTC+1)
        assertEquals(17, Instant.ofEpochMilli(sorted[0].startEpochMs).atZone(algiers).hour)
        assertEquals(21, Instant.ofEpochMilli(sorted[1].startEpochMs).atZone(algiers).hour)
    }

    @Test
    fun `empty list maps to empty list`() {
        assertTrue(emptyList<SportsMatch>().toUiModels(algiers).isEmpty())
    }
}
