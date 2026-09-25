package com.dzhoof.iptv.data

import android.content.Context
import com.dzhoof.iptv.BuildConfig
import com.dzhoof.iptv.security.SecurePreferences

/**
 * Centralized access to the app's SharedPreferences (DzhoofSettings).
 */
object AppPreferences {

    const val PREFS_NAME = "DzhoofSettings"
    private const val SERVER_URL_KEY = "server_url"
    private const val TV_CODE_KEY = "tv_code"
    private const val SESSION_ID_KEY = "session_id"
    private const val DEMO_MODE_KEY = "is_demo_mode"
    private const val EPG_XMLTV_URL_KEY = "epg_xmltv_url"
    private const val PLAYLIST_EPG_URL_KEY = "playlist_epg_url"
    private const val PLAYLIST_SOURCE_TYPE_KEY = "playlist_source_type"
    private const val M3U_URL_KEY = "m3u_url"
    private const val XTREAM_HOST_KEY = "xtream_host"
    private const val XTREAM_USER_KEY = "xtream_user"
    private const val XTREAM_PASS_KEY = "xtream_pass"
    private const val PARENTAL_PIN_HASH_KEY = "parental_pin_hash"

private const val PARENTAL_PIN_FAILED_ATTEMPTS_KEY = "parental_pin_failed_attempts"
private const val PARENTAL_PIN_LOCK_UNTIL_KEY = "parental_pin_lock_until"
private const val PARENTAL_PIN_MAX_ATTEMPTS = 5
private const val PARENTAL_PIN_LOCK_MS = 30_000L
    private const val PARENTAL_LOCK_ENABLED_KEY = "parental_lock_enabled"
    private const val UPDATE_LAST_CHECK_AT_KEY = "update_last_check_at"
    private const val UPDATE_LAST_RESULT_KEY = "update_last_result"
    val DEFAULT_SERVER_URL: String
        get() = BuildConfig.API_BASE_URL.trimEnd('/')

    /** Playlist source types. PAIRED = managed server (default); M3U/XTREAM = bring-your-own. */
    const val SOURCE_PAIRED = "paired"
    const val SOURCE_M3U = "m3u"
    const val SOURCE_XTREAM = "xtream"

    /**
     * Parental unlock is session-scoped: a successful PIN entry unlocks playback
     * for the rest of the process and resets on the next app launch.
     */
    @Volatile
    private var parentalUnlockedThisSession = false

    /**
     * Cached encrypted-preferences handle.
     *
     * Constructing `SecurePreferences` builds a MasterKey and opens
     * EncryptedSharedPreferences — real Keystore IPC. `getTvCode()` is called from
     * the OkHttp interceptor on every managed request (and from main-thread call
     * sites), so the old "construct one per call" pattern paid that cost per
     * request. The handle is stable for the process lifetime, so it is cached.
     *
     * Returns null when the device keystore is unusable (SecurePreferences throws
     * SecurityException in that case). Callers must degrade, never crash: that
     * exception used to escape straight out of a UI-thread save.
     */
    @Volatile
    private var securePreferences: SecurePreferences? = null
    @Volatile
    private var securePreferencesFailed = false

    private fun secure(context: Context): SecurePreferences? {
        securePreferences?.let { return it }
        if (securePreferencesFailed) return null
        return try {
            SecurePreferences(context).also { securePreferences = it }
        } catch (e: Exception) {
            securePreferencesFailed = true
            android.util.Log.e(
                "AppPreferences",
                "Encrypted storage unavailable (${e.message}); sensitive values will not be persisted",
                e
            )
            null
        }
    }

    fun getServerUrl(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(SERVER_URL_KEY, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
    }

    private const val LAST_LIVE_CHANNEL_KEY = "last_live_channel_id"

    /**
     * Last successfully-loaded live channel — the TV-first resume point.
     * Written by the player on every successful channel load; read once at
     * app start on TV devices to jump straight back into playback.
     */
    fun getLastLiveChannelId(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(LAST_LIVE_CHANNEL_KEY, null)?.takeIf { it.isNotBlank() }
    }

    fun setLastLiveChannelId(context: Context, channelId: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(LAST_LIVE_CHANNEL_KEY, channelId).apply()
    }

    fun getTvCode(context: Context): String {
        val secure = runCatching {
            secure(context)?.getString(TV_CODE_KEY, "") ?: ""
        }.getOrDefault("")
        if (secure.isNotEmpty()) return secure
        // Upgrade path: codes written by older builds live in plain SharedPreferences.
        // Read once, move to encrypted storage, then drop the plaintext copy.
        val legacy = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(TV_CODE_KEY, "") ?: ""
        if (legacy.isNotEmpty()) {
            runCatching { secure(context)?.putString(TV_CODE_KEY, legacy) }
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().remove(TV_CODE_KEY).apply()
        }
        return legacy
    }

    fun getSessionId(context: Context): String {
        return try {
            secure(context)?.getString(SESSION_ID_KEY, "") ?: ""
        } catch (_: Exception) {
            ""
        }
    }

    /**
     * True when the app holds a credential the server accepts for managed
     * (server-authorized) playback.
     *
     * The server's `requireTvOrSessionAuth` accepts EITHER a paired TV code OR a
     * signed-in account session, and [com.dzhoof.iptv.di.NetworkModule] sends both
     * headers on every managed request. Gating tokenized playback on the TV code
     * alone therefore sent every account-only user down the raw-URL path — where
     * the server intentionally returns an empty `channelUrl` — so the channel list
     * was visible but nothing would play.
     */
    fun hasManagedPlaybackCredential(context: Context): Boolean =
        hasManagedPlaybackCredential(getTvCode(context), getSessionId(context))

    /**
     * Pure form of [hasManagedPlaybackCredential] so the policy can be unit-tested
     * without Android. Keep the two in sync.
     */
    internal fun hasManagedPlaybackCredential(tvCode: String, sessionId: String): Boolean =
        tvCode.isNotEmpty() || sessionId.isNotEmpty()

    /** @return true when the session id was persisted. */
    fun setSessionId(context: Context, sessionId: String): Boolean {
        val securePrefs = secure(context) ?: return false
        return runCatching {
            securePrefs.putString(SESSION_ID_KEY, sessionId.trim())
            true
        }.getOrElse {
            android.util.Log.w("AppPreferences", "Could not persist the session id", it)
            false
        }
    }

    fun clearSessionId(context: Context) {
        runCatching { secure(context)?.remove(SESSION_ID_KEY) }
    }

    fun hasChannelSelection(context: Context): Boolean {
        return getTvCode(context).isNotEmpty()
    }

    fun isDemoMode(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(DEMO_MODE_KEY, false)
    }

    fun setServerUrl(context: Context, url: String) {
        val sanitized = url.trim()
        require(sanitized.startsWith("https://")) { "Server URL must use HTTPS" }
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(SERVER_URL_KEY, sanitized).apply()
    }

    fun setTvCode(context: Context, code: String) {
        val sanitized = code.trim().replace(Regex("[^A-Za-z0-9]"), "")
        // tv_code is a bearer credential for the managed API (X-TV-Code) — store it
        // encrypted like the session id (security audit).
        runCatching { secure(context)?.putString(TV_CODE_KEY, sanitized) }
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        // Pairing is a server-backed source — clear any prior BYO playlist selection
        // so refreshChannels() hits the server instead of a stale M3U/Xtream source.
        // Also clear the demo flag: a manually-set code is a real pairing, not demo,
        // so isPaired resolves true instead of the source reading as "Demo".
        prefs.edit()
            .remove(TV_CODE_KEY)
            .putString(PLAYLIST_SOURCE_TYPE_KEY, SOURCE_PAIRED)
            .remove(DEMO_MODE_KEY)
            .apply()
    }

    fun setDemoMode(context: Context, code: String) {
        val sanitized = code.trim().replace(Regex("[^A-Za-z0-9]"), "")
        runCatching { secure(context)?.putString(TV_CODE_KEY, sanitized) }
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .remove(TV_CODE_KEY)
            .putBoolean(DEMO_MODE_KEY, true)
            .putString(PLAYLIST_SOURCE_TYPE_KEY, SOURCE_PAIRED)
            .apply()
    }

    /**
     * Optional user-supplied XMLTV EPG URL. When set, the app fetches and parses this
     * guide directly (TiviMate/Kodi style) as an additional source, so EPG no longer
     * depends solely on the server. Empty string means "not configured".
     */
    fun getEpgXmltvUrl(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(EPG_XMLTV_URL_KEY, "") ?: ""
    }

    fun setEpgXmltvUrl(context: Context, url: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(EPG_XMLTV_URL_KEY, url.trim()).apply()
    }

    /**
     * EPG URL derived from an imported playlist's `url-tvg`. Kept separate from the user's
     * manual [getEpgXmltvUrl] so a playlist refresh never clobbers a manual setting, and a
     * new playlist with no guide doesn't inherit the previous source's URL.
     */
    fun getPlaylistEpgUrl(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(PLAYLIST_EPG_URL_KEY, "") ?: ""
    }

    fun setPlaylistEpgUrl(context: Context, url: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(PLAYLIST_EPG_URL_KEY, url.trim()).apply()
    }

    /** Effective guide URL: the user's manual override wins, else the playlist-derived one. */
    fun getEffectiveEpgUrl(context: Context): String {
        val manual = getEpgXmltvUrl(context)
        return if (manual.isNotBlank()) manual else getPlaylistEpgUrl(context)
    }

    // ── Bring-your-own playlist source ──────────────────────────────────────

    /** Current playlist source type: [SOURCE_PAIRED] (default), [SOURCE_M3U], or [SOURCE_XTREAM]. */
    fun getPlaylistSourceType(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(PLAYLIST_SOURCE_TYPE_KEY, SOURCE_PAIRED) ?: SOURCE_PAIRED
    }

    fun setM3uSource(context: Context, url: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(PLAYLIST_SOURCE_TYPE_KEY, SOURCE_M3U)
            .putString(M3U_URL_KEY, url.trim())
            .apply()
    }

    fun getM3uUrl(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(M3U_URL_KEY, "") ?: ""
    }

    /**
     * Store an Xtream source. The credentials go to EncryptedSharedPreferences and
     * are never written to plain prefs.
     *
     * @return false when the device keystore is unusable, in which case nothing is
     *   switched: the previous source stays active instead of leaving the app
     *   pointing at a source whose password was never stored. The old
     *   implementation let the constructor's SecurityException escape into the
     *   caller's UI-thread coroutine and crash the app.
     */
    fun setXtreamSource(
        context: Context,
        host: String,
        username: String,
        password: String
    ): Boolean {
        // Credentials first: if encrypted storage is unavailable we must not
        // switch the active source.
        val securePrefs = secure(context) ?: return false
        val stored = runCatching {
            securePrefs.putString(XTREAM_USER_KEY, username.trim())
            securePrefs.putString(XTREAM_PASS_KEY, password.trim())
            true
        }.getOrElse {
            android.util.Log.w("AppPreferences", "Could not store Xtream credentials", it)
            false
        }
        if (!stored) return false

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(PLAYLIST_SOURCE_TYPE_KEY, SOURCE_XTREAM)
            .putString(XTREAM_HOST_KEY, host.trim().trimEnd('/'))
            .remove(XTREAM_USER_KEY) // migrate any legacy plaintext creds out of plain prefs
            .remove(XTREAM_PASS_KEY)
            .apply()
        return true
    }

    fun getXtreamHost(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(XTREAM_HOST_KEY, "") ?: ""
    }

    fun getXtreamUser(context: Context): String = readSecure(context, XTREAM_USER_KEY)

    fun getXtreamPass(context: Context): String = readSecure(context, XTREAM_PASS_KEY)

    private fun readSecure(context: Context, key: String): String =
        try {
            secure(context)?.getString(key, "") ?: ""
        } catch (_: Exception) {
            ""
        }

    /** Switch back to the managed (paired) source. */
    fun useManagedSource(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(PLAYLIST_SOURCE_TYPE_KEY, SOURCE_PAIRED).apply()
    }

    /** True when a usable channel source exists (paired code OR a BYO playlist). */
    // ─── App update check state (non-sensitive) ────────────────────────

    /** Epoch millis of the last completed update check, or 0 when never checked. */
    fun getUpdateLastCheckAt(context: Context): Long =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getLong(UPDATE_LAST_CHECK_AT_KEY, 0L)

    /** Non-sensitive outcome label of the last check (e.g. "available", "up_to_date"). */
    fun getUpdateLastResult(context: Context): String =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(UPDATE_LAST_RESULT_KEY, "") ?: ""

    fun setUpdateLastCheckState(context: Context, checkedAt: Long, resultCode: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putLong(UPDATE_LAST_CHECK_AT_KEY, checkedAt)
            .putString(UPDATE_LAST_RESULT_KEY, resultCode)
            .apply()
    }

    fun hasAnySource(context: Context): Boolean {
        return when (getPlaylistSourceType(context)) {
            SOURCE_M3U -> getM3uUrl(context).isNotBlank()
            SOURCE_XTREAM -> getXtreamHost(context).isNotBlank()
            else -> hasChannelSelection(context)
        }
    }

    fun clearPairing(context: Context) {
        runCatching { secure(context)?.remove(TV_CODE_KEY) }
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .remove(TV_CODE_KEY)
            .remove(DEMO_MODE_KEY)
            .apply()
        clearSessionId(context)
    }

    // ─── Parental controls ─────────────────────────────────────────────

    /** Store a new parental PIN (hashed). Returns false for invalid input. */
    fun setParentalPin(context: Context, pin: String): Boolean {
        if (!ParentalPinUtils.isValidPin(pin)) return false
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(PARENTAL_PIN_HASH_KEY, ParentalPinUtils.hashPin(pin))
            .apply()
        return true
    }

    fun clearParentalPin(context: Context) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(PARENTAL_PIN_HASH_KEY)
            .apply()
    }

    fun hasParentalPin(context: Context): Boolean =
        getParentalPinHash(context) != null

    private fun getParentalPinHash(context: Context): String? =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(PARENTAL_PIN_HASH_KEY, null)

    fun verifyParentalPin(context: Context, pin: String): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val lockUntil = prefs.getLong(PARENTAL_PIN_LOCK_UNTIL_KEY, 0L)
        if (lockUntil > now) return false

        val storedHash = getParentalPinHash(context)
        val valid = ParentalPinUtils.verifyPin(pin, storedHash)
        if (valid) {
            // Successful unlock clears the local failure counter.
            prefs.edit()
                .remove(PARENTAL_PIN_FAILED_ATTEMPTS_KEY)
                .remove(PARENTAL_PIN_LOCK_UNTIL_KEY)
                .apply()

            // Seamlessly upgrade hashes created by older releases after a successful
            // unlock, without ever persisting the raw PIN.
            if (storedHash != null && ParentalPinUtils.isLegacySha256(storedHash)) {
                setParentalPin(context, pin)
            }
            return true
        }

        val attempts = prefs.getInt(PARENTAL_PIN_FAILED_ATTEMPTS_KEY, 0) + 1
        val editor = prefs.edit().putInt(PARENTAL_PIN_FAILED_ATTEMPTS_KEY, attempts)
        if (attempts >= PARENTAL_PIN_MAX_ATTEMPTS) {
            editor.putLong(PARENTAL_PIN_LOCK_UNTIL_KEY, now + PARENTAL_PIN_LOCK_MS)
                .putInt(PARENTAL_PIN_FAILED_ATTEMPTS_KEY, 0)
        }
        editor.apply()
        return false
    }

    fun isParentalLockEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(PARENTAL_LOCK_ENABLED_KEY, false)

    fun setParentalLockEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(PARENTAL_LOCK_ENABLED_KEY, enabled)
            .apply()
    }

    /** True after a successful PIN entry in this app process. */
    fun isParentalUnlockedThisSession(): Boolean = parentalUnlockedThisSession

    fun setParentalUnlockedThisSession(unlocked: Boolean) {
        parentalUnlockedThisSession = unlocked
    }
}
