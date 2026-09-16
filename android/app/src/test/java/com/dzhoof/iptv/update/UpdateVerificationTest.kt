package com.dzhoof.iptv.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private const val APK_URL =
    "https://github.com/mostafabonnif-beep/dzhoot/releases/download/v1.4.2/dzhoof-tv-v1.4.2-official.apk"
private const val SHA256 = "f0494df3f964b5f16ccb50be945e98cc25fa95a8fa187189c399a81a1b481e85"
private const val PACKAGE = "com.dzhoof.iptv"

private fun expected(
    versionCode: Int? = 10402,
    sha256: String? = SHA256,
    sizeBytes: Long? = 26840396L,
) = ExpectedArtifact(
    packageName = PACKAGE,
    versionCode = versionCode,
    sha256 = sha256,
    sizeBytes = sizeBytes,
)

private fun observed(
    downloadUrl: String = APK_URL,
    sizeBytes: Long = 26840396L,
    sha256: String? = SHA256,
    archivePackageName: String? = PACKAGE,
    archiveVersionCode: Int? = 10402,
    signatureMatches: Boolean? = true,
) = ObservedArtifact(
    downloadUrl = downloadUrl,
    sizeBytes = sizeBytes,
    sha256 = sha256,
    archivePackageName = archivePackageName,
    archiveVersionCode = archiveVersionCode,
    signatureMatches = signatureMatches,
)

private fun blocked(result: UpdateVerificationResult): UpdateErrorCode {
    assertTrue("expected a blocked result, got $result", result is UpdateVerificationResult.Blocked)
    return (result as UpdateVerificationResult.Blocked).code
}

class ApkUrlPolicyTest {

    @Test
    fun `allows https downloads from allowlisted hosts and their subdomains`() {
        assertTrue(ApkUrlPolicy.isAllowed(APK_URL))
        assertTrue(ApkUrlPolicy.isAllowed("https://objects.githubusercontent.com/x.apk"))
        assertTrue(ApkUrlPolicy.isAllowed("https://release.github.com/x.apk"))
    }

    @Test
    fun `rejects non-https, unknown hosts and ip literals`() {
        assertFalse(ApkUrlPolicy.isAllowed("http://github.com/x.apk"))
        assertFalse(ApkUrlPolicy.isAllowed("https://evil.example.com/x.apk"))
        assertFalse(ApkUrlPolicy.isAllowed("https://127.0.0.1/x.apk"))
        assertFalse(ApkUrlPolicy.isAllowed("https://10.1.2.3/x.apk"))
        assertFalse(ApkUrlPolicy.isAllowed("https://[::1]/x.apk"))
        assertFalse(ApkUrlPolicy.isAllowed(""))
        assertFalse(ApkUrlPolicy.isAllowed("not a url"))
    }

    @Test
    fun `rejects credentials in the url and internal hostnames`() {
        assertFalse(ApkUrlPolicy.isAllowed("https://user:pass@github.com/x.apk"))
        assertFalse(ApkUrlPolicy.isAllowed("https://localhost/x.apk"))
        assertFalse(ApkUrlPolicy.isAllowed("https://mirror.internal/x.apk"))
    }

    @Test
    fun `accepts the configured api host in addition to github`() {
        val hosts = ApkUrlPolicy.allowedHosts("https://iptv.ld-11.net/")
        assertTrue(ApkUrlPolicy.isAllowed("https://iptv.ld-11.net/api/v1/app/download", hosts))
        assertTrue(ApkUrlPolicy.isAllowed(APK_URL, hosts))
        assertFalse(ApkUrlPolicy.isAllowed("https://evil.example.com/x.apk", hosts))
    }
}

class ArtifactDigestTest {

    @Test
    fun `computes the lowercase hex sha256 of known bytes`() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ArtifactDigest.sha256Hex("abc".toByteArray()),
        )
    }
}

class UpdateVerifierTest {

    @Test
    fun `accepts a fully matching artifact`() {
        assertEquals(
            UpdateVerificationResult.Ok,
            UpdateVerifier.verify(expected(), observed(), installedVersionCode = 10300),
        )
    }

    @Test
    fun `blocks a download url outside the allowlist`() {
        val code = blocked(
            UpdateVerifier.verify(expected(), observed(downloadUrl = "https://evil.example.com/x.apk")),
        )
        assertEquals(UpdateErrorCode.UPDATE_METADATA_INVALID, code)
    }

    @Test
    fun `blocks a truncated download by size`() {
        val code = blocked(UpdateVerifier.verify(expected(), observed(sizeBytes = 1234)))
        assertEquals(UpdateErrorCode.UPDATE_DOWNLOAD_FAILED, code)
    }

    @Test
    fun `blocks a checksum mismatch`() {
        val code = blocked(UpdateVerifier.verify(expected(), observed(sha256 = "a".repeat(64))))
        assertEquals(UpdateErrorCode.UPDATE_CHECKSUM_MISMATCH, code)
    }

    @Test
    fun `blocks when an expected checksum cannot be computed (fail closed)`() {
        val code = blocked(UpdateVerifier.verify(expected(), observed(sha256 = null)))
        assertEquals(UpdateErrorCode.UPDATE_CHECKSUM_MISMATCH, code)
    }

    @Test
    fun `blocks an apk for another package`() {
        val code = blocked(UpdateVerifier.verify(expected(), observed(archivePackageName = "com.evil.app")))
        assertEquals(UpdateErrorCode.UPDATE_PACKAGE_MISMATCH, code)
    }

    @Test
    fun `blocks an unreadable archive (fail closed)`() {
        val code = blocked(UpdateVerifier.verify(expected(), observed(archivePackageName = null)))
        assertEquals(UpdateErrorCode.UPDATE_PACKAGE_MISMATCH, code)
    }

    @Test
    fun `blocks a versionCode that is not the published build`() {
        val code = blocked(UpdateVerifier.verify(expected(), observed(archiveVersionCode = 10403)))
        assertEquals(UpdateErrorCode.UPDATE_PACKAGE_MISMATCH, code)
    }

    @Test
    fun `blocks a downgrade below the installed version`() {
        val code = blocked(
            UpdateVerifier.verify(expected(versionCode = 10402), observed(archiveVersionCode = 10402), installedVersionCode = 10500),
        )
        assertEquals(UpdateErrorCode.UPDATE_DOWNGRADE_BLOCKED, code)
    }

    @Test
    fun `blocks a signature mismatch`() {
        val code = blocked(UpdateVerifier.verify(expected(), observed(signatureMatches = false)))
        assertEquals(UpdateErrorCode.UPDATE_SIGNATURE_MISMATCH, code)
    }

    @Test
    fun `blocks when the signature could not be compared (fail closed)`() {
        val code = blocked(UpdateVerifier.verify(expected(), observed(signatureMatches = null)))
        assertEquals(UpdateErrorCode.UPDATE_SIGNATURE_MISMATCH, code)
    }

    @Test
    fun `blocks a release whose metadata carries no checksum (fail closed)`() {
        // This asserted `Ok` before: a missing `expected.sha256` skipped the digest check
        // entirely, so the GitHub-releases fallback — which never set one — installed an APK
        // verified only by package, versionCode and signature. Those prove *who* signed the
        // bytes, not *which* bytes were signed against the published release. The server
        // withholds such a release for the same reason, so the client must not accept it.
        val code = blocked(
            UpdateVerifier.verify(
                expected(sha256 = null, sizeBytes = null),
                observed(sha256 = null, sizeBytes = 999L),
                installedVersionCode = 10000,
            ),
        )
        assertEquals(UpdateErrorCode.UPDATE_CHECKSUM_REQUIRED, code)
    }

    @Test
    fun `an unusable checksum is rejected before the identity checks are reached`() {
        // The refusal must not depend on the rest of the artifact being wrong.
        val code = blocked(
            UpdateVerifier.verify(
                expected(sha256 = null, sizeBytes = null),
                observed(
                    sha256 = null,
                    archivePackageName = "com.example.other",
                    signatureMatches = false,
                ),
            ),
        )
        assertEquals(UpdateErrorCode.UPDATE_CHECKSUM_REQUIRED, code)
    }

    @Test
    fun `a published checksum still verifies package, versionCode and signature`() {
        assertEquals(
            UpdateVerificationResult.Ok,
            UpdateVerifier.verify(
                expected(),
                observed(),
                installedVersionCode = 10000,
            ),
        )

        val code = blocked(
            UpdateVerifier.verify(expected(), observed(signatureMatches = false)),
        )
        assertEquals(UpdateErrorCode.UPDATE_SIGNATURE_MISMATCH, code)
    }
}

class UpdateErrorCodeTest {

    @Test
    fun `every code carries a non-empty arabic message and a retry decision`() {
        for (code in UpdateErrorCode.entries) {
            assertTrue("$code has no user message", code.userMessage.isNotBlank())
            // Messages are user-facing only: no technical detail, no stack traces.
            assertFalse("$code leaks a URL", code.userMessage.contains("http"))
            assertFalse("$code leaks an exception", code.userMessage.contains("Exception"))
        }
    }

    @Test
    fun `terminal failures are not advertised as retryable`() {
        assertFalse(UpdateErrorCode.UPDATE_SIGNATURE_MISMATCH.retryable)
        assertFalse(UpdateErrorCode.UPDATE_PACKAGE_MISMATCH.retryable)
        assertFalse(UpdateErrorCode.UPDATE_DOWNGRADE_BLOCKED.retryable)
        assertTrue(UpdateErrorCode.UPDATE_CHECKSUM_MISMATCH.retryable)
        assertTrue(UpdateErrorCode.UPDATE_CHECK_NETWORK.retryable)
    }
}
