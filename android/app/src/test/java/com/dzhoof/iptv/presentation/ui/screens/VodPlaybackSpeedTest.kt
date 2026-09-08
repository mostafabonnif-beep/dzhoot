package com.dzhoof.iptv.presentation.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class VodPlaybackSpeedTest {

    @Test
    fun `cycles through options and wraps around`() {
        assertEquals(1.0f, nextPlaybackSpeed(0.75f))
        assertEquals(1.25f, nextPlaybackSpeed(1.0f))
        assertEquals(1.5f, nextPlaybackSpeed(1.25f))
        assertEquals(2.0f, nextPlaybackSpeed(1.5f))
        assertEquals(0.75f, nextPlaybackSpeed(2.0f)) // wrap
    }

    @Test
    fun `unknown current speed falls back to the first option`() {
        assertEquals(0.75f, nextPlaybackSpeed(3.5f))
    }

    @Test
    fun `empty options degrade to 1x`() {
        assertEquals(1.0f, nextPlaybackSpeed(1.0f, emptyList()))
    }

    @Test
    fun `labels drop trailing zeros`() {
        assertEquals("1×", speedLabel(1.0f))
        assertEquals("1.25×", speedLabel(1.25f))
        assertEquals("2×", speedLabel(2.0f))
        assertEquals("0.75×", speedLabel(0.75f))
    }
}
