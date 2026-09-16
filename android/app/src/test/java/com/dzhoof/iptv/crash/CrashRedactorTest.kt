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
        // An `Authorization:` header is now consumed whole (scheme included), because the
        // assignment rule only matched the scheme word and left the credential behind.
        val header = assertRedacted("Authorization: Bearer $JWT", JWT)
        assertTrue(header.contains("Authorization: [redacted]"))

        // The scheme also appears without the header form.
        val inline = assertRedacted("upstream said: Bearer $JWT (401)", JWT)
        assertTrue(inline.contains("Bearer [redacted]"))

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
    fun `strips a cookie header`() {
        val redacted = assertRedacted(
            "okhttp3.Request: Cookie: session=abc123def456; csrf=zzz",
            "abc123def456",
        )

        assertFalse(redacted.contains("csrf=zzz"))
        assertTrue(redacted.contains("Cookie: [redacted]"))
    }

    @Test
    fun `strips a Set-Cookie header`() {
        val redacted = assertRedacted(
            "response header Set-Cookie: playback_token=topsecret",
            "topsecret",
        )

        assertTrue(redacted.contains("[redacted]"))
    }

    @Test
    fun `strips raw IPv4 addresses`() {
        // The operations brief forbids shipping a raw IP off the device: it identifies the
        // viewer's connection or an upstream host and is never needed to reproduce a crash.
        val redacted = assertRedacted(
            "SocketTimeoutException: failed to connect to /185.199.108.153 (port 8080)",
            "185.199.108.153",
        )

        assertTrue(redacted.contains("[redacted-ip]"))
        assertTrue(redacted.contains("SocketTimeoutException"))
    }

    @Test
    fun `strips credentials and the IP from a playback URL in one pass`() {
        val redacted = assertRedacted(
            "ExoPlaybackException at http://dz-user:SuperSecret1@185.199.108.153:8080/live/",
            "SuperSecret1",
        )

        assertFalse(redacted.contains("dz-user"))
        assertFalse(redacted.contains("185.199.108.153"))
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

    // ---------------------------------------------------------------------------------
    // The table below mirrors `redactSensitiveText`'s "secret classes that survived the
    // 2026-09-15 rules" block in `server/backend/src/services/audit-log.test.ts`. Both
    // implementations must agree: a crash report is redacted on the device *and* again on
    // ingest, and the server cannot fix a payload the device already leaked.
    // ---------------------------------------------------------------------------------

    @Test
    fun `strips a JSON-encoded secret assignment`() {
        // JSONObject.toString() output is exactly what a throwable message carries, and the
        // previous rule required `[:=]` immediately after the bare key name, so the whole
        // JSON body passed through untouched.
        val password = assertRedacted("""java.lang.IllegalStateException: {"password":"hunter2","user":"ali"}""", "hunter2")
        assertTrue(password.contains(""""password":"[redacted]""""))

        val token = assertRedacted("""body: {"token":"abc123","ok":true}""", "abc123")
        assertTrue(token.contains(""""token":"[redacted]""""))
    }

    @Test
    fun `strips the credential of an Authorization header, not just the scheme word`() {
        val redacted = assertRedacted("Authorization: Basic dXNlcjpwYXNz", "dXNlcjpwYXNz")

        assertTrue(redacted.contains("Authorization: [redacted]"))
    }

    @Test
    fun `strips an Authorization header regardless of the key casing`() {
        // The assignment rule was case-sensitive, so a capital `A` alone let the credential
        // through.
        val redacted = assertRedacted("authorization: Basic dXNlcjpwYXNz", "dXNlcjpwYXNz")

        assertTrue(redacted.contains("[redacted]"))
    }

    @Test
    fun `strips an inline auth scheme with no header form`() {
        val redacted = assertRedacted("upstream rejected: Basic dXNlcjpwYXNz (401)", "dXNlcjpwYXNz")

        assertTrue(redacted.contains("Basic [redacted]"))
    }

    @Test
    fun `strips cookie and session assignments outside a header line`() {
        val cookies = assertRedacted("cookies=sessionid=abc123def", "abc123def")
        val session = assertRedacted("sessionid=abc123def", "abc123def")

        assertTrue(cookies.contains("[redacted]"))
        assertTrue(session.contains("[redacted]"))
    }

    @Test
    fun `strips credentials in a non-HTTP stream URL`() {
        // IPTV failures routinely carry an rtsp/rtmp URL; the URL rule was `https?`-only.
        val redacted = assertRedacted("rtsp://operator:s3cret@10.0.0.5/live/1 failed", "s3cret")

        assertTrue(redacted.contains("[redacted]@[redacted-ip]"))
    }

    @Test
    fun `strips IPv6 addresses in every shape that appears in diagnostics`() {
        val compressed = assertRedacted("connect to 2001:db8::1 refused", "2001:db8::1")
        val bracketed = assertRedacted("http://[2001:db8::1]/live/a/b/1.ts failed", "2001:db8::1")
        val loopback = assertRedacted("bind ::1 failed", "::1")
        val full = assertRedacted("peer fe80:0:0:0:0:0:0:1 down", "fe80:0:0:0:0:0:0:1")

        for (value in listOf(compressed, bracketed, loopback, full)) {
            assertTrue("expected an IP placeholder in: $value", value.contains("[redacted-ip]"))
        }
    }

    @Test
    fun `keeps a wall-clock time and a file line reference readable`() {
        // The IPv6 rule requires a literal `::`, so ordinary times never match.
        assertEquals("timed out after 12:34:56", CrashRedactor.redact("timed out after 12:34:56"))
        assertEquals(
            "StreamRepository.kt:412 retry",
            CrashRedactor.redact("StreamRepository.kt:412 retry"),
        )
    }

    @Test
    fun `log line carries the type only, never the message`() {
        assertEquals("IOException", CrashRedactor.logSafeExceptionType("java.io.IOException"))
        assertEquals("Throwable", CrashRedactor.logSafeExceptionType(null))
        assertEquals("Throwable", CrashRedactor.logSafeExceptionType("   "))
    }
}
