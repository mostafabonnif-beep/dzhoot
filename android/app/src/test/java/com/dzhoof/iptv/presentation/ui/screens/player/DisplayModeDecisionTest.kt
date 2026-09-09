package com.dzhoof.iptv.presentation.ui.screens.player

import com.dzhoof.iptv.presentation.ui.screens.player.DisplayModeDecision.DisplayModeInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DisplayModeDecisionTest {

    private fun modes(vararg pairs: Pair<Int, Float>): List<DisplayModeInfo> =
        pairs.map { (id, hz) -> DisplayModeInfo(modeId = id, refreshRateHz = hz, width = 1920, height = 1080) }

    private fun hdmiModes(): List<DisplayModeInfo> = listOf(
        DisplayModeInfo(modeId = 1, refreshRateHz = 24f, width = 3840, height = 2160),
        DisplayModeInfo(modeId = 2, refreshRateHz = 25f, width = 3840, height = 2160),
        DisplayModeInfo(modeId = 3, refreshRateHz = 30f, width = 3840, height = 2160),
        DisplayModeInfo(modeId = 4, refreshRateHz = 50f, width = 3840, height = 2160),
        DisplayModeInfo(modeId = 5, refreshRateHz = 60f, width = 3840, height = 2160),
        DisplayModeInfo(modeId = 6, refreshRateHz = 24f, width = 1920, height = 1080),
        DisplayModeInfo(modeId = 7, refreshRateHz = 25f, width = 1920, height = 1080),
        DisplayModeInfo(modeId = 8, refreshRateHz = 30f, width = 1920, height = 1080),
        DisplayModeInfo(modeId = 9, refreshRateHz = 50f, width = 1920, height = 1080),
        DisplayModeInfo(modeId = 10, refreshRateHz = 60f, width = 1920, height = 1080),
    )

    @Test
    fun `no action when video rate unknown or no modes`() {
        assertNull(DisplayModeDecision.chooseDisplayMode(hdmiModes(), 0f, 10))
        assertNull(DisplayModeDecision.chooseDisplayMode(emptyList(), 25f, -1))
    }

    @Test
    fun `no action when current mode already matches`() {
        // 4K60 currently active, 60 fps video → negligible difference.
        assertNull(DisplayModeDecision.chooseDisplayMode(hdmiModes(), 60f, 5))
    }

    @Test
    fun `25fps video on 60hz display switches to 25hz mode preferring same resolution`() {
        val chosen = DisplayModeDecision.chooseDisplayMode(hdmiModes(), 25f, 5) // current 4K60
        assertEquals(2, chosen) // 4K@25 — same resolution as the active 4K60
    }

    @Test
    fun `50fps video on 60hz display switches to 50hz mode`() {
        val chosen = DisplayModeDecision.chooseDisplayMode(hdmiModes(), 50f, 10) // current 1080p60
        assertEquals(9, chosen) // 1080p@50 — same resolution family
    }

    @Test
    fun `no mode within tolerance means no switch for 24fps on odd rates`() {
        // Only 25/30/50/60 available: 24fps is 4% off the closest — no switch
        // (switching to 25Hz would speed the video up ~4%, never acceptable).
        val modes = modes(1 to 25f, 2 to 30f, 3 to 50f, 4 to 60f)
        assertNull(DisplayModeDecision.chooseDisplayMode(modes, 24f, 4))
    }

    @Test
    fun `exact match preferred when several rates are in tolerance`() {
        val modes = listOf(
            DisplayModeInfo(modeId = 1, refreshRateHz = 30000f / 1001f, width = 1920, height = 1080),
            DisplayModeInfo(modeId = 2, refreshRateHz = 30f, width = 1920, height = 1080),
            DisplayModeInfo(modeId = 3, refreshRateHz = 60f, width = 1920, height = 1080),
        )
        // 30 fps content: both 29.97 and 30 are within tolerance; exact 30 wins.
        assertEquals(2, DisplayModeDecision.chooseDisplayMode(modes, 30f, 3))
    }

    @Test
    fun `NTSC 2997 video treated as 30hz class`() {
        val modes = listOf(
            DisplayModeInfo(modeId = 1, refreshRateHz = 24f, width = 1920, height = 1080),
            DisplayModeInfo(modeId = 2, refreshRateHz = 30f, width = 1920, height = 1080),
            DisplayModeInfo(modeId = 3, refreshRateHz = 60f, width = 1920, height = 1080),
        )
        val chosen = DisplayModeDecision.chooseDisplayMode(modes, 30000f / 1001f, 3)
        assertEquals(2, chosen)
    }

    @Test
    fun `no mode near the video rate returns null`() {
        // 25fps video, display only offers 60 → no acceptable match.
        val modes = modes(1 to 60f, 2 to 120f)
        assertNull(DisplayModeDecision.chooseDisplayMode(modes, 25f, 1))
    }

    @Test
    fun `current mode not found in list returns null`() {
        assertNull(DisplayModeDecision.chooseDisplayMode(modes(1 to 60f), 60f, 99))
    }

    @Test
    fun `tolerance boundary respected`() {
        assertTrue(DisplayModeDecision.isMatch(target = 59.94f, rate = 60f)) // 0.1%
        assertFalse(DisplayModeDecision.isMatch(target = 25f, rate = 25.2f)) // 0.8%
        assertFalse(DisplayModeDecision.isMatch(target = 0f, rate = 60f))
    }

    @Test
    fun `prefers nearest rate over identical-rate far resolution`() {
        // 30fps content: mode with 30Hz@4K (mode 3) is farther in resolution from
        // current 1080p60 (mode 10) than 30Hz@1080p (mode 8), but rate diff is
        // equal — resolution tiebreak must pick the 1080p mode.
        val chosen = DisplayModeDecision.chooseDisplayMode(hdmiModes(), 30f, 10)
        assertEquals(8, chosen)
    }
}
