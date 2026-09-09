package com.dzhoof.iptv.data.repository

import com.dzhoof.iptv.data.repository.TrackPreferenceMatcher.AudioTrackLike
import com.dzhoof.iptv.data.repository.TrackPreferenceMatcher.TextTrackLike
import com.dzhoof.iptv.data.repository.TrackPreferenceMatcher.TrackRef
import com.dzhoof.iptv.data.repository.TrackPreferenceMatcher.TrackSelectionSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackPreferenceMatcherTest {

    private fun audio(vararg languages: String?) = languages.mapIndexed { i, language ->
        AudioTrackLike(groupIndex = 0, trackIndex = i, language = language)
    }

    private fun text(vararg languages: String?) = languages.mapIndexed { i, language ->
        TextTrackLike(groupIndex = 0, trackIndex = i, language = language)
    }

    private fun decide(
        audioLanguages: List<String?> = emptyList(),
        textLanguages: List<String?> = emptyList(),
        audioLang: String? = null,
        subtitleLang: String? = null,
        subtitlesDisabled: Boolean? = null
    ) = TrackPreferenceMatcher.decide(
        snapshot = TrackSelectionSnapshot(
            audioTracks = audio(*audioLanguages.toTypedArray()),
            textTracks = text(*textLanguages.toTypedArray()),
        ),
        storedAudioLanguage = audioLang,
        storedSubtitleLanguage = subtitleLang,
        storedSubtitlesDisabled = subtitlesDisabled,
    )

    // ── Audio ────────────────────────────────────────────────────

    @Test
    fun `no stored prefs leaves media3 defaults`() {
        val decision = decide(audioLanguages = listOf("ar", "en"), textLanguages = listOf("fr"))
        assertNull(decision.selectAudio)
        assertNull(decision.selectSubtitle)
        assertFalse(decision.subtitlesDisabled)
    }

    @Test
    fun `stored audio language selects first matching track`() {
        val decision = decide(audioLanguages = listOf("en", "ar", "ar"), audioLang = "ar")
        assertEquals(TrackRef(0, 1), decision.selectAudio)
    }

    @Test
    fun `audio language match is case and whitespace insensitive`() {
        val decision = decide(audioLanguages = listOf("AR", " en "), audioLang = "ar")
        assertEquals(TrackRef(0, 0), decision.selectAudio)
    }

    @Test
    fun `audio language matches primary subtag of a regional track`() {
        val decision = decide(audioLanguages = listOf("ar-EG"), audioLang = "ar")
        assertEquals(TrackRef(0, 0), decision.selectAudio)
    }

    @Test
    fun `audio language matches regional stored value against plain track`() {
        val decision = decide(audioLanguages = listOf("ar"), audioLang = "ar-EG")
        assertEquals(TrackRef(0, 0), decision.selectAudio)
    }

    @Test
    fun `stored audio language absent from snapshot leaves audio unselected`() {
        val decision = decide(audioLanguages = listOf("en", "fr"), audioLang = "de")
        assertNull(decision.selectAudio)
    }

    @Test
    fun `blank stored audio language is treated as no preference`() {
        val decision = decide(audioLanguages = listOf("ar"), audioLang = "  ")
        assertNull(decision.selectAudio)
    }

    // ── Subtitles ────────────────────────────────────────────────

    @Test
    fun `stored subtitle language selects matching text track`() {
        val decision = decide(textLanguages = listOf("en", "ar"), subtitleLang = "ar")
        assertEquals(TrackRef(0, 1), decision.selectSubtitle)
    }

    @Test
    fun `subtitles off wins over a stored subtitle language`() {
        val decision = decide(
            textLanguages = listOf("ar"),
            subtitleLang = "ar",
            subtitlesDisabled = true
        )
        assertNull(decision.selectSubtitle)
        assertTrue(decision.subtitlesDisabled)
    }

    @Test
    fun `subtitles explicitly disabled stays disabled`() {
        val decision = decide(textLanguages = listOf("en"), subtitlesDisabled = true)
        assertTrue(decision.subtitlesDisabled)
    }

    @Test
    fun `subtitles never touched are enabled`() {
        val decision = decide(textLanguages = listOf("en"))
        assertFalse(decision.subtitlesDisabled)
    }

    // ── Snapshot edge cases ──────────────────────────────────────

    @Test
    fun `empty snapshot produces no selection`() {
        val decision = decide(audioLang = "ar", subtitleLang = "fr")
        assertNull(decision.selectAudio)
        assertNull(decision.selectSubtitle)
    }

    @Test
    fun `multi-group snapshot matches within the right group`() {
        val snapshot = TrackSelectionSnapshot(
            audioTracks = listOf(
                AudioTrackLike(groupIndex = 1, trackIndex = 0, language = "ar"),
                AudioTrackLike(groupIndex = 2, trackIndex = 0, language = "fr"),
            )
        )
        val decision = TrackPreferenceMatcher.decide(
            snapshot = snapshot,
            storedAudioLanguage = "fr",
            storedSubtitleLanguage = null,
            storedSubtitlesDisabled = null,
        )
        assertEquals(TrackRef(2, 0), decision.selectAudio)
    }
}
