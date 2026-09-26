package com.dzhoof.iptv.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression: managed (server-authorized) playback must accept EITHER credential
 * the server accepts — a paired TV code OR a signed-in account session.
 *
 * The server (`requireTvOrSessionAuth`) and the shared HTTP client
 * (`di/NetworkModule`, which sends both `X-TV-Code` and `X-Session-Id`) treat the
 * two as interchangeable. Three playback call sites used to require the TV code
 * alone, so every account-only user fell through to the raw-URL branch — where
 * the server intentionally returns an empty `channelUrl` — and no channel played.
 */
class ManagedPlaybackCredentialTest {

    @Test
    fun `a paired TV code alone authorizes managed playback`() {
        assertTrue(AppPreferences.hasManagedPlaybackCredential(tvCode = "ABC123", sessionId = ""))
    }

    @Test
    fun `an account session alone authorizes managed playback`() {
        assertTrue(AppPreferences.hasManagedPlaybackCredential(tvCode = "", sessionId = "sess-abc"))
    }

    @Test
    fun `holding both credentials is fine`() {
        assertTrue(AppPreferences.hasManagedPlaybackCredential(tvCode = "ABC123", sessionId = "sess-abc"))
    }

    @Test
    fun `no credential at all does not authorize managed playback`() {
        assertFalse(AppPreferences.hasManagedPlaybackCredential(tvCode = "", sessionId = ""))
    }
}
