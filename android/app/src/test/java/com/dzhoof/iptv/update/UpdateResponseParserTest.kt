package com.dzhoof.iptv.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val SHA256 = "f0494df3f964b5f16ccb50be945e98cc25fa95a8fa187189c399a81a1b481e85"
private const val APK_URL =
    "https://github.com/mostafabonnif-beep/dzhoot/releases/download/v1.4.2/dzhoof-tv-v1.4.2-official.apk"

/**
 * The device-side half of the update-metadata contract.
 *
 * These cases pin the behaviour that was missing: the parser used to read only the fields it
 * named, so `checksumSource` and `updateBlockedReason` were never looked at and a release the
 * server had deliberately withheld was reported to the user as "you are up to date".
 */
class UpdateResponseParserTest {

    private fun offer(overrides: String = ""): String = """
        {
          "success": true,
          "updateAvailable": true,
          "mandatory": false,
          "currentVersionCode": 10300,
          "latestVersion": {
            "versionName": "1.4.2",
            "versionCode": 10402,
            "minimumSupportedVersionCode": 10300,
            "releaseChannel": "stable",
            "distribution": "external_apk",
            "downloadUrl": "$APK_URL",
            "sha256": "$SHA256",
            "checksumSource": "manifest",
            "signerSha256": "5938049a7b7eb803d7354efb96ca1989fdf17af1f62ff0e7fb68bd765920bb11",
            "sizeBytes": 26840396,
            "releaseNotes": "تحسين الثبات",
            "apkFileSize": 26840396,
            "isMandatory": false,
            "minCompatibleVersion": 10300
          },
          "currentVersion": 10300,
          "isMandatory": false,
          "source": "github"
          ${if (overrides.isBlank()) "" else ",$overrides"}
        }
    """.trimIndent()

    @Test
    fun `parses a verifiable release into an offer`() {
        val outcome = UpdateResponseParser.parse(offer())

        assertTrue(outcome is UpdateResponseParser.Outcome.Offered)
        val update = (outcome as UpdateResponseParser.Outcome.Offered).update
        assertEquals("1.4.2", update.versionName)
        assertEquals(10402, update.versionCode)
        assertEquals(APK_URL, update.downloadUrl)
        assertEquals(SHA256, update.sha256)
        assertEquals("manifest", update.checksumSource)
        assertEquals(26840396L, update.sizeBytes)
        assertEquals(26840396L, update.sizeBytes)
    }

    @Test
    fun `reports the device as current when no update is offered`() {
        val outcome = UpdateResponseParser.parse(
            """{"success":true,"updateAvailable":false,"currentVersionCode":10402,
               "latestVersion":{"versionName":"1.4.2","sha256":"$SHA256"}}"""
        )

        assertEquals(UpdateResponseParser.Outcome.Current, outcome)
    }

    @Test
    fun `reports a withheld release instead of claiming the device is up to date`() {
        // The bug this replaces: the server answers `updateAvailable:false` *and*
        // `updateBlockedReason:CHECKSUM_UNAVAILABLE`, and the app showed "you are up to
        // date" — telling the user something false and hiding the release problem.
        val outcome = UpdateResponseParser.parse(
            """{"success":true,"updateAvailable":false,"updateBlockedReason":"CHECKSUM_UNAVAILABLE",
               "currentVersionCode":10300,
               "latestVersion":{"versionName":"1.4.2","versionCode":10402,"sha256":null,
                                "checksumSource":null,"downloadUrl":null}}"""
        )

        assertTrue(outcome is UpdateResponseParser.Outcome.HeldForVerification)
        assertEquals(
            "1.4.2",
            (outcome as UpdateResponseParser.Outcome.HeldForVerification).versionName,
        )
    }

    @Test
    fun `refuses an offered release that carries no checksum (fail closed)`() {
        val outcome = UpdateResponseParser.parse(
            """{"success":true,"updateAvailable":true,
               "latestVersion":{"versionName":"1.4.2","versionCode":10402,
                                "downloadUrl":"$APK_URL","sha256":null}}"""
        )

        assertTrue(outcome is UpdateResponseParser.Outcome.Invalid)
        assertEquals(
            UpdateErrorCode.UPDATE_CHECKSUM_REQUIRED,
            (outcome as UpdateResponseParser.Outcome.Invalid).code,
        )
    }

    @Test
    fun `refuses an offered release whose checksum is not 64 hex characters`() {
        for (bad in listOf("abc", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", "")) {
            val outcome = UpdateResponseParser.parse(
                """{"success":true,"updateAvailable":true,
                   "latestVersion":{"versionName":"1.4.2","versionCode":10402,
                                    "downloadUrl":"$APK_URL","sha256":"$bad"}}"""
            )
            assertTrue("expected a refusal for '$bad'", outcome is UpdateResponseParser.Outcome.Invalid)
        }
    }

    @Test
    fun `refuses an offer with no download URL`() {
        val outcome = UpdateResponseParser.parse(
            """{"success":true,"updateAvailable":true,
               "latestVersion":{"versionName":"1.4.2","versionCode":10402,
                                "downloadUrl":null,"sha256":"$SHA256"}}"""
        )

        assertTrue(outcome is UpdateResponseParser.Outcome.Invalid)
        assertEquals(
            UpdateErrorCode.UPDATE_METADATA_INVALID,
            (outcome as UpdateResponseParser.Outcome.Invalid).code,
        )
    }

    @Test
    fun `refuses a body that is not usable JSON`() {
        for (body in listOf(null, "", "not json", "<html>502</html>", """{"success":false}""")) {
            val outcome = UpdateResponseParser.parse(body)
            assertTrue("expected a refusal for '$body'", outcome is UpdateResponseParser.Outcome.Invalid)
        }
    }

    @Test
    fun `an offer without latestVersion is invalid rather than silently ignored`() {
        val outcome = UpdateResponseParser.parse(
            """{"success":true,"updateAvailable":true,"latestVersion":null}"""
        )

        assertTrue(outcome is UpdateResponseParser.Outcome.Invalid)
    }

    @Test
    fun `reads the legacy top-level mandatory flag when the contract one is absent`() {
        val outcome = UpdateResponseParser.parse(
            """{"success":true,"updateAvailable":true,"isMandatory":true,
               "latestVersion":{"versionName":"1.4.2","versionCode":10402,
                                "downloadUrl":"$APK_URL","sha256":"$SHA256"}}"""
        )

        val update = (outcome as UpdateResponseParser.Outcome.Offered).update
        assertEquals(true, update.isMandatory)
        assertNull(update.checksumSource)
    }

    @Test
    fun `recognizes only 64 hex characters as a checksum`() {
        assertTrue(UpdateResponseParser.isSha256(SHA256))
        assertTrue(UpdateResponseParser.isSha256(SHA256.uppercase()))
        assertTrue(!UpdateResponseParser.isSha256(null))
        assertTrue(!UpdateResponseParser.isSha256(""))
        assertTrue(!UpdateResponseParser.isSha256(SHA256.dropLast(1)))
        assertTrue(!UpdateResponseParser.isSha256(SHA256 + "a"))
        assertTrue(!UpdateResponseParser.isSha256("z".repeat(64)))
    }
}
