package com.dzhoof.iptv.data

import okhttp3.HttpUrl

/**
 * Builds a log-safe summary of a request URL.
 *
 * The debug HTTP logger used to run at
 * [okhttp3.logging.HttpLoggingInterceptor.Level.HEADERS], which prints the request
 * line — the **full URL** — and every header. Only `X-TV-Code` was redacted, so:
 *
 *  * `X-Session-Id`, a bearer credential, went to logcat verbatim;
 *  * an Xtream source carries its account in the URL
 *    (`https://panel/live/<user>/<pass>/123.ts`,
 *    `player_api.php?username=…&password=…`), and a bring-your-own playlist is by
 *    definition an arbitrary third-party host;
 *  * managed playback URLs carry the playback token **in the path**
 *    (`/api/v1/tv/playback/<token>`).
 *
 * That is exactly what `AGENTS.md` forbids: "Do not expose Xtream credentials in
 * Android logs, URLs shown to users, screenshots, or API responses".
 *
 * Keeping the endpoint while dropping the secrets is enough to debug a failed
 * refresh, so this prints `scheme://host/path` with any token-shaped path segment
 * masked, and never the query string (it is where `username`/`password`/`token`
 * live). Screens and diagnostics use the same rule.
 */
object RequestLogRedactor {

    /** Anything at least this long without separators is treated as a secret. */
    private const val TOKEN_MIN_LENGTH = 16

    private val TOKEN_SHAPE = Regex("^[A-Za-z0-9_\\-+=]{$TOKEN_MIN_LENGTH,}$")

    /** `…/playback/<token>.m3u8` keeps its extension so the media type is visible. */
    private val TOKEN_WITH_EXTENSION =
        Regex("^([A-Za-z0-9_\\-+=]{$TOKEN_MIN_LENGTH,})(\\.[A-Za-z0-9]{1,5})$")

    /**
     * @return a URL summary that is safe to write to a log, e.g.
     *   `https://api.example.com/api/v1/channels (query hidden: 2 params)`
     *   `https://panel.example.com/live/<masked>/<masked>/123.ts`
     *
     * The mask is `MASK` below. It is not spelled out in this comment on purpose:
     * the literal three asterisks followed by a slash would close the block
     * comment and the rest of it would be parsed as code (which is exactly how
     * this file first failed to compile).
     */
    fun summarize(url: HttpUrl): String = summarize(url.toString())

    fun summarize(rawUrl: String): String {
        // Parse leniently: a malformed URL must still produce a redacted line
        // rather than an exception inside the logging interceptor.
        val schemeEnd = rawUrl.indexOf("://")
        if (schemeEnd <= 0) return redactSegments(rawUrl.substringBefore('?'))

        val scheme = rawUrl.substring(0, schemeEnd)
        val rest = rawUrl.substring(schemeEnd + 3)
        val authority = rest.substringBefore('/').substringBefore('?')
        val pathAndQuery = rest.removePrefix(authority)

        val path = redactSegments(pathAndQuery.substringBefore('?'))
        val queryCount = countQueryParams(pathAndQuery)
        val suffix = if (queryCount > 0) " (query hidden: $queryCount params)" else ""
        return "$scheme://$authority$path$suffix"
    }

    /** Masks any path segment that looks like a credential or a signed token. */
    private fun redactSegments(path: String): String {
        if (path.isEmpty()) return ""
        val segments = path.split('/')
        return segments.joinToString("/") { segment ->
            when {
                segment.isEmpty() -> segment
                TOKEN_SHAPE.matches(segment) -> MASK
                else -> {
                    val withExtension = TOKEN_WITH_EXTENSION.matchEntire(segment)
                    if (withExtension != null) {
                        // Keep the extension (m3u8/ts/mp4) so a log still shows the
                        // media kind; the token that precedes it is a credential.
                        "${MASK}${withExtension.groupValues[2]}"
                    } else {
                        segment
                    }
                }
            }
        }
    }

    private fun countQueryParams(pathAndQuery: String): Int {
        val query = pathAndQuery.substringAfter('?', "")
        if (query.isEmpty()) return 0
        return query.split('&').count { it.isNotBlank() }
    }

    private const val MASK = "***"

    /** True when [segment] would be masked — used by tests and the diagnostics screen. */
    fun isSecretShaped(segment: String): Boolean =
        TOKEN_SHAPE.matches(segment) || TOKEN_WITH_EXTENSION.matches(segment)

    /**
     * A short, safe label for a request: the endpoint without its host, query or
     * token segments. Used for user-facing diagnostics too.
     */
    fun endpointLabel(url: HttpUrl): String {
        val path = redactSegments(url.encodedPath)
        return if (path.isEmpty()) "/" else path
    }
}
