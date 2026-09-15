package com.dzhoof.iptv.update

import com.dzhoof.iptv.presentation.model.UpdateInfo
import org.json.JSONObject

/**
 * Parses the update API's checksum-check response into a decision the caller can act on.
 *
 * Extracted from [AppUpdater] as a pure function so the contract can be unit-tested on the
 * JVM: the previous inline parsing dropped every field it did not name, and the fields it
 * dropped were exactly the ones that say whether the offered bytes could be verified.
 * `checksumSource` and `updateBlockedReason` were never read, so a release the server had
 * deliberately withheld was reported to the user as "you are up to date".
 *
 * The API contract is documented in `server/docs/API_DOCUMENTATION.md` (§ App Version
 * Management). This parser fails closed: a release offered without a usable 64-hex
 * `sha256` is refused rather than offered for download.
 */
internal object UpdateResponseParser {

    /** What the client should do with one response. */
    sealed interface Outcome {
        /** A verifiable release is offered. */
        data class Offered(val update: UpdateInfo) : Outcome

        /** Nothing newer is published for this device. */
        data object Current : Outcome

        /**
         * A newer release exists but the server withheld it because its checksum could not
         * be verified (`updateBlockedReason: CHECKSUM_UNAVAILABLE`). Not an error from the
         * user's point of view — the client must not claim "up to date" either, which is
         * what it used to do.
         */
        data class HeldForVerification(val versionName: String?) : Outcome

        /** The response was unusable, so no decision can be made. */
        data class Invalid(val code: UpdateErrorCode) : Outcome
    }

    /** Value of `updateBlockedReason` when the server refuses an unverifiable release. */
    const val REASON_CHECKSUM_UNAVAILABLE = "CHECKSUM_UNAVAILABLE"

    fun parse(body: String?): Outcome {
        val json = try {
            JSONObject(body ?: "{}")
        } catch (_: Exception) {
            return Outcome.Invalid(UpdateErrorCode.UPDATE_METADATA_INVALID)
        }

        if (!json.optBoolean("success", false)) {
            return Outcome.Invalid(UpdateErrorCode.UPDATE_METADATA_INVALID)
        }

        val latest = json.optJSONObject("latestVersion")
        val versionName = latest?.optString("versionName")?.takeIf { it.isNotBlank() && it != "null" }

        if (!json.optBoolean("updateAvailable", false)) {
            val blockedReason = json.optString("updateBlockedReason").takeIf { it.isNotBlank() }
            return if (blockedReason == REASON_CHECKSUM_UNAVAILABLE) {
                Outcome.HeldForVerification(versionName)
            } else {
                Outcome.Current
            }
        }

        val target = latest ?: return Outcome.Invalid(UpdateErrorCode.UPDATE_METADATA_INVALID)

        // Fail closed: the server withholds an unverifiable release, and so does the client.
        // A null digest here means the operator deliberately disabled the server-side gate
        // (the documented emergency switch) — the device must still refuse, because it
        // cannot tie the bytes it downloads to the reviewed artifact.
        val sha256 = target.optString("sha256").takeIf { isSha256(it) }
            ?: return Outcome.Invalid(UpdateErrorCode.UPDATE_CHECKSUM_REQUIRED)

        val downloadUrl = target.optString("downloadUrl").takeIf { it.isNotBlank() && it != "null" }
            ?: return Outcome.Invalid(UpdateErrorCode.UPDATE_METADATA_INVALID)

        val update = UpdateInfo(
            versionName = versionName ?: "",
            releaseNotes = target.optString("releaseNotes").takeIf { it.isNotBlank() && it != "null" } ?: "",
            fileSize = formatFileSize(target.optLong("apkFileSize", 0)),
            downloadUrl = downloadUrl,
            isMandatory = json.optBoolean("mandatory", json.optBoolean("isMandatory", false)),
            versionCode = target.optInt("versionCode", 0).takeIf { it > 0 },
            sha256 = sha256,
            // `sizeBytes` is the contract field; `apkFileSize` is the legacy alias kept for
            // clients shipped before the contract change, and the two carry the same value.
            sizeBytes = target.optLong("sizeBytes", 0)
                .takeIf { it > 0 }
                ?: target.optLong("apkFileSize", 0).takeIf { it > 0 },
            minimumSupportedVersionCode = target.optInt("minimumSupportedVersionCode", 0).takeIf { it > 0 },
            checksumSource = target.optString("checksumSource").takeIf { it.isNotBlank() && it != "null" },
        )
        return Outcome.Offered(update)
    }

    /** 64 hex characters — anything else cannot be compared against a computed digest. */
    fun isSha256(value: String?): Boolean =
        value != null && value.length == 64 &&
            value.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }

    /** Human-readable size, kept identical to the previous inline implementation. */
    fun formatFileSize(bytes: Long): String {
        if (bytes <= 0) return ""
        val unit = 1024
        if (bytes < unit) return "$bytes B"
        val exp = (Math.log(bytes.toDouble()) / Math.log(unit.toDouble())).toInt()
        val pre = "KMGTPE"[exp - 1]
        return String.format("%.1f %sB", bytes / Math.pow(unit.toDouble(), exp.toDouble()), pre)
    }
}
