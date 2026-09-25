package com.dzhoof.iptv.data.source.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Unit tests for the local↔server key mapping that makes cross-device resume
 * possible at all: the Room table keys positions by `channelId` while the server
 * keys them by `(contentType, contentId)`.
 *
 * The VOD shape asserted here must stay in lockstep with
 * `VodPlayerViewModel.progressKey()` (`vod:<type>:<id>`); if that changes without
 * this mapper, every movie and episode silently stops syncing.
 */
class WatchProgressContentKeyTest {

    @Test
    fun `a live row maps to the raw channel id`() {
        assertEquals("ch-1", WatchProgressContentKey.localKey("live", "ch-1"))
    }

    @Test
    fun `vod rows map to the local vod key`() {
        assertEquals(
            "vod:movie:m1",
            WatchProgressContentKey.localKey("movie", "m1"),
        )
        assertEquals(
            "vod:episode:e9",
            WatchProgressContentKey.localKey("episode", "e9"),
        )
        assertEquals(
            "vod:series:s3",
            WatchProgressContentKey.localKey("series", "s3"),
        )
    }

    @Test
    fun `content type casing and padding are normalised`() {
        assertEquals("vod:movie:m1", WatchProgressContentKey.localKey(" Movie ", " m1 "))
        assertEquals("ch-1", WatchProgressContentKey.localKey("LIVE", "ch-1"))
    }

    @Test
    fun `unknown or incomplete rows are skipped instead of guessed`() {
        // A server that adds a content type must not make the app resume the wrong
        // stream: the row is dropped and the rest of the list still syncs.
        assertNull(WatchProgressContentKey.localKey("audiobook", "a1"))
        assertNull(WatchProgressContentKey.localKey(null, "m1"))
        assertNull(WatchProgressContentKey.localKey("movie", null))
        assertNull(WatchProgressContentKey.localKey("movie", "   "))
        assertNull(WatchProgressContentKey.localKey("", "m1"))
    }

    @Test
    fun `local channel keys and vod keys map back to the right server pair`() {
        assertEquals("live" to "ch-1", WatchProgressContentKey.serverKey("ch-1"))
        assertEquals("movie" to "m1", WatchProgressContentKey.serverKey("vod:movie:m1"))
        assertEquals("episode" to "e9", WatchProgressContentKey.serverKey("vod:episode:e9"))
        assertEquals("series" to "s3", WatchProgressContentKey.serverKey("vod:series:s3"))
    }

    @Test
    fun `malformed local keys are not pushed`() {
        assertNull(WatchProgressContentKey.serverKey(""))
        assertNull(WatchProgressContentKey.serverKey("   "))
        // A half-built vod key would otherwise be pushed under a wrong type.
        assertNull(WatchProgressContentKey.serverKey("vod:movie"))
        assertNull(WatchProgressContentKey.serverKey("vod:movie:"))
        assertNull(WatchProgressContentKey.serverKey("vod:audiobook:a1"))
        // A 'live' segment inside a vod key is nonsense.
        assertNull(WatchProgressContentKey.serverKey("vod:live:x"))
        // A bare channel id never contains a separator.
        assertNull(WatchProgressContentKey.serverKey("vod:movie:m1:extra"))
    }

    @Test
    fun `the two directions round-trip`() {
        listOf(
            "live" to "ch-1",
            "movie" to "m1",
            "episode" to "e9",
            "series" to "s3",
        ).forEach { (type, id) ->
            val local = WatchProgressContentKey.localKey(type, id)
            assertEquals(type to id, WatchProgressContentKey.serverKey(local!!))
        }
    }
}
