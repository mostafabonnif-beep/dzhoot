package com.dzhoof.iptv.crash

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A crash report must say **where** the app crashed without carrying user data.
 *
 * The endpoint has always accepted `screen` (100 chars) and the app never sent it,
 * so all seven reports in production arrived with `screen: null`. Fixing that must
 * not turn a diagnostic field into a data leak: only the route *pattern* is kept.
 */
class CurrentScreenTrackerTest {

    @Test
    fun `keeps the route pattern and drops the query`() {
        assertEquals(
            "player/{channelId}",
            CurrentScreenTracker.sanitize("player/{channelId}?catchupStart={catchupStart}&catchupDur={catchupDur}"),
        )
    }

    @Test
    fun `keeps nested route patterns`() {
        assertEquals(
            "channels/category/{categoryId}",
            CurrentScreenTracker.sanitize("channels/category/{categoryId}"),
        )
        assertEquals("multiview", CurrentScreenTracker.sanitize("multiview?channelId={channelId}"))
    }

    @Test
    fun `a blank or missing route is not recorded`() {
        assertNull(CurrentScreenTracker.sanitize(null))
        assertNull(CurrentScreenTracker.sanitize(""))
        assertNull(CurrentScreenTracker.sanitize("   "))
        // Nothing but a query string carries no location.
        assertNull(CurrentScreenTracker.sanitize("?code=ABC123"))
    }

    @Test
    fun `a token-shaped segment is masked even if a caller passes a filled route`() {
        val sanitized = CurrentScreenTracker.sanitize("playback/AbCd0123456789EfGhIjKl")

        assertEquals("playback/***", sanitized)
    }

    @Test
    fun `the value respects the server length limit`() {
        // Many short segments: a single long segment would be masked as a token,
        // which is a different rule under test above.
        val long = (1..60).joinToString("/") { "seg\$it" }

        val sanitized = CurrentScreenTracker.sanitize(long)

        assertEquals(CurrentScreenTracker.MAX_LENGTH, sanitized?.length)
        assertTrue(CurrentScreenTracker.MAX_LENGTH <= 100)
    }

    @Test
    fun `the tracker remembers the last destination`() {
        CurrentScreenTracker.onDestinationChanged("home")
        assertEquals("home", CurrentScreenTracker.current())

        CurrentScreenTracker.onDestinationChanged("player/{channelId}?slot=2")
        assertEquals("player/{channelId}", CurrentScreenTracker.current())
    }
}
