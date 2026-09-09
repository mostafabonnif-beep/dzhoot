package com.dzhoof.iptv.presentation.ui.screens

import com.dzhoof.iptv.presentation.ui.screens.player.ASPECT_MODES
import com.dzhoof.iptv.presentation.ui.screens.player.nextSleepTimerStep
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Pure-logic tests for the VOD player controls added in R23: sleep-timer
 * preset cycling (shared with the live player), aspect/zoom cycling and the
 * countdown label formatting. UI behaviour (pausing on expiry) is exercised
 * through the Compose runtime and covered by manual QA on the APK.
 */
class VodPlayerControlsTest {

    @Test
    fun `sleep timer cycles off-30-60-90-120-off`() {
        assertEquals(30, nextSleepTimerStep(null)!!)
        assertEquals(60, nextSleepTimerStep(30)!!)
        assertEquals(90, nextSleepTimerStep(60)!!)
        assertEquals(120, nextSleepTimerStep(90)!!)
        assertEquals(null, nextSleepTimerStep(120)) // wrap back to off
    }

    @Test
    fun `aspect cycles fit-zoom-fill and wraps`() {
        assertEquals(1, nextAspectIndex(0))
        assertEquals(2, nextAspectIndex(1))
        assertEquals(0, nextAspectIndex(2)) // wrap
        // matches the three live-player presets (ملاءمة / تكبير / ملء الشاشة)
        assertEquals(3, ASPECT_MODES.size)
    }

    @Test
    fun `aspect degrades gracefully on empty preset list`() {
        assertEquals(0, nextAspectIndex(0, size = 0))
    }

    @Test
    fun `countdown label formats mm-ss with zero padding`() {
        assertEquals("0:00", sleepCountdownLabel(0))
        assertEquals("0:42", sleepCountdownLabel(42))
        assertEquals("1:01", sleepCountdownLabel(61))
        assertEquals("29:59", sleepCountdownLabel(1799))
        assertEquals("30:00", sleepCountdownLabel(1800))
    }

    @Test
    fun `countdown label clamps negative input`() {
        assertEquals("0:00", sleepCountdownLabel(-5))
    }
}
