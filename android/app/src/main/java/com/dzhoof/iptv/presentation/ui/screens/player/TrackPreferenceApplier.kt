package com.dzhoof.iptv.presentation.ui.screens.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import com.dzhoof.iptv.data.repository.TrackPreferenceMatcher

/**
 * Media3 glue for per-channel track preferences.
 *
 * Mirrors the override patterns used by [PlayerTracksPanel] (see its
 * `selectTrack` / `disableSubtitles`): overrides are applied through
 * `exoPlayer.trackSelectionParameters.buildUpon()`. The pure decision logic
 * lives in [TrackPreferenceMatcher] so it stays JVM-testable.
 */
@OptIn(UnstableApi::class)
internal object TrackPreferenceApplier {

    /**
     * Language-indexed snapshot of the player's current supported audio/text
     * groups. Returns null when no tracks are attached yet (still preparing).
     */
    fun snapshotOf(exoPlayer: ExoPlayer): TrackPreferenceMatcher.TrackSelectionSnapshot? {
        val groups = exoPlayer.currentTracks.groups
        if (groups.isEmpty()) return null

        val audio = mutableListOf<TrackPreferenceMatcher.AudioTrackLike>()
        val text = mutableListOf<TrackPreferenceMatcher.TextTrackLike>()
        groups.forEachIndexed { groupIndex, group ->
            if (!group.isSupported) return@forEachIndexed
            when (group.type) {
                C.TRACK_TYPE_AUDIO -> {
                    for (trackIndex in 0 until group.length) {
                        audio += TrackPreferenceMatcher.AudioTrackLike(
                            groupIndex = groupIndex,
                            trackIndex = trackIndex,
                            language = group.getTrackFormat(trackIndex).language
                        )
                    }
                }
                C.TRACK_TYPE_TEXT -> {
                    for (trackIndex in 0 until group.length) {
                        text += TrackPreferenceMatcher.TextTrackLike(
                            groupIndex = groupIndex,
                            trackIndex = trackIndex,
                            language = group.getTrackFormat(trackIndex).language
                        )
                    }
                }
            }
        }
        return TrackPreferenceMatcher.TrackSelectionSnapshot(audioTracks = audio, textTracks = text)
    }

    /**
     * Apply a [TrackPreferenceMatcher.TrackPreferenceDecision] to the player.
     *
     * The decision's track references are re-resolved against the *live*
     * `currentTracks`; if the groups changed since the decision was computed
     * (channel switched, item re-prepared) the references may no longer line
     * up, so the apply is abandoned and returns false.
     */
    fun apply(
        exoPlayer: ExoPlayer,
        decision: TrackPreferenceMatcher.TrackPreferenceDecision,
    ): Boolean {
        val groups = exoPlayer.currentTracks.groups
        if (groups.isEmpty()) return false

        val audioRef = decision.selectAudio
        val subtitleRef = decision.selectSubtitle

        // Re-resolve both references up-front so we never half-apply a stale decision.
        val audioGroup = audioRef?.let { ref ->
            val group = groups.getOrNull(ref.groupIndex)
            if (group == null || group.type != C.TRACK_TYPE_AUDIO || ref.trackIndex !in 0 until group.length) {
                return false
            }
            group
        }
        val subtitleGroup = subtitleRef?.let { ref ->
            val group = groups.getOrNull(ref.groupIndex)
            if (group == null || group.type != C.TRACK_TYPE_TEXT || ref.trackIndex !in 0 until group.length) {
                return false
            }
            group
        }

        val builder = exoPlayer.trackSelectionParameters.buildUpon()
        audioGroup?.let { group ->
            builder.setOverrideForType(
                TrackSelectionOverride(group.mediaTrackGroup, audioRef!!.trackIndex)
            )
            builder.setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false)
        }
        subtitleGroup?.let { group ->
            builder.setOverrideForType(
                TrackSelectionOverride(group.mediaTrackGroup, subtitleRef!!.trackIndex)
            )
            builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
        }
        if (subtitleGroup == null) {
            // No stored subtitle match (or subtitles explicitly off): keep the
            // per-channel disabled bit authoritative so a disable chosen on one
            // channel never bleeds into a channel where subtitles are allowed.
            builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, decision.subtitlesDisabled)
        }
        exoPlayer.trackSelectionParameters = builder.build()
        return true
    }
}
