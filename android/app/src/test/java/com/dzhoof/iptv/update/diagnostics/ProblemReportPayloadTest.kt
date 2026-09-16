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

        assertEquals("القناة تتوقف بعد ثانيتين", body["message"])
        // The wire value is the key, never the Arabic label.
        assertEquals("player", body["feature"])
        assertEquals("android-tv", body["platform"])
        assertEquals("dz-0018a80af2a8f852", body["deviceId"])
        assertEquals("1.3.1", body["appVersion"])
        assertEquals(10301, body["appVersionCode"])
        assertEquals("14", body["androidVersion"])
        assertEquals(34, body["sdkInt"])
    }

    @Test
    fun `omits an empty description instead of sending an empty string`() {
        val body = ProblemReportPayload.build(
            message = "   ",
            category = ProblemReportPayload.Category.OTHER,
            facts = null,
            deviceId = "dz-x",
        )

        assertFalse(body.containsKey("message"))
        assertEquals("other", body["feature"])
    }

    @Test
    fun `bounds the description to the length the server accepts`() {
        val body = ProblemReportPayload.build(
            message = "ط".repeat(5_000),
            category = ProblemReportPayload.Category.OTHER,
            facts = null,
            deviceId = null,
        )

        assertEquals(ProblemReportPayload.MESSAGE_MAX, (body["message"] as String).length)
    }

    @Test
    fun `the diagnostic snapshot names each field and copies nothing else`() {
        val diagnostics = ProblemReportPayload.diagnostics(facts())!!

        assertEquals("1.3.1", diagnostics["appVersion"])
        assertEquals("official", diagnostics["releaseChannel"])
        assertEquals("external_apk", diagnostics["distribution"])
        assertEquals("1.0.1", diagnostics["serverVersion"])
        assertEquals("b36f4d28", diagnostics["serverCommit"])
        assertEquals(true, diagnostics["serverReachable"])
        assertEquals(34, diagnostics["sdkInt"])
        // Exactly the documented keys: a field added to DiagnosticsFacts later must not
        // reach the network without being named on purpose.
        assertEquals(
            setOf(
                "appVersion", "appVersionCode", "releaseChannel", "distribution",
                "serverVersion", "serverCommit", "serverReachable", "sdkInt",
            ),
            diagnostics.keys,
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

        assertFalse(body.containsKey("diagnostics"))
        assertFalse(body.containsKey("appVersion"))
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
        assertEquals("error", failed["severity"])

        val routine = ProblemReportPayload.build(
            message = "something else",
            category = ProblemReportPayload.Category.OTHER,
            facts = facts(lastCheckResultCode = "up_to_date"),
            deviceId = null,
        )
        assertEquals("warning", routine["severity"])
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
