package com.dzhoof.iptv.presentation.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Channel ids are not always safe route segments.
 *
 * A bring-your-own M3U/Xtream playlist derives the channel id from the display
 * name when the entry has no tvg-id (`M3uDataSource` → "m3u-$index-${name}"), so
 * ids routinely contain '/', '&', '#' and spaces. Interpolated raw into a route,
 * a '/' adds a path segment and Navigation throws
 * `IllegalArgumentException: Navigation destination ... cannot be found`, and an
 * '&'/'#' in a query value truncates the argument.
 */
class ScreenRouteEncodingTest {

    @Test
    fun `player route encodes a channel id containing a slash`() {
        val route = Screen.Player.createRoute("m3u-3-24/7 HD")

        assertTrue("route must not gain a path segment: $route", route.startsWith("player/"))
        assertFalse(route.removePrefix("player/").contains('/'))
        assertTrue(route.contains("%2F"))
        assertTrue(route.contains("24%2F7"))
    }

    @Test
    fun `catch-up route encodes the id and still carries the query parameters`() {
        val route = Screen.Player.createCatchupRoute("m3u-1-NEWS & SPORT", 1_700_000_000_000L, 90)

        assertFalse("'&' in the id must not leak into the query string", route.contains("NEWS & SPORT"))
        assertTrue(route.contains("catchupStart=1700000000000"))
        assertTrue(route.contains("catchupDur=90"))
        // Exactly one query separator.
        assertEquals(1, route.count { it == '?' })
    }

    @Test
    fun `multiview route encodes its query argument`() {
        val route = Screen.Multiview.createRoute("ch&1")

        assertEquals("multiview?channelId=ch%261", route)
    }

    @Test
    fun `multiview route without a channel stays bare`() {
        assertEquals("multiview", Screen.Multiview.createRoute(null))
        assertEquals("multiview", Screen.Multiview.createRoute("   "))
    }

    @Test
    fun `plain ids are carried through unchanged`() {
        assertEquals("player/entv-1", Screen.Player.createRoute("entv-1"))
        assertEquals("multiview?channelId=entv-1", Screen.Multiview.createRoute("entv-1"))
    }
}
