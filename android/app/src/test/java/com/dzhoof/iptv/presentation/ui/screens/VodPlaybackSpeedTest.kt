package com.dzhoof.iptv.presentation.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class VodPlaybackSpeedTest {

    @Test
    fun `cycles through the full 0_5x-2x range and wraps around`() {
        assertEquals(0.75f, nextPlaybackSpeed(0.5f))
        assertEquals(1.0f, nextPlaybackSpeed(0.75f))
        assertEquals(1.25f, nextPlaybackSpeed(1.0f))
        assertEquals(1.5f, nextPlaybackSpeed(1.25f))
        assertEquals(2.0f, nextPlaybackSpeed(1.5f))
        assertEquals(0.5f, nextPlaybackSpeed(2.0f)) // wrap back to 0.5×
    }

    @Test
    fun `unknown current speed falls back to the first option`() {
        assertEquals(0.5f, nextPlaybackSpeed(3.5f))
    }

    @Test
    fun `empty options degrade to 1x`() {
        assertEquals(1.0f, nextPlaybackSpeed(1.0f, emptyList()))
    }

    @Test
    fun `labels drop trailing zeros`() {
        assertEquals("0.5×", speedLabel(0.5f))
        assertEquals("1×", speedLabel(1.0f))
        assertEquals("1.25×", speedLabel(1.25f))
        assertEquals("2×", speedLabel(2.0f))
        assertEquals("0.75×", speedLabel(0.75f))
    }
}
