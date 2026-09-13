package com.dzhoof.iptv.data.ads

/**
 * Frequency policy for free-tier interstitials.
 *
 * Pure logic (no Android types) so unit tests cover the rules that decide when
 * a viewer sees an ad: the operator sets a minimum gap between interstitials and
 * a per-session cap in the admin panel (`ads.interstitialEveryMinutes`,
 * `ads.frequencyCapPerSession`), and the client must respect both.
 *
 * `everyMinutes <= 0` means interstitials are disabled (the panel documents 0
 * as "off"), and a non-positive cap disables them too. When the time gate is
 * open but no interstitial has ever been shown this session, the first ad is
 * allowed immediately.
 */
class AdFrequencyPolicy(private val clock: () -> Long = { System.currentTimeMillis() }) {

    private var lastShownAtMs: Long = 0L
    private var shownThisSession: Int = 0

    /** True when an interstitial may be shown right now. */
    fun canShow(everyMinutes: Int, perSessionCap: Int): Boolean {
        if (everyMinutes <= 0) return false
        if (perSessionCap <= 0) return false
        if (shownThisSession >= perSessionCap) return false
        if (lastShownAtMs == 0L) return true
        val gapMs = everyMinutes.toLong() * 60_000L
        return clock() - lastShownAtMs >= gapMs
    }

    /** Call once an interstitial was actually displayed. */
    fun recordShown() {
        lastShownAtMs = clock()
        shownThisSession += 1
    }

    /** New app session: the per-session cap starts over. */
    fun resetSession() {
        lastShownAtMs = 0L
        shownThisSession = 0
    }

    fun shownCount(): Int = shownThisSession
}
