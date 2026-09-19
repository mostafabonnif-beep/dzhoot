package com.dzhoof.iptv

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `ChannelUpdateReceiver` handles two broadcasts it cannot authenticate:
 * `BOOT_COMPLETED` and `android.media.tv.action.INITIALIZE_PROGRAMS`. Its
 * manifest permission (`RECEIVE_BOOT_COMPLETED`) is a **normal** permission, so
 * any installed app can hold it and broadcast the TIF action repeatedly to force
 * a full channel re-sync. The throttle is what makes that harmless.
 */
class ChannelSyncThrottleTest {

    @Test
    fun `the first trigger always syncs`() {
        assertTrue(ChannelSyncThrottle.shouldSync(now = 1_000_000L, lastSyncAt = null))
    }

    @Test
    fun `a second trigger inside the window is refused`() {
        val now = 1_000_000L
        assertFalse(
            ChannelSyncThrottle.shouldSync(
                now = now + ChannelSyncThrottle.MIN_INTERVAL_MS - 1,
                lastSyncAt = now,
            ),
        )
    }

    @Test
    fun `a trigger after the window is accepted`() {
        val now = 1_000_000L
        assertTrue(
            ChannelSyncThrottle.shouldSync(
                now = now + ChannelSyncThrottle.MIN_INTERVAL_MS,
                lastSyncAt = now,
            ),
        )
    }

    @Test
    fun `a clock that jumped backwards does not lock syncing out`() {
        // NTP/timezone correction: the stored timestamp is in the "future".
        assertTrue(ChannelSyncThrottle.shouldSync(now = 1_000L, lastSyncAt = 9_999_999L))
    }

    @Test
    fun `the window is minutes, not seconds`() {
        assertTrue(ChannelSyncThrottle.MIN_INTERVAL_MS >= 5 * 60 * 1000L)
    }
}
