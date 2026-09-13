package com.dzhoof.iptv.update

import android.content.Context
import com.dzhoof.iptv.data.AppPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Remembers when the update pipeline last completed a check and what came of it, so the
 * cooldown survives process death and the diagnostics screen can show the last result.
 *
 * Only non-sensitive values are stored: an epoch millis and a short result label such as
 * `available` / `up_to_date` / an error code name. Never tokens or URLs.
 */
interface UpdateCheckStore {
    fun lastCheckAtMillis(): Long
    fun recordCheck(checkedAtMillis: Long, resultCode: String)
}

@Singleton
class AppPreferencesUpdateCheckStore @Inject constructor(
    @ApplicationContext private val context: Context,
) : UpdateCheckStore {

    override fun lastCheckAtMillis(): Long = AppPreferences.getUpdateLastCheckAt(context)

    override fun recordCheck(checkedAtMillis: Long, resultCode: String) =
        AppPreferences.setUpdateLastCheckState(context, checkedAtMillis, resultCode)
}
