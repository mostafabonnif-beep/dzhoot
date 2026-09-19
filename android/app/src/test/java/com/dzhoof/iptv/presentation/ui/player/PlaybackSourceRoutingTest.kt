package com.dzhoof.iptv.presentation.ui.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure-JVM tests for the single container-routing decision (defect D1):
 * an extension-less relay URL with a null mimeType must NOT be treated as HLS.
 */
class PlaybackSourceRoutingTest {

    @Test
    fun `null mime on extensionless relay url routes to progressive`() {
        assertEquals(
            PlaybackContainer.PROGRESSIVE,
            PlaybackSourceRouting.containerFor("https://relay.example/tv/playback/opaque-token", null),
        )
    }

    @Test
    fun `blank mime on extensionless relay url routes to progressive`() {
        assertEquals(
            PlaybackContainer.PROGRESSIVE,
            PlaybackSourceRouting.containerFor("https://relay.example/tv/playback/opaque-token", "   "),
        )
    }

    @Test
    fun `hls mime variants route to hls`() {
        assertEquals(
            PlaybackContainer.HLS,
            PlaybackSourceRouting.containerFor("https://relay.example/opaque", "application/x-mpegURL"),
        )
        assertEquals(
            PlaybackContainer.HLS,
            PlaybackSourceRouting.containerFor("https://relay.example/opaque", "application/vnd.apple.mpegurl"),
        )
        assertEquals(
            PlaybackContainer.HLS,
            PlaybackSourceRouting.containerFor("https://relay.example/opaque", "application/x-mpegurl; charset=utf-8"),
        )
    }

    @Test
    fun `raw mpeg-ts mime routes to progressive`() {
        assertEquals(
            PlaybackContainer.PROGRESSIVE,
            PlaybackSourceRouting.containerFor("https://relay.example/opaque", "video/mp2t"),
        )
    }

    @Test
    fun `null mime falls back to url extension`() {
        assertEquals(
            PlaybackContainer.HLS,
            PlaybackSourceRouting.containerFor("https://host/live/channel.m3u8", null),
        )
        assertEquals(
            PlaybackContainer.PROGRESSIVE,
            PlaybackSourceRouting.containerFor("https://host/live/channel.ts", null),
        )
        // Query string must not hide the extension.
        assertEquals(
            PlaybackContainer.HLS,
            PlaybackSourceRouting.containerFor("https://host/live/channel.m3u8?token=abc", null),
        )
    }

    @Test
    fun `opposite flips both ways`() {
        assertEquals(
            PlaybackContainer.PROGRESSIVE,
            PlaybackSourceRouting.opposite(PlaybackContainer.HLS),
        )
        assertEquals(
            PlaybackContainer.HLS,
            PlaybackSourceRouting.opposite(PlaybackContainer.PROGRESSIVE),
        )
    }

    @Test
    fun `isHlsMimeType recognises ecosystem spellings and rejects ts`() {
        assertTrue(PlaybackSourceRouting.isHlsMimeType("application/x-mpegURL"))
        assertTrue(PlaybackSourceRouting.isHlsMimeType("application/vnd.apple.mpegurl"))
        assertTrue(PlaybackSourceRouting.isHlsMimeType("application/vnd.apple.streaming"))
        assertFalse(PlaybackSourceRouting.isHlsMimeType("video/mp2t"))
        assertFalse(PlaybackSourceRouting.isHlsMimeType("video/mp4"))
    }
}
