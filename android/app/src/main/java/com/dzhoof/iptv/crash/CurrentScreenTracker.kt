package com.dzhoof.iptv.crash

import com.dzhoof.iptv.data.RequestLogRedactor

/**
 * Remembers which screen the app is on, so a crash report says **where** it happened.
 *
 * `POST /api/v1/app/crash-report` has carried a `screen` field (max 100 chars)
 * since the endpoint was written, and the server stores it — but the app never
 * filled it, so every one of the seven reports in production arrived with
 * `screen: null`. Diagnosing them meant reading mangled obfuscated stack frames
 * and guessing the screen; with this, the next report names it outright.
 *
 * Only the **route pattern** is recorded (`player/{channelId}`), never the filled
 * arguments: a channel id, a category name or a playback code are user data and
 * must not end up in an operator-visible report. The value is also cut at the
 * query string, capped at the server's limit, and any token-shaped path segment
 * is masked with the same redactor the HTTP logger uses — defence in depth for a
 * future caller that passes a filled route by mistake.
 */
object CurrentScreenTracker {

    /** Matches the server-side `CrashReport.screen` maxlength. */
    const val MAX_LENGTH = 100

    private const val UNKNOWN = "unknown"

    @Volatile
    private var route: String? = null

    /** Called by the navigation graph on every destination change. */
    fun onDestinationChanged(route: String?) {
        this.route = sanitize(route)
    }

    /** The current screen pattern, or `null` when nothing has been recorded yet. */
    fun current(): String? = route

    /** Normalises a route for storage. Public so it can be verified directly. */
    fun sanitize(rawRoute: String?): String? {
        if (rawRoute.isNullOrBlank()) return null
        // Drop the query: `?catchupStart=…&catchupDur=…` carries no location value
        // and is where an argument would leak.
        val path = rawRoute.substringBefore('?').trim()
        if (path.isEmpty()) return null

        val masked = path
            .split('/')
            .joinToString("/") { segment ->
                if (segment.isNotEmpty() && RequestLogRedactor.isSecretShaped(segment)) "***" else segment
            }
            .trim('/')

        if (masked.isEmpty()) return UNKNOWN
        return if (masked.length <= MAX_LENGTH) masked else masked.take(MAX_LENGTH)
    }
}
