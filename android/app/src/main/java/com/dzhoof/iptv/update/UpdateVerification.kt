package com.dzhoof.iptv.update

import java.net.URI
import java.security.MessageDigest

/**
 * Host allowlist and scheme rules for APK downloads.
 *
 * Mirrors the server-side allowlist (`APP_UPDATE_ALLOWED_HOSTS` + GitHub hosts) so a
 * poisoned API response or release asset can never point a device at an untrusted host.
 */
object ApkUrlPolicy {

    /** GitHub release delivery plus the operator's own API host (added at call sites). */
    val DEFAULT_ALLOWED_HOSTS: Set<String> = setOf(
        "github.com",
        "objects.githubusercontent.com",
        "github-releases.githubusercontent.com",
    )

    /**
     * Requires HTTPS, rejects credentials embedded in the URL, rejects IP literals
     * (so loopback/private ranges and DNS-rebinding hosts are unreachable) and requires
     * the host to equal an allowlisted host or be a subdomain of one.
     */
    fun isAllowed(rawUrl: String, allowedHosts: Set<String> = DEFAULT_ALLOWED_HOSTS): Boolean {
        if (rawUrl.isBlank()) return false
        val uri = try {
            URI(rawUrl.trim())
        } catch (_: Exception) {
            return false
        }
        if (!"https".equals(uri.scheme, ignoreCase = true)) return false
        if (!uri.userInfo.isNullOrBlank()) return false
        val host = uri.host?.lowercase()?.trimEnd('.') ?: return false
        if (host.isEmpty()) return false
        if (isIpLiteral(host)) return false
        if (host == "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false
        return allowedHosts.any { allowed ->
            val normalised = allowed.lowercase().trimEnd('.')
            normalised.isNotEmpty() && (host == normalised || host.endsWith(".$normalised"))
        }
    }

    /** Allows the API host the build points at, in addition to GitHub's release hosts. */
    fun allowedHosts(apiBaseUrl: String?): Set<String> {
        val hosts = DEFAULT_ALLOWED_HOSTS.toMutableSet()
        val host = try {
            apiBaseUrl?.let { URI(it.trim()).host?.lowercase() }
        } catch (_: Exception) {
            null
        }
        if (!host.isNullOrBlank()) hosts.add(host)
        return hosts
    }

    private fun isIpLiteral(host: String): Boolean {
        if (host.startsWith("[") || host.contains(':')) return true // IPv6 literal
        val parts = host.split('.')
        if (parts.size != 4) return false
        return parts.all { part ->
            part.isNotEmpty() && part.all(Char::isDigit) && part.toIntOrNull()?.let { it in 0..255 } == true
        }
    }
}

/** Digest helpers shared by verification and tests. */
object ArtifactDigest {
    /** Lowercase hex SHA-256 of [bytes]. */
    fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString(separator = "") { byte -> "%02x".format(byte) }
}

/** What the server told us the release should be. */
data class ExpectedArtifact(
    val packageName: String,
    val versionCode: Int? = null,
    val sha256: String? = null,
    val sizeBytes: Long? = null,
)

/** What we actually observed on the downloaded file. */
data class ObservedArtifact(
    val downloadUrl: String,
    val sizeBytes: Long,
    val sha256: String? = null,
    val archivePackageName: String? = null,
    val archiveVersionCode: Int? = null,
    val signatureMatches: Boolean? = null,
)

sealed interface UpdateVerificationResult {
    data object Ok : UpdateVerificationResult

    /** [detail] is for logs only and must stay non-sensitive. */
    data class Blocked(val code: UpdateErrorCode, val detail: String) : UpdateVerificationResult
}

/**
 * Pre-install verification for a downloaded APK (operations brief §6).
 *
 * Fails closed: anything we cannot confirm — an unreadable archive, an unverifiable
 * checksum, a missing signature comparison — blocks the install rather than proceeding.
 * Pure logic, so it is unit-tested without an Android device.
 */
object UpdateVerifier {

    fun verify(
        expected: ExpectedArtifact,
        observed: ObservedArtifact,
        installedVersionCode: Int? = null,
        allowedHosts: Set<String> = ApkUrlPolicy.DEFAULT_ALLOWED_HOSTS,
    ): UpdateVerificationResult {
        if (!ApkUrlPolicy.isAllowed(observed.downloadUrl, allowedHosts)) {
            return blocked(UpdateErrorCode.UPDATE_METADATA_INVALID, "download url rejected by allowlist/HTTPS policy")
        }

        expected.sizeBytes?.let { expectedSize ->
            if (observed.sizeBytes != expectedSize) {
                return blocked(
                    UpdateErrorCode.UPDATE_DOWNLOAD_FAILED,
                    "size mismatch: expected $expectedSize bytes, got ${observed.sizeBytes}",
                )
            }
        }

        if (expected.sha256 != null) {
            val actual = observed.sha256
                ?: return blocked(UpdateErrorCode.UPDATE_CHECKSUM_MISMATCH, "checksum could not be computed")
            if (!actual.equals(expected.sha256, ignoreCase = true)) {
                return blocked(UpdateErrorCode.UPDATE_CHECKSUM_MISMATCH, "checksum mismatch")
            }
        }

        val archivePackage = observed.archivePackageName
            ?: return blocked(UpdateErrorCode.UPDATE_PACKAGE_MISMATCH, "archive metadata unreadable")
        if (archivePackage != expected.packageName) {
            return blocked(
                UpdateErrorCode.UPDATE_PACKAGE_MISMATCH,
                "package mismatch: archive is $archivePackage",
            )
        }

        val archiveVersionCode = observed.archiveVersionCode
            ?: return blocked(UpdateErrorCode.UPDATE_PACKAGE_MISMATCH, "archive versionCode unreadable")
        expected.versionCode?.let { expectedVersionCode ->
            if (archiveVersionCode != expectedVersionCode) {
                return blocked(
                    UpdateErrorCode.UPDATE_PACKAGE_MISMATCH,
                    "versionCode mismatch: archive is $archiveVersionCode, expected $expectedVersionCode",
                )
            }
        }

        installedVersionCode?.let { installed ->
            if (archiveVersionCode < installed) {
                return blocked(
                    UpdateErrorCode.UPDATE_DOWNGRADE_BLOCKED,
                    "downgrade blocked: archive $archiveVersionCode < installed $installed",
                )
            }
        }

        if (observed.signatureMatches != true) {
            return blocked(UpdateErrorCode.UPDATE_SIGNATURE_MISMATCH, "signature verification failed")
        }

        return UpdateVerificationResult.Ok
    }

    private fun blocked(code: UpdateErrorCode, detail: String): UpdateVerificationResult.Blocked =
        UpdateVerificationResult.Blocked(code, detail)
}
