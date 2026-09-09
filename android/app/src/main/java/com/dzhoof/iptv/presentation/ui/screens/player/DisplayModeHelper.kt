package com.dzhoof.iptv.presentation.ui.screens.player

import android.app.Activity
import android.content.Context
import android.view.WindowManager
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import kotlin.math.abs

/**
 * Frame-rate matching glue for live TV.
 *
 * Real Android API used (there is no media3 DisplayModeSwitcher in the pinned
 * media3-exoplayer 1.4.1 — verified against the androidx/media 1.4.1 sources):
 * each `WindowManager.LayoutParams` carries a `preferredDisplayModeId`; when a
 * fullscreen activity sets it, the system switches the connected display to
 * that `Display.Mode` (mode id from `Display.supportedModes`). Choosing the
 * mode whose refresh rate matches the video frame rate removes the 3:2 / 2:2
 * pulldown judder of 24/25/30/50 fps streams on 60 Hz panels.
 *
 * Per-window preference: NO `WRITE_SETTINGS` permission is involved, so no
 * permission gate is needed. Displays that cannot honor the request (some
 * phones outside fullscreen) simply ignore it — the fallback path is a no-op
 * by construction, which is the guarded behaviour the feature documents.
 *
 * Every call is wrapped in try/catch: display-mode switching must never crash
 * the player nor block playback.
 */
internal object DisplayModeHelper {

    /** Common broadcast frame rates used to quantize measured/declared values. */
    private val CANONICAL_FRAME_RATES = floatArrayOf(
        24000f / 1001f, // 23.976
        24f,
        25f,
        30000f / 1001f, // 29.97
        30f,
        50f,
        60000f / 1001f, // 59.94
        60f,
        90f,
        100f,
        120f,
        144f,
    )

    /** Declared video frame rate from the player's current video format, if any. */
    @OptIn(UnstableApi::class)
    fun declaredVideoFrameRate(exoPlayer: ExoPlayer): Float? = try {
        exoPlayer.videoFormat?.frameRate?.takeIf { it > 0f }
    } catch (_: Throwable) {
        null
    }

    /** How many video frames the decoder has rendered so far (for measurement). */
    @OptIn(UnstableApi::class)
    fun renderedFrameCount(exoPlayer: ExoPlayer): Int? = try {
        exoPlayer.videoDecoderCounters?.renderedOutputBufferCount
    } catch (_: Throwable) {
        null
    }

    /** All display modes the current display supports, with their refresh rates. */
    fun supportedModesOf(context: Context): List<DisplayModeDecision.DisplayModeInfo> = try {
        val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
            ?: return emptyList()
        val display = windowManager.defaultDisplay
        display.supportedModes.map { mode ->
            DisplayModeDecision.DisplayModeInfo(
                modeId = mode.modeId,
                refreshRateHz = mode.refreshRate,
                width = mode.physicalWidth,
                height = mode.physicalHeight,
            )
        }
    } catch (_: Throwable) {
        emptyList()
    }

    /** Mode id of the display mode currently in use, or -1 when unavailable. */
    fun currentModeId(context: Context): Int = try {
        val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
            ?: return -1
        windowManager.defaultDisplay.mode.modeId
    } catch (_: Throwable) {
        -1
    }

    /**
     * Round a frame rate to the nearest canonical broadcast rate when it is
     * within ~2.5%, so a noisy measurement (e.g. 25.4 fps over a 4 s window)
     * still matches the intended 25 Hz display mode. Returns the input when no
     * canonical rate is close enough.
     */
    fun quantizeFrameRate(frameRateHz: Float): Float {
        if (frameRateHz <= 0f) return frameRateHz
        var best = frameRateHz
        var bestDelta = abs(CANONICAL_FRAME_RATES[0] - frameRateHz)
        for (rate in CANONICAL_FRAME_RATES) {
            val delta = abs(rate - frameRateHz)
            if (delta < bestDelta) {
                bestDelta = delta
                best = rate
            }
        }
        return if (bestDelta / frameRateHz <= 0.025f) best else frameRateHz
    }

    /**
     * Ask the activity's window to switch to the display mode whose refresh
     * rate best matches [videoFrameRateHz]. Returns true when a switch was
     * requested (or the window was already on that mode); false when no
     * matching mode exists, the rate is unknown, or anything failed.
     */
    fun applyMatchForVideo(activity: Activity, videoFrameRateHz: Float): Boolean {
        val modeId = chooseModeForVideo(activity, videoFrameRateHz) ?: return false
        return try {
            val window = activity.window
            val attributes = window.attributes
            if (attributes.preferredDisplayModeId == modeId) return true
            attributes.preferredDisplayModeId = modeId
            window.attributes = attributes
            true
        } catch (_: Throwable) {
            false
        }
    }

    /** Restore the system default display mode (preferredDisplayModeId = 0). */
    fun restoreDefaultMode(activity: Activity) {
        try {
            val window = activity.window
            val attributes = window.attributes
            if (attributes.preferredDisplayModeId == 0) return
            attributes.preferredDisplayModeId = 0
            window.attributes = attributes
        } catch (_: Throwable) {
            // Best effort only.
        }
    }

    private fun chooseModeForVideo(activity: Activity, videoFrameRateHz: Float): Int? = try {
        val modes = supportedModesOf(activity)
        if (modes.isEmpty()) return null
        val currentModeId = currentModeId(activity)
        if (currentModeId < 0) return null
        DisplayModeDecision.chooseDisplayMode(
            availableModes = modes,
            videoFrameRateHz = videoFrameRateHz,
            currentModeId = currentModeId,
        )
    } catch (_: Throwable) {
        null
    }
}
