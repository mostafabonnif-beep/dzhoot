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

    /**
     * Any scheme, not just `http(s)`: an IPTV failure routinely carries an `rtsp://` or
     * `rtmp://` URL with the account in the userinfo section, which the previous
     * `https?`-only rule left intact.
     */
    private val URL_CREDENTIALS =
        Regex("([a-z][a-z0-9+.-]{0,31}://)[^\\s/@:]{1,256}:[^\\s/@:]{1,256}@", RegexOption.IGNORE_CASE)
    private val XTREAM_PATH_ACCOUNT =
        Regex("(https?://[^\\s/]{1,256}/(?:live|movie|series|timeshift|vod)/)[^\\s/?#]{1,256}/[^\\s/?#]{1,256}/", RegexOption.IGNORE_CASE)
    private val SECRET_QUERY_PARAM =
        Regex(
            "([?&](?:username|user|password|pass|passwd|token|api[_-]?key|secret|auth|authorization|session|sessionid|session[_-]?id|cookie|cookies|sid)=)[^&\\s]{1,2000}",
            RegexOption.IGNORE_CASE,
        )
    /**
     * Header lines first: an `Authorization:` value is a scheme plus a credential
     * (`Basic dXNlcjpwYXNz`), and the assignment rule below only consumed the scheme
     * word, leaving the base64 credential in place. Consuming the whole value to the end
     * of the line is the only reliable form for a header.
     */
    private val SECRET_HEADER_LINE =
        Regex("((?:set-)?cookie|proxy-authorization|authorization)(\\s*:\\s*)[^\\r\\n]{1,4096}", RegexOption.IGNORE_CASE)
    /** An auth scheme inline without the header form: `upstream said: Basic dXNlcjpwYXNz`. */
    private val AUTH_SCHEME =
        Regex("((?:\\bbasic|\\bdigest|\\bnegotiate)\\s{1,8})[A-Za-z0-9._~+/=-]{6,512}", RegexOption.IGNORE_CASE)
    /**
     * The key may be quoted and/or JSON-encoded. `{"password":"hunter2"}` is exactly what
     * `JSONObject.toString()` puts into a throwable message, and the previous rule never
     * matched it because it required `[:=]` immediately after the bare key name — so a
     * JSON body passed through with the secret intact. Also covers `"token":"abc123"`.
     * The rule is case-insensitive: `Authorization: Basic …` used to survive on the key's
     * capital `A` alone.
     */
    private val SECRET_ASSIGNMENT =
        Regex(
            "((?:password|passwd|secret|token|api[_-]?key|authorization|auth|session|sessionid|session[_-]?id|cookie|cookies|pin|credentials?)[\\s\"']{0,8}[:=]\\s{0,8})([\"']?)[^\\s,\"'&}]{1,2000}",
            RegexOption.IGNORE_CASE,
        )
    private val BEARER_TOKEN = Regex("(Bearer\\s+)[A-Za-z0-9._~+/=-]+", RegexOption.IGNORE_CASE)
    private val JWT = Regex("\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{2,}\\b")
    /**
     * Raw IP addresses (the client's own or an upstream's) are not needed to reproduce a
     * crash and are personal/operational data. A dotted version string is a rare false
     * positive in throwable text ("1.2.3.4" does appear in version-tagged messages); the
     * operations brief forbids shipping a raw IP, so privacy wins over that edge case.
     *
     * IPv6 was previously uncovered here **and** on the server — the documented gap in
     * `docs/DIAGNOSTICS_AND_CRASH_REPORTS.md`. Three shapes are matched: the bracketed
     * form used in URLs, the full eight-group form, and a compressed address — the last
     * requiring a literal `::`, so a wall-clock time like `12:34:56` never matches.
     */
    private val IP_ADDRESS = Regex(
        "\\[[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,7}\\]" +
            "|\\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\\b" +
            "|\\b(?:[0-9a-fA-F]{1,4}:){1,7}:(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6})?\\b" +
            "|(?<![0-9a-fA-F:])::(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6})?\\b" +
            "|\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b",
    )

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
        text = SECRET_HEADER_LINE.replace(text, "$1$2[redacted]")
        text = AUTH_SCHEME.replace(text, "$1[redacted]")
        text = SECRET_QUERY_PARAM.replace(text, "$1[redacted]")
        text = SECRET_ASSIGNMENT.replace(text, "$1$2[redacted]")
        text = BEARER_TOKEN.replace(text, "$1[redacted]")
        text = JWT.replace(text, "[redacted-jwt]")
        text = IP_ADDRESS.replace(text, "[redacted-ip]")
        return text.take(maxChars).ifBlank { null }
    }

    /**
     * Line for logcat: the exception type only — never the message, which is exactly where
     * a credential would be. Debug-only visibility without leaking into device logs.
     */
    fun logSafeExceptionType(exceptionType: String?): String =
        exceptionType?.substringAfterLast('.')?.take(80)?.ifBlank { null } ?: "Throwable"
}
