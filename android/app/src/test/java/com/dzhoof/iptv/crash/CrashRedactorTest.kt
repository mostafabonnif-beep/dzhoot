package com.dzhoof.iptv.crash

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val XTREAM_QUERY_URL =
    "http://xtream.example.test:8080/get.php?username=dz-user&password=SuperSecret1&type=m3u_plus"
private const val XTREAM_PATH_URL =
    "https://xtream.example.test:8080/live/dz-user/SuperSecret1/1423.ts"
private const val USERINFO_URL = "https://dz-user:SuperSecret1@xtream.example.test/player_api.php"
private const val JWT =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJyb2xlIjoiVXNlciJ9.c2lnbmF0dXJlLXZhbHVl"

/**
 * The device-side half of the crash-report privacy contract (operations brief §7): a report
 * that leaves the device must not carry an Xtream account, a playlist URL with credentials,
 * a bearer token or a playback JWT — while still naming the failure so the bug can be
 * reproduced.
 */
class CrashRedactorTest {

    private fun assertRedacted(original: String, secret: String): String {
        val redacted = CrashRedactor.redact(original)
        assertTrue("expected a non-null result for: $original", redacted != null)
        assertFalse("secret leaked: $secret", redacted!!.contains(secret))
        return redacted
    }

    @Test
    fun `strips credentials from an Xtream query URL`() {
        val redacted = assertRedacted("java.io.IOException: failed $XTREAM_QUERY_URL", "SuperSecret1")

        assertFalse(redacted.contains("dz-user"))
        assertTrue(redacted.contains("password=[redacted]"))
        assertTrue(redacted.contains("java.io.IOException: failed"))
    }

    @Test
    fun `strips the Xtream account carried as path segments`() {
        val redacted = assertRedacted("Unable to open $XTREAM_PATH_URL", "SuperSecret1")

        assertFalse(redacted.contains("dz-user"))
        assertTrue(redacted.contains("/live/[redacted]/[redacted]/1423.ts"))
    }

    @Test
    fun `strips credentials embedded in a URL authority`() {
        val redacted = assertRedacted("GET $USERINFO_URL failed", "SuperSecret1")

        assertFalse(redacted.contains("dz-user"))
        assertTrue(redacted.contains("https://[redacted]@xtream.example.test"))
    }

    @Test
    fun `strips bearer tokens and JWTs`() {
        val bearer = assertRedacted("Authorization: Bearer $JWT", JWT)
        assertTrue(bearer.contains("Bearer [redacted]"))

        val jwtOnly = assertRedacted("playback rejected: $JWT", JWT)
        assertTrue(jwtOnly.contains("[redacted-jwt]"))
    }

    @Test
    fun `strips secret assignments and api keys`() {
        val redacted = assertRedacted(
            "config error: password=SuperSecret1 api_key=abc123 token: SuperSecret1",
            "SuperSecret1",
        )

        assertFalse(redacted.contains("abc123"))
        assertTrue(redacted.contains("password=[redacted]"))
    }

    @Test
    fun `keeps the failure site so the report stays actionable`() {
        val redacted = CrashRedactor.redact(
            "java.lang.IllegalStateException: playlist $XTREAM_QUERY_URL\n" +
                "\tat com.dzhoof.iptv.data.remote.XtreamApi.fetch(XtreamApi.kt:120)",
        )

        assertTrue(redacted!!.contains("java.lang.IllegalStateException"))
        assertTrue(redacted.contains("XtreamApi.kt:120"))
    }

    @Test
    fun `returns null for blank input and null`() {
        assertNull(CrashRedactor.redact(null))
        assertNull(CrashRedactor.redact(""))
        assertNull(CrashRedactor.redact("   "))
    }

    @Test
    fun `bounds the stored text`() {
        val redacted = CrashRedactor.redact("x".repeat(100_000))

        assertEquals(CrashRedactor.MAX_CHARS, redacted!!.length)
    }

    @Test
    fun `log line carries the type only, never the message`() {
        assertEquals("IOException", CrashRedactor.logSafeExceptionType("java.io.IOException"))
        assertEquals("Throwable", CrashRedactor.logSafeExceptionType(null))
        assertEquals("Throwable", CrashRedactor.logSafeExceptionType("   "))
    }
}
