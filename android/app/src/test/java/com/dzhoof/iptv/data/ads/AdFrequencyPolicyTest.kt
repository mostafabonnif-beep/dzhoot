package com.dzhoof.iptv.data.ads

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rules that decide when a free-tier viewer is interrupted by an
 * interstitial. The operator sets the gap and the per-session cap in the admin
 * panel; the client must honour both, and "0" means off.
 */
class AdFrequencyPolicyTest {

    private var now = 1_000_000L
    private val policy = AdFrequencyPolicy { now }

    @Test
    fun `first interstitial is allowed when the gate is open`() {
        assertTrue(policy.canShow(everyMinutes = 15, perSessionCap = 3))
    }

    @Test
    fun `zero minutes or zero cap disables interstitials`() {
        assertFalse(policy.canShow(everyMinutes = 0, perSessionCap = 3))
        assertFalse(policy.canShow(everyMinutes = 15, perSessionCap = 0))
        assertFalse(policy.canShow(everyMinutes = -1, perSessionCap = 5))
    }

    @Test
    fun `the time gap is enforced between two interstitials`() {
        assertTrue(policy.canShow(everyMinutes = 15, perSessionCap = 3))
        policy.recordShown()

        now += 14 * 60_000L
        assertFalse("14 minutes later is still inside the gap", policy.canShow(15, 3))

        now += 60_000L
        assertTrue("15 minutes later the gate reopens", policy.canShow(15, 3))
    }

    @Test
    fun `the per-session cap is enforced even when time has passed`() {
        assertTrue(policy.canShow(everyMinutes = 1, perSessionCap = 2))
        policy.recordShown()
        now += 10 * 60_000L
        assertTrue(policy.canShow(1, 2))
        policy.recordShown()

        now += 10 * 60_000L
        assertFalse("cap of 2 is exhausted", policy.canShow(1, 2))
        assertEquals(2, policy.shownCount())
    }

    @Test
    fun `a new session resets the cap and the clock`() {
        policy.recordShown()
        policy.recordShown()
        assertEquals(2, policy.shownCount())

        policy.resetSession()
        assertEquals(0, policy.shownCount())
        assertTrue(policy.canShow(everyMinutes = 30, perSessionCap = 2))
    }
}
