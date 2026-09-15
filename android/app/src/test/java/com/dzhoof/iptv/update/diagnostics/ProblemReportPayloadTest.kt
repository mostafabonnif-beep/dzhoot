package com.dzhoof.iptv.update.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun facts(
    appVersionName: String? = "1.3.1",
    appVersionCode: Long? = 10301L,
    releaseChannel: String? = "official",
    distributionWireName: String? = "external_apk",
    lastCheckResultCode: String? = null,
    androidRelease: String? = "14",
    sdkInt: Int? = 34,
    serverVersion: String? = "1.0.1",
    serverCommit: String? = "b36f4d28",
    serverAvailable: Boolean = true,
) = DiagnosticsFacts(
    appVersionName = appVersionName,
    appVersionCode = appVersionCode,
    releaseChannel = releaseChannel,
    distributionWireName = distributionWireName,
    lastCheckResultCode = lastCheckResultCode,
    androidRelease = androidRelease,
    sdkInt = sdkInt,
    serverVersion = serverVersion,
    serverCommit = serverCommit,
    serverAvailable = serverAvailable,
)

/**
 * The payload contract for «إبلاغ عن مشكلة».
 *
 * These cases exist because a report is the one place where a customer's own words leave the
 * device: the rules that keep credentials out have to be asserted, not assumed.
 */
class ProblemReportPayloadTest {

    @Test
    fun `carries the description, the category key and the device context`() {
        val body = ProblemReportPayload.build(
            message = "القناة تتوقف بعد ثانيتين",
            category = ProblemReportPayload.Category.PLAYBACK,
            facts = facts(),
            deviceId = "dz-0018a80af2a8f852",
            platform = "android-tv",
        )

        assertEquals("القناة تتوقف بعد ثانيتين", body.getString("message"))
        // The wire value is the key, never the Arabic label.
        assertEquals("player", body.getString("feature"))
        assertEquals("android-tv", body.getString("platform"))
        assertEquals("dz-0018a80af2a8f852", body.getString("deviceId"))
        assertEquals("1.3.1", body.getString("appVersion"))
        assertEquals(10301, body.getInt("appVersionCode"))
        assertEquals("14", body.getString("androidVersion"))
        assertEquals(34, body.getInt("sdkInt"))
    }

    @Test
    fun `omits an empty description instead of sending an empty string`() {
        val body = ProblemReportPayload.build(
            message = "   ",
            category = ProblemReportPayload.Category.OTHER,
            facts = null,
            deviceId = "dz-x",
        )

        assertFalse(body.has("message"))
        assertEquals("other", body.getString("feature"))
    }

    @Test
    fun `bounds the description to the length the server accepts`() {
        val body = ProblemReportPayload.build(
            message = "ط".repeat(5_000),
            category = ProblemReportPayload.Category.OTHER,
            facts = null,
            deviceId = null,
        )

        assertEquals(ProblemReportPayload.MESSAGE_MAX, body.getString("message").length)
    }

    @Test
    fun `the diagnostic snapshot names each field and copies nothing else`() {
        val diagnostics = ProblemReportPayload.diagnostics(facts())!!

        assertEquals("1.3.1", diagnostics.getString("appVersion"))
        assertEquals("official", diagnostics.getString("releaseChannel"))
        assertEquals("external_apk", diagnostics.getString("distribution"))
        assertEquals("1.0.1", diagnostics.getString("serverVersion"))
        assertEquals("b36f4d28", diagnostics.getString("serverCommit"))
        assertTrue(diagnostics.getBoolean("serverReachable"))
        assertEquals(34, diagnostics.getInt("sdkInt"))
        // Exactly the documented keys: a field added to DiagnosticsFacts later must not
        // reach the network without being named on purpose.
        assertEquals(
            setOf(
                "appVersion", "appVersionCode", "releaseChannel", "distribution",
                "serverVersion", "serverCommit", "serverReachable", "sdkInt",
            ),
            diagnostics.keys().asSequence().toSet(),
        )
    }

    @Test
    fun `the payload never contains a secret-shaped value`() {
        // The facts carry only build identity, so this asserts the *whole* body, not a field:
        // any future field that carries a URL, a token or an account would fail here.
        val body = ProblemReportPayload.build(
            message = "المشكلة في التشغيل",
            category = ProblemReportPayload.Category.PLAYBACK,
            facts = facts(),
            deviceId = "dz-0018a80af2a8f852",
            platform = "android",
            correlationId = "3fccc0b2-b93a-416e",
            errorCode = "PLAYBACK_FAILED",
        ).toString()

        for (never in listOf("http://", "https://", "Bearer ", "eyJ", "password", "token=")) {
            assertFalse("payload leaked '$never': $body", body.contains(never))
        }
        assertTrue(body.contains("PLAYBACK_FAILED"))
        assertTrue(body.contains("3fccc0b2-b93a-416e"))
    }

    @Test
    fun `a report with no facts still builds and omits the snapshot`() {
        val body = ProblemReportPayload.build(
            message = "لا يفتح",
            category = ProblemReportPayload.Category.OTHER,
            facts = null,
            deviceId = null,
        )

        assertFalse(body.has("diagnostics"))
        assertFalse(body.has("appVersion"))
        assertNull(ProblemReportPayload.diagnostics(null))
    }

    @Test
    fun `a last update failure is reported as an error, a normal check as a warning`() {
        val failed = ProblemReportPayload.build(
            message = "التحديث لا يثبت",
            category = ProblemReportPayload.Category.UPDATE,
            facts = facts(lastCheckResultCode = "UPDATE_CHECKSUM_REQUIRED"),
            deviceId = null,
        )
        assertEquals("error", failed.getString("severity"))

        val routine = ProblemReportPayload.build(
            message = "something else",
            category = ProblemReportPayload.Category.OTHER,
            facts = facts(lastCheckResultCode = "up_to_date"),
            deviceId = null,
        )
        assertEquals("warning", routine.getString("severity"))
    }

    @Test
    fun `every category exposes a stable wire key`() {
        val keys = ProblemReportPayload.Category.entries.map { it.key }
        assertEquals(keys.size, keys.toSet().size)
        for (category in ProblemReportPayload.Category.entries) {
            assertTrue("empty key for $category", category.key.isNotBlank())
            assertTrue("empty label for $category", category.label.isNotBlank())
            // The key must survive the server's 60-character feature bound.
            assertTrue(category.key.length <= 60)
        }
    }
}
