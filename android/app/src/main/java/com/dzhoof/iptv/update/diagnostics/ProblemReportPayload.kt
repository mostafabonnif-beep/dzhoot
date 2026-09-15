package com.dzhoof.iptv.update.diagnostics

import com.dzhoof.iptv.BuildConfig
import org.json.JSONObject

/**
 * Builds the payload for `POST /api/v1/app/report-problem` — the "إبلاغ عن مشكلة" report.
 *
 * Two rules make this safe to send from a device that may be in any state:
 *
 * 1. **The feature list is closed.** The customer picks a category; the payload carries the
 *    key, never their phrasing. Free text is only ever the description, which both this
 *    class and the server redact.
 * 2. **The diagnostic snapshot is an allow-list.** It reuses the same [DiagnosticsFacts] the
 *    diagnostics screen already shows, so the app cannot leak something the user was never
 *    shown. No tokens, no JWTs, no playback/Xtream/EPG URLs, no usernames, no account codes
 *    and no raw base URL.
 *
 * Pure and dependency-free on purpose: the contract is unit-tested on the JVM without a
 * device, which is the only way a payload rule this important stays honest.
 */
internal object ProblemReportPayload {

    /** Categories offered in the UI. The wire value is the key, never the label. */
    enum class Category(val key: String, val label: String) {
        PLAYBACK("player", "تشغيل القنوات أو الأفلام"),
        UPDATE("update", "التحديث أو التثبيت"),
        PAIRING("pairing", "الاقتران أو تسجيل الدخول"),
        CATALOG("catalog", "القوائم والتصنيفات"),
        SUBSCRIPTION("subscription", "الاشتراك أو كود التفعيل"),
        OTHER("other", "مشكلة أخرى"),
    }

    /** Longest description accepted by the API; enforced here too so a long paste fails fast. */
    const val MESSAGE_MAX = 2000

    /**
     * Builds the request body.
     *
     * @param message the customer's own words (already the only free text in the payload).
     * @param category what they were doing; [Category.OTHER] is a valid answer.
     * @param facts the same non-sensitive snapshot the diagnostics screen renders.
     * @param deviceId stable, non-identifying device handle (`dz-…`), never a serial or an
     *   advertising id.
     * @param correlationId request id of the failure being reported, when the app has one.
     */
    fun build(
        message: String,
        category: Category,
        facts: DiagnosticsFacts?,
        deviceId: String?,
        platform: String = "android",
        correlationId: String? = null,
        errorCode: String? = null,
    ): JSONObject {
        val body = JSONObject()
        val trimmed = message.trim().take(MESSAGE_MAX)

        if (trimmed.isNotEmpty()) body.put("message", trimmed)
        body.put("feature", category.key)
        body.put("platform", platform)
        deviceId?.takeIf { it.isNotBlank() }?.let { body.put("deviceId", it) }
        errorCode?.takeIf { it.isNotBlank() }?.let { body.put("errorCode", it) }
        correlationId?.takeIf { it.isNotBlank() }?.let { body.put("correlationId", it) }

        facts?.let { safe ->
            safe.appVersionName?.let { body.put("appVersion", it) }
            safe.appVersionCode?.let { body.put("appVersionCode", it) }
            safe.androidRelease?.let { body.put("androidVersion", it) }
            safe.sdkInt?.let { body.put("sdkInt", it) }
            safe.lastCheckResultCode?.let { body.put("severity", severityFor(it)) }
        }

        diagnostics(facts)?.let { body.put("diagnostics", it) }
        return body
    }

    /**
     * The non-sensitive snapshot, built by naming each field.
     *
     * A `JSONObject` assembled field by field (rather than by copying a facts object) means a
     * field added to [DiagnosticsFacts] later cannot reach the network by accident — the
     * failure mode that turns a diagnostic into a leak.
     */
    fun diagnostics(facts: DiagnosticsFacts?): JSONObject? {
        if (facts == null) return null
        val out = JSONObject()
        facts.appVersionName?.let { out.put("appVersion", it) }
        facts.appVersionCode?.let { out.put("appVersionCode", it.toString()) }
        facts.releaseChannel?.let { out.put("releaseChannel", it) }
        facts.distributionWireName?.let { out.put("distribution", it) }
        facts.serverVersion?.let { out.put("serverVersion", it) }
        facts.serverCommit?.let { out.put("serverCommit", it) }
        facts.lastCheckResultCode?.let { out.put("lastCheckOutcome", it) }
        // Only booleans/numbers/known labels: `serverAvailable` is a boolean fact, never a
        // host name — the raw base URL is deliberately absent from a report.
        out.put("serverReachable", facts.serverAvailable)
        facts.sdkInt?.let { out.put("sdkInt", it) }
        return if (out.length() == 0) null else out
    }

    /**
     * Platform the update API understands. Derived from the device's own feature set rather
     * than from the build flavour, because the same APK ships to both form factors.
     */
    fun platformOf(context: android.content.Context): String {
        val uiMode = (context.getSystemService(android.content.Context.UI_MODE_SERVICE)
            as? android.app.UiModeManager)?.currentModeType
        val isTv = context.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_LEANBACK) ||
            uiMode == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
        return if (isTv) "android-tv" else "android"
    }

    private fun severityFor(lastCheckOutcome: String?): String = when {
        lastCheckOutcome == null -> "warning"
        lastCheckOutcome.startsWith("UPDATE_") || lastCheckOutcome.contains("failed", true) -> "error"
        else -> "warning"
    }

    /** Channel of the running build, for triage ("which flavour reported this?"). */
    fun releaseChannel(): String? = runCatching { BuildConfig.RELEASE_CHANNEL }.getOrNull()
}
