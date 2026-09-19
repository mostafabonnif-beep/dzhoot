package com.dzhoof.iptv.presentation.ui.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EmptyPlaylistProbeTest {

    @Test
    fun `null body is treated as empty`() {
        assertTrue(EmptyPlaylistProbe.isPlaylistEmpty(null))
    }

    @Test
    fun `empty body is treated as empty`() {
        assertTrue(EmptyPlaylistProbe.isPlaylistEmpty(""))
    }

    @Test
    fun `header-only media playlist is empty`() {
        assertTrue(EmptyPlaylistProbe.isPlaylistEmpty("#EXTM3U\n"))
    }

    @Test
    fun `master playlist is not empty`() {
        val master = """
            #EXTM3U
            #EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
            https://cdn.example.com/low/index.m3u8
        """.trimIndent()

        assertFalse(EmptyPlaylistProbe.isPlaylistEmpty(master))
    }

    @Test
    fun `playlist with a segment is not empty`() {
        val media = """
            #EXTM3U
            #EXT-X-TARGETDURATION:6
            #EXTINF:6.0,
            segment0.ts
        """.trimIndent()

        assertFalse(EmptyPlaylistProbe.isPlaylistEmpty(media))
    }

    @Test
    fun `arbitrary junk is never claimed as empty`() {
        assertFalse(EmptyPlaylistProbe.isPlaylistEmpty("hello"))
    }
}
