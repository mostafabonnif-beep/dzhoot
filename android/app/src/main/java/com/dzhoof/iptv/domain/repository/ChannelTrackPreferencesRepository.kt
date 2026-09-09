package com.dzhoof.iptv.domain.repository

import kotlinx.coroutines.flow.Flow

/**
 * Per-channel audio/subtitle selection preferences.
 *
 * Remembers the user's track language choice for every channel so that
 * re-entering a channel (or zapping back to it) restores the same audio and
 * subtitle tracks without any manual action. Choices are stored per channel id
 * in a dedicated SharedPreferences file; a null language means "no preference"
 * (clear / fall back to Media3 defaults).
 *
 * Backed by plain SharedPreferences — no DataStore, no JSON.
 */
interface ChannelTrackPreferencesRepository {

    /**
     * Stored audio language for [channelId], or null when the user never picked
     * an audio track for this channel.
     */
    suspend fun getAudioLanguage(channelId: String): Flow<String?>

    /**
     * Persist the audio language for [channelId]. A null value clears any
     * previously stored choice.
     */
    suspend fun setAudioLanguage(channelId: String, language: String?)

    /**
     * Stored subtitle language for [channelId], or null when the user never
     * picked a subtitle track for this channel.
     */
    suspend fun getSubtitleLanguage(channelId: String): Flow<String?>

    /**
     * Persist the subtitle language for [channelId]. A null value clears any
     * previously stored choice.
     */
    suspend fun setSubtitleLanguage(channelId: String, language: String?)

    /**
     * Whether subtitles are explicitly disabled for [channelId]. Defaults to
     * false (subtitles enabled) when the user never touched subtitles here.
     */
    suspend fun getSubtitlesDisabled(channelId: String): Flow<Boolean>

    /**
     * Persist the subtitles-disabled flag for [channelId].
     */
    suspend fun setSubtitlesDisabled(channelId: String, disabled: Boolean)
}
