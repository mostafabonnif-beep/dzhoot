package com.dzhoof.iptv.data.repository

/**
 * Pure, android-free track-selection logic for per-channel track preferences.
 *
 * Media3 classes are intentionally absent here: JVM unit tests can build
 * [TrackSelectionSnapshot] directly. The android/media3 glue that maps a
 * snapshot to real `Tracks.Group` objects lives in
 * `presentation/ui/screens/player/TrackPreferenceApplier.kt`.
 */
object TrackPreferenceMatcher {

    /** Minimal audio track: language plus its position inside [TrackSelectionSnapshot]. */
    data class AudioTrackLike(
        val groupIndex: Int,
        val trackIndex: Int,
        val language: String?,
    )

    /** Minimal text (subtitle) track: language plus its position inside [TrackSelectionSnapshot]. */
    data class TextTrackLike(
        val groupIndex: Int,
        val trackIndex: Int,
        val language: String?,
    )

    /** Language-indexed view of the tracks currently attached to the player. */
    data class TrackSelectionSnapshot(
        val audioTracks: List<AudioTrackLike> = emptyList(),
        val textTracks: List<TextTrackLike> = emptyList(),
    ) {
        val isEmpty: Boolean get() = audioTracks.isEmpty() && textTracks.isEmpty()
    }

    /** Concrete track reference, resolved against the snapshot that produced the decision. */
    data class TrackRef(
        val groupIndex: Int,
        val trackIndex: Int,
    )

    /**
     * What to apply to the player for one media item.
     *
     * `subtitlesDisabled` is always concrete: false (enabled) when the user
     * never disabled subtitles for this channel, so a stale "text disabled"
     * state carried over from another channel is reset per channel.
     */
    data class TrackPreferenceDecision(
        val selectAudio: TrackRef? = null,
        val selectSubtitle: TrackRef? = null,
        val subtitlesDisabled: Boolean = false,
    ) {
        /** Whether the decision carries any real action beyond the default text-enabled bit. */
        val hasSelection: Boolean get() = selectAudio != null || selectSubtitle != null || subtitlesDisabled
    }

    /**
     * Decide which stored preferences apply to [snapshot].
     *
     * @param storedAudioLanguage saved audio language for the channel, null = none
     * @param storedSubtitleLanguage saved subtitle language, null = none
     * @param storedSubtitlesDisabled saved subtitles-off flag, null = never set
     */
    fun decide(
        snapshot: TrackSelectionSnapshot,
        storedAudioLanguage: String?,
        storedSubtitleLanguage: String?,
        storedSubtitlesDisabled: Boolean?,
    ): TrackPreferenceDecision {
        val subtitlesDisabled = storedSubtitlesDisabled ?: false

        val audioRef = if (storedAudioLanguage.isNullOrBlank()) {
            null
        } else {
            snapshot.audioTracks
                .firstOrNull { languagesMatch(it.language, storedAudioLanguage) }
                ?.let { TrackRef(it.groupIndex, it.trackIndex) }
        }

        val subtitleRef = if (storedSubtitleLanguage.isNullOrBlank() || subtitlesDisabled) {
            null
        } else {
            snapshot.textTracks
                .firstOrNull { languagesMatch(it.language, storedSubtitleLanguage) }
                ?.let { TrackRef(it.groupIndex, it.trackIndex) }
        }

        return TrackPreferenceDecision(
            selectAudio = audioRef,
            selectSubtitle = subtitleRef,
            subtitlesDisabled = subtitlesDisabled,
        )
    }

    /**
     * Loose BCP-47 comparison: exact match wins, otherwise compare primary
     * language subtags so "ar" matches "ar-EG" (and vice-versa). Case and
     * surrounding whitespace are ignored.
     */
    private fun languagesMatch(trackLanguage: String?, storedLanguage: String?): Boolean {
        val track = normalize(trackLanguage) ?: return false
        val stored = normalize(storedLanguage) ?: return false
        if (track == stored) return true
        val trackSubtag = track.substringBefore('-')
        val storedSubtag = stored.substringBefore('-')
        return trackSubtag == stored || track == storedSubtag || (trackSubtag.isNotEmpty() && trackSubtag == storedSubtag)
    }

    private fun normalize(language: String?): String? =
        language?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
}
