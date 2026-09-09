package com.dzhoof.iptv.data.repository

import android.content.Context
import android.content.SharedPreferences
import com.dzhoof.iptv.di.IoDispatcher
import com.dzhoof.iptv.domain.repository.ChannelTrackPreferencesRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * [ChannelTrackPreferencesRepository] backed by a dedicated SharedPreferences
 * file (`channel_track_preferences`) with plain per-channel keys.
 *
 * Implementation is deliberately thin: every getter reads the live
 * SharedPreferences value on collection, so a fresh read always reflects the
 * last write. Single-process app, so no cross-process listener is needed.
 */
@Singleton
class ChannelTrackPreferencesRepositoryImpl @Inject constructor(
    @ApplicationContext private val context: Context,
    @IoDispatcher private val ioDispatcher: CoroutineDispatcher
) : ChannelTrackPreferencesRepository {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override suspend fun getAudioLanguage(channelId: String): Flow<String?> =
        flowOf(prefs.getString(keyAudio(channelId), null))

    override suspend fun setAudioLanguage(channelId: String, language: String?) {
        withContext(ioDispatcher) {
            val editor = prefs.edit()
            if (language.isNullOrBlank()) {
                editor.remove(keyAudio(channelId))
            } else {
                editor.putString(keyAudio(channelId), language)
            }
            editor.apply()
        }
    }

    override suspend fun getSubtitleLanguage(channelId: String): Flow<String?> =
        flowOf(prefs.getString(keySubtitle(channelId), null))

    override suspend fun setSubtitleLanguage(channelId: String, language: String?) {
        withContext(ioDispatcher) {
            val editor = prefs.edit()
            if (language.isNullOrBlank()) {
                editor.remove(keySubtitle(channelId))
            } else {
                editor.putString(keySubtitle(channelId), language)
            }
            editor.apply()
        }
    }

    override suspend fun getSubtitlesDisabled(channelId: String): Flow<Boolean> =
        flowOf(prefs.getBoolean(keySubtitlesDisabled(channelId), false))

    override suspend fun setSubtitlesDisabled(channelId: String, disabled: Boolean) {
        withContext(ioDispatcher) {
            prefs.edit().putBoolean(keySubtitlesDisabled(channelId), disabled).apply()
        }
    }

    private fun keyAudio(channelId: String) = "audio_lang_$channelId"
    private fun keySubtitle(channelId: String) = "subtitle_lang_$channelId"
    private fun keySubtitlesDisabled(channelId: String) = "subtitles_disabled_$channelId"

    companion object {
        /** Dedicated preference file so per-channel choices never collide with app settings. */
        const val PREFS_NAME = "channel_track_preferences"
    }
}
