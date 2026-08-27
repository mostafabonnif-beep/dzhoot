package com.dzhoof.iptv.update

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateUrlPolicyTest {
    @Test
    fun `accepts https link from configured server`() {
        assertTrue(
            UpdateUrlPolicy.isAllowed(
                "https://iptv.ld-11.net/downloads/DZHOOF.apk",
                "iptv.ld-11.net",
            ),
        )
    }

    @Test
    fun `accepts official github release hosts`() {
        assertTrue(UpdateUrlPolicy.isAllowed("https://github.com/example/release.apk", "iptv.ld-11.net"))
        assertTrue(UpdateUrlPolicy.isAllowed("https://objects.githubusercontent.com/release.apk", "iptv.ld-11.net"))
        assertTrue(UpdateUrlPolicy.isAllowed("https://release-assets.githubusercontent.com/release.apk", "iptv.ld-11.net"))
    }

    @Test
    fun `rejects http and unknown hosts`() {
        assertFalse(UpdateUrlPolicy.isAllowed("http://iptv.ld-11.net/release.apk", "iptv.ld-11.net"))
        assertFalse(UpdateUrlPolicy.isAllowed("https://evil.example/release.apk", "iptv.ld-11.net"))
        assertFalse(UpdateUrlPolicy.isAllowed("https://githubusercontent.com.evil.example/release.apk", "iptv.ld-11.net"))
    }

    @Test
    fun `rejects malformed or hostless links`() {
        assertFalse(UpdateUrlPolicy.isAllowed("not-a-url", "iptv.ld-11.net"))
        assertFalse(UpdateUrlPolicy.isAllowed("file:///sdcard/DZHOOF.apk", "iptv.ld-11.net"))
    }

    @Test
    fun `configured host comparison ignores case and trailing dot`() {
        assertTrue(UpdateUrlPolicy.isAllowed("https://IPTV.LD-11.NET/release.apk", "iptv.ld-11.net."))
    }
}
