package com.dzhoof.iptv.update.diagnostics

import com.dzhoof.iptv.update.UpdateDistribution
import com.dzhoof.iptv.update.UpdateErrorCode
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * The diagnostics screen's facts, gathered by [AppDiagnosticsProvider] and rendered by
 * [DiagnosticsReport].
 *
 * Every field is a plain value and the whole model is deliberately Android-free so the
 * builder can be unit-tested with plain JUnit. Fields are nullable on purpose: a fact that
 * cannot be read (or that fails the safety screen below) renders as "غير متاح" instead of
 * blocking the screen.
 *
 * SECURITY: this model must never carry a token, JWT, password, playlist/M3U/Xtream/EPG
 * URL, username, device serial or account code. If such a value ever reaches the builder
 * (e.g. a hostile server echoing a secret in `version`), [DiagnosticsReport] screens it out
 * before it can reach the screen or the clipboard.
 */
data class DiagnosticsFacts(
    /** e.g. "1.2.6" (staging builds carry a "-staging" suffix). */
    val appVersionName: String? = null,
    /** Derived versionCode, e.g. 10206. */
    val appVersionCode: Long? = null,
    /** Build channel from BuildConfig: "official" / "staging". */
    val releaseChannel: String? = null,
    /** [UpdateDistribution.wireName] — `play` / `external_apk` / `managed_device`. */
    val distributionWireName: String? = null,
    /** Epoch millis of the last completed update check; 0 = never checked. */
    val lastCheckAtMillis: Long = 0L,
    /** Stored, non-sensitive result label: `available` / `up_to_date` / an error code name. */
    val lastCheckResultCode: String? = null,
    /** `Build.VERSION.RELEASE`, e.g. "14". */
    val androidRelease: String? = null,
    /** `Build.VERSION.SDK_INT`, e.g. 34. */
    val sdkInt: Int? = null,
    /** Lowercase hex SHA-256 of the app's signing certificate, or null when unreadable. */
    val signingCertSha256: String? = null,
    /** Backend `GET /health/version` → `version`. */
    val serverVersion: String? = null,
    /** Backend `GET /health/version` → `commit` (first 8 chars). */
    val serverCommit: String? = null,
    /** Backend `GET /health/version` → `builtAt`. */
    val serverBuiltAt: String? = null,
    /** Backend `GET /health/version` → `environment` (e.g. "production"). */
    val serverEnvironment: String? = null,
    /** Whether the backend identity call succeeded at all. */
    val serverAvailable: Boolean = false,
)

/** One label/value row inside a section. */
data class DiagnosticsLine(val label: String, val value: String)

/** One titled block of rows. */
data class DiagnosticsSection(val title: String, val lines: List<DiagnosticsLine>)

/**
 * Pure renderer for [DiagnosticsFacts].
 *
 * Two outputs from the same screened data:
 *  - [sections] — structured rows for the Compose screen.
 *  - [reportText] — the plain-text report copied to the clipboard for support.
 *
 * Safety is enforced in one place: every free-text value passes [safeText] before it can be
 * rendered. Values that look like a URL, a JWT/bearer token, a credential, a playlist
 * reference or that don't match the strict shape allowed for that field are replaced with a
 * neutral placeholder. The report is therefore always safe to paste into a support chat.
 */
object DiagnosticsReport {

    const val NOT_AVAILABLE = "غير متاح"
    const val UNKNOWN = "غير معروف"
    private const val NEVER_CHECKED = "لا يوجد فحص مسجّل"

    const val SECTION_APP = "التطبيق"
    const val SECTION_LAST_CHECK = "آخر فحص تحديث"
    const val SECTION_SERVER = "الخادم"
    const val SECTION_DEVICE = "الجهاز"

    private val TIME_FORMAT: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")

    // Strict shapes. A value that does not match is not echoed — it becomes a placeholder.
    private val VERSION_PATTERN = Regex("[A-Za-z0-9][A-Za-z0-9._+-]{0,39}")
    private val CHANNEL_PATTERN = Regex("[A-Za-z0-9_-]{1,24}")
    private val ENVIRONMENT_PATTERN = Regex("[A-Za-z0-9._-]{1,32}")
    private val COMMIT_PATTERN = Regex("[0-9a-fA-F]{7,64}")
    private val BUILT_AT_PATTERN = Regex("[0-9T:.+\\-Zz]{1,40}")
    private val ANDROID_RELEASE_PATTERN = Regex("[A-Za-z0-9._]{1,16}")
    private val SHA256_PATTERN = Regex("[0-9a-f]{64}")

    // ── Public API ────────────────────────────────────────────────────────────

    fun sections(facts: DiagnosticsFacts): List<DiagnosticsSection> = listOf(
        appSection(facts),
        lastCheckSection(facts),
        serverSection(facts),
        deviceSection(facts),
    )

    fun reportText(facts: DiagnosticsFacts): String {
        val sb = StringBuilder()
        sb.append("تقرير تشخيص DZHOOF")
        sb.append('\n')
        sections(facts).forEach { section ->
            sb.append('\n')
            sb.append("=== ").append(section.title).append(" ===")
            sb.append('\n')
            section.lines.forEach { line ->
                sb.append("• ").append(line.label).append(": ").append(line.value).append('\n')
            }
        }
        return sb.toString().trimEnd()
    }

    // ── Sections ──────────────────────────────────────────────────────────────

    private fun appSection(facts: DiagnosticsFacts) = DiagnosticsSection(
        title = SECTION_APP,
        lines = listOf(
            DiagnosticsLine(
                "الإصدار",
                safeText(facts.appVersionName, VERSION_PATTERN) ?: NOT_AVAILABLE
            ),
            DiagnosticsLine(
                "رمز الإصدار",
                facts.appVersionCode?.toString() ?: NOT_AVAILABLE
            ),
            DiagnosticsLine(
                "قناة الإصدار",
                safeText(facts.releaseChannel, CHANNEL_PATTERN) ?: NOT_AVAILABLE
            ),
            DiagnosticsLine("مسار التحديث", distributionLabel(facts.distributionWireName)),
        )
    )

    private fun lastCheckSection(facts: DiagnosticsFacts) = DiagnosticsSection(
        title = SECTION_LAST_CHECK,
        lines = listOf(
            DiagnosticsLine("آخر فحص", formatCheckTime(facts.lastCheckAtMillis)),
            DiagnosticsLine("النتيجة", outcomeLabel(facts.lastCheckResultCode)),
        )
    )

    private fun serverSection(facts: DiagnosticsFacts) = DiagnosticsSection(
        title = SECTION_SERVER,
        lines = listOf(
            DiagnosticsLine("الاتصال", if (facts.serverAvailable) "متاح" else NOT_AVAILABLE),
            DiagnosticsLine(
                "إصدار الخادم",
                safeText(facts.serverVersion, VERSION_PATTERN) ?: NOT_AVAILABLE
            ),
            DiagnosticsLine(
                "آخر التزام",
                safeText(facts.serverCommit, COMMIT_PATTERN)?.take(8)?.lowercase() ?: NOT_AVAILABLE
            ),
            DiagnosticsLine(
                "تاريخ البناء",
                safeText(facts.serverBuiltAt, BUILT_AT_PATTERN) ?: NOT_AVAILABLE
            ),
            DiagnosticsLine(
                "البيئة",
                safeText(facts.serverEnvironment, ENVIRONMENT_PATTERN) ?: NOT_AVAILABLE
            ),
        )
    )

    private fun deviceSection(facts: DiagnosticsFacts) = DiagnosticsSection(
        title = SECTION_DEVICE,
        lines = listOf(
            DiagnosticsLine(
                "إصدار أندرويد",
                safeText(facts.androidRelease, ANDROID_RELEASE_PATTERN) ?: NOT_AVAILABLE
            ),
            DiagnosticsLine("مستوى API", facts.sdkInt?.toString() ?: NOT_AVAILABLE),
            DiagnosticsLine(
                "بصمة التوقيع (SHA-256)",
                safeText(facts.signingCertSha256, SHA256_PATTERN) ?: NOT_AVAILABLE
            ),
        )
    )

    // ── Mappings ──────────────────────────────────────────────────────────────

    /**
     * Human Arabic label for the distribution path, including what it means for updates.
     * Unknown/absent wire names fall back to "غير متاح" rather than echoing the raw value.
     */
    fun distributionLabel(wireName: String?): String {
        val distribution = UpdateDistribution.entries
            .firstOrNull { it.wireName == wireName?.trim() }
            ?: return NOT_AVAILABLE
        return when (distribution) {
            UpdateDistribution.PLAY ->
                "${distribution.wireName} — تُدار التحديثات عبر Google Play."
            UpdateDistribution.EXTERNAL_APK ->
                "${distribution.wireName} — تثبيت يدوي: يُنزَّل التحديث من الخادم ثم يُثبَّت بموافقتك."
            UpdateDistribution.MANAGED_DEVICE ->
                "${distribution.wireName} — جهاز مُدار: تُدار التحديثات عبر سياسة المؤسسة."
        }
    }

    /**
     * Human Arabic reason for the stored result label. Known update error codes map to their
     * user-facing message; anything unrecognised becomes "غير معروف" (never the raw value).
     */
    fun outcomeLabel(resultCode: String?): String = when (resultCode?.trim()) {
        null, "" -> NEVER_CHECKED
        "available" -> "يتوفر تحديث جديد"
        "up_to_date" -> "التطبيق محدَّث"
        "skipped" -> "تم تخطي الفحص (لم يحن موعده)"
        else -> UpdateErrorCode.entries
            .firstOrNull { it.name == resultCode.trim() }
            ?.userMessage
            ?: UNKNOWN
    }

    private fun formatCheckTime(millis: Long): String {
        if (millis <= 0L) return NEVER_CHECKED
        return runCatching {
            Instant.ofEpochMilli(millis)
                .atZone(ZoneId.systemDefault())
                .format(TIME_FORMAT)
        }.getOrNull() ?: NEVER_CHECKED
    }

    // ── Safety screen ─────────────────────────────────────────────────────────

    /**
     * Returns [value] only when it is non-blank, matches [pattern] and shows no sign of being
     * a URL, token, JWT or credential. Otherwise null, so the caller renders a placeholder.
     */
    private fun safeText(value: String?, pattern: Regex): String? {
        val trimmed = value?.trim().orEmpty()
        if (trimmed.isEmpty() || trimmed.length > 64) return null
        if (looksSensitive(trimmed)) return null
        return if (pattern.matches(trimmed)) trimmed else null
    }

    private fun looksSensitive(value: String): Boolean {
        val lower = value.lowercase()
        if (value.contains("://")) return true
        if (looksLikeJwt(value)) return true
        if ('@' in value) return true
        return listOf(
            "token", "bearer", "jwt", "password", "username", "user=", "pass=",
            "m3u", "m3u8", "xtream", "playlist", "epg", "deviceid", "device_id", "serial",
        ).any { lower.contains(it) }
    }

    /** Three dot-separated base64url segments, each long enough to be a JWT part. */
    private fun looksLikeJwt(value: String): Boolean {
        val parts = value.split('.')
        if (parts.size != 3) return false
        return parts.all { it.length >= 8 && it.matches(Regex("[A-Za-z0-9_-]+")) }
    }
}
