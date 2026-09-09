package com.dzhoof.iptv.presentation.ui.screens.player

import kotlin.math.abs

/**
 * Pure display-mode selection for frame-rate matching (no android imports —
 * JVM-unit-testable).
 *
 * Live TV judder comes from rendering, say, 25 fps video on a 60 Hz display
 * (3:2 pulldown). When the stream's frame rate is known and the display
 * exposes a matching mode (50 Hz for 25/50 fps, 24 Hz for 24 fps, 60 Hz for
 * 30/60 fps, ...), the player window asks the system to switch to that mode.
 *
 * The android glue lives in [DisplayModeHelper]; this object only decides.
 */
object DisplayModeDecision {

    /** Relative tolerance: a mode is a "match" when within ±0.5% of the video rate. */
    const val MATCH_TOLERANCE = 0.005f

    /** One supported display mode, mirroring `Display.Mode`. */
    data class DisplayModeInfo(
        val modeId: Int,
        val refreshRateHz: Float,
        val width: Int = 0,
        val height: Int = 0,
    )

    /**
     * Pick the display mode to switch to for [videoFrameRateHz].
     *
     * Returns null (keep the current mode) when:
     *  - the video rate is unknown/not positive, or no modes are listed;
     *  - the current mode is already within ±0.5% of the video rate
     *    (difference is negligible — nothing to gain);
     *  - no listed mode is within ±0.5% of the video rate.
     *
     * Otherwise returns the mode id of the closest match, preferring the mode
     * whose refresh rate is nearest the video rate and (for ties) whose
     * physical resolution is closest to the current mode's, so a 1080p60
     * current mode is not bounced to 4K60 just for the same refresh rate.
     */
    fun chooseDisplayMode(
        availableModes: List<DisplayModeInfo>,
        videoFrameRateHz: Float,
        currentModeId: Int,
    ): Int? {
        if (videoFrameRateHz <= 0f || availableModes.isEmpty()) return null
        val current = availableModes.firstOrNull { it.modeId == currentModeId } ?: return null

        // Already synced to the video rate → nothing to do.
        if (isMatch(videoFrameRateHz, current.refreshRateHz)) return null

        val candidates = availableModes
            .filter { it.modeId != currentModeId && isMatch(videoFrameRateHz, it.refreshRateHz) }
            .ifEmpty { return null }

        return candidates
            .sortedWith(
                compareBy<DisplayModeInfo> { abs(it.refreshRateHz - videoFrameRateHz) }
                    .thenBy { abs(it.width - current.width) + abs(it.height - current.height) }
                    .thenBy { it.refreshRateHz }
            )
            .first()
            .modeId
    }

    /** True when [rate] is within ±0.5% of [target]. */
    fun isMatch(target: Float, rate: Float): Boolean {
        if (target <= 0f || rate <= 0f) return false
        return abs(target - rate) / target <= MATCH_TOLERANCE
    }
}
