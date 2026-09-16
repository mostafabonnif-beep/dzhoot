package com.dzhoof.iptv.data

import java.util.UUID

/**
 * Correlation ids that tie one app request to the exact server log line (operations brief
 * §7C). Every managed API call carries `X-Request-ID`; the backend accepts a valid value,
 * uses it for its own `rid=` access-log entry and echoes it back in the response, so a
 * support conversation can start from the id the user sees in diagnostics instead of
 * guessing a time window.
 *
 * The id is a random UUID: it identifies a *request* and nothing else — no user, device,
 * account or session data can be derived from it, and it is not a credential. Only managed
 * DZ HOOF API calls get one; BYO playlist/EPG/stream hosts are not correlated.
 *
 * The last id is kept in memory only. It is deliberately not persisted: after a restart the
 * operator greps by request id from the report, and a stale id from a previous run would
 * point at the wrong request anyway.
 */
object RequestCorrelation {

    /** Header name, identical to the one the backend reads and echoes. */
    const val HEADER = "X-Request-ID"

    @Volatile
    private var lastClientId: String? = null

    @Volatile
    private var lastServerId: String? = null

    /** A fresh id for one request. */
    fun newRequestId(): String = UUID.randomUUID().toString()

    /**
     * Only requests to the DZ HOOF API are correlated: BYO playlist, EPG and stream hosts
     * belong to third parties and must not receive our headers. Host comparison is
     * case-insensitive (OkHttp lowercases hosts, configuration may not).
     */
    fun isManagedHost(requestHost: String?, apiHost: String?): Boolean {
        val expected = apiHost?.trim()?.lowercase().orEmpty()
        if (expected.isEmpty()) return false
        return requestHost?.trim()?.lowercase() == expected
    }

    /** Records the id sent with the most recent managed request. */
    fun recordClientId(id: String) {
        if (id.isNotBlank()) lastClientId = id
    }

    /** Records the id the server echoed back; absent/blank values are ignored. */
    fun recordServerId(id: String?) {
        if (!id.isNullOrBlank()) lastServerId = id
    }

    /**
     * The id to show a support agent: the server's echo when it sent one (that is the value
     * in the server log), otherwise the id we sent.
     */
    fun lastCorrelationId(): String? = lastServerId ?: lastClientId

    /** Test-only: clears the in-memory ids. */
    internal fun reset() {
        lastClientId = null
        lastServerId = null
    }
}
