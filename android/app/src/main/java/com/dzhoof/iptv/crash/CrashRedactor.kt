package com.dzhoof.iptv.crash

/**
 * Removes credentials from crash-report text before it is queued to disk.
 *
 * The reporter uploads whatever a throwable carried, and a throwable message routinely
 * embeds the URL or token that caused the failure: an Xtream request URL, a playlist URL
 * with `?username=&password=`, or a playback token. Those must never leave the device
 * (operations brief §7), and the operator must never read them out of a stored report —
 * so the queue holds a redacted payload and `POST /api/v1/app/crash-report` redacts again
 * on ingest. Two independent layers, because a crashed app cannot be trusted to have
 * scrubbed its own payload and a client can always be older than the server.
 *
 * This is the Kotlin counterpart of `redactSensitiveText` in
 * `server/backend/src/services/audit-log.ts`; the rules are deliberately kept in step, and
 * the failure site (exception type, message, `file:line`) survives so the report stays
 * useful for reproducing the bug.
 */
object CrashRedactor {

    /** How many characters a redacted value may keep; long stack traces are truncated. */
    const val MAX_CHARS = 40_000

    private val URL_CREDENTIALS = Regex("(https?://)[^\\s/@:]+:[^\\s/@:]+@")
    private val XTREAM_PATH_ACCOUNT =
        Regex("(https?://[^\\s/]+/(?:live|movie|series|timeshift|vod)/)[^\\s/?#]+/[^\\s/?#]+/")
    private val SECRET_QUERY_PARAM =
        Regex("([?&](?:username|user|password|pass|token|api[_-]?key|secret|auth)=)[^&\\s]+")
    private val SECRET_ASSIGNMENT =
        Regex("((?:password|passwd|secret|token|api[_-]?key|authorization)\\s*[:=]\\s*)([\"']?)[^\\s,\"']+")
    private val BEARER_TOKEN = Regex("(Bearer\\s+)[A-Za-z0-9._~+/=-]+")
    private val JWT = Regex("\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{2,}\\b")
    /** A `Cookie:`/`Set-Cookie:` header line can carry a session token verbatim. */
    private val COOKIE_HEADER = Regex("((?:set-)?cookie\\s*:\\s*)[^\\r\\n]+", RegexOption.IGNORE_CASE)
    /**
     * Raw IPv4 addresses (the client's own or an upstream's) are not needed to reproduce a
     * crash and are personal/operational data. A dotted version string is a rare false
     * positive in throwable text ("1.2.3.4" does appear in version-tagged messages); the
     * operations brief forbids shipping a raw IP, so privacy wins over that edge case.
     * IPv6 is out of scope here and is covered by nothing else either — see the note in
     * docs/DIAGNOSTICS_AND_CRASH_REPORTS.md.
     */
    private val IPV4 = Regex("\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b")

    /**
     * Returns [value] with credentials replaced by placeholders, truncated to [maxChars],
     * or null when there is nothing left to store (blank input).
     */
    fun redact(value: String?, maxChars: Int = MAX_CHARS): String? {
        if (value == null) return null
        var text = value
        text = URL_CREDENTIALS.replace(text, "$1[redacted]@")
        // An Xtream account also travels as path segments (/live/<user>/<password>/1234.ts),
        // which the query-parameter rule never sees. Over-redacting a two-segment path under
        // a known stream prefix is acceptable: garbled diagnostics beat a leaked account.
        text = XTREAM_PATH_ACCOUNT.replace(text, "$1[redacted]/[redacted]/")
        text = SECRET_QUERY_PARAM.replace(text, "$1[redacted]")
        text = SECRET_ASSIGNMENT.replace(text, "$1$2[redacted]")
        text = BEARER_TOKEN.replace(text, "$1[redacted]")
        text = JWT.replace(text, "[redacted-jwt]")
        text = COOKIE_HEADER.replace(text, "$1[redacted]")
        text = IPV4.replace(text, "[redacted-ip]")
        return text.take(maxChars).ifBlank { null }
    }

    /**
     * Line for logcat: the exception type only — never the message, which is exactly where
     * a credential would be. Debug-only visibility without leaking into device logs.
     */
    fun logSafeExceptionType(exceptionType: String?): String =
        exceptionType?.substringAfterLast('.')?.take(80)?.ifBlank { null } ?: "Throwable"
}
