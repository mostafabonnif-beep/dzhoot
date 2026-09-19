package com.dzhoof.iptv.presentation.ui.player

import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.MediaSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Manages error recovery for playback with automatic reconnection,
 * proxy fallback, and alternate stream fallback.
 *
 * Recovery ladder:
 * 1. On a parsing/container error, retry the SAME url once with the OPPOSITE
 *    media source type (HLS <-> progressive); this costs no extra upstream
 *    session (D4).
 * 2. Then the current slot's proxy URL, when one exists (1 attempt).
 * 3. Then each already-known alternate slot, then slots the fallback resolver
 *    can still provide (up to [MAX_FALLBACK_SLOTS] total).
 * 4. Network/IO errors retry the current URL with backoff up to the slot quota.
 * 5. If all retries are exhausted, signal the stream as dead.
 *
 * Every media source is built through [buildMediaSource], the same entry point
 * the initial prepare uses, so explicit HLS/progressive decisions survive a
 * retry instead of falling back to Media3's extension inference (D2).
 */
class ErrorRecoveryManager(
    private val player: ExoPlayer,
    private val scope: CoroutineScope,
    /**
     * Builds sources exactly like the initial prepare. [container] non-null
     * forces that container (opposite-container retry); null routes from
     * url + mimeType via [PlaybackSourceRouting].
     */
    private val buildMediaSource: (url: String, mimeType: String?, container: PlaybackContainer?) -> MediaSource,
    private val onError: (String) -> Unit,
    private val onRecovering: (attempt: Int) -> Unit,
    private val onRecovered: () -> Unit,
    private val onStreamDead: (errorMessage: String, diagnosticCode: String?) -> Unit,
    private val onStreamUnresponsive: (() -> Unit)? = null,
    private val onProxyFallback: (() -> Unit)? = null,
    private val onAlternateFallback: ((streamUrl: String) -> Unit)? = null
) {
    data class StreamSlot(
        val directUrl: String,
        val proxyUrl: String?,
        val isPrimary: Boolean,
        val mimeType: String? = null,
    )

    private var reconnectJob: Job? = null
    private var bufferWatchJob: Job? = null
    private var isRecoveringState = false

    private var streamSlots: List<StreamSlot> = emptyList()
    private var fallbackResolver: (suspend (slot: Int) -> StreamSlot?)? = null
    private var currentSlotIndex = 0
    private var attemptInSlot = 0
    private var totalAttempts = 0

    /** Container forced for the current URL after an opposite-container retry. */
    private var containerOverride: PlaybackContainer? = null

    /** Guards the one-shot opposite-container retry against repeating. */
    private var oppositeContainerTried = false

    private val reconnectDelayMs = 2000L
    private val unresponsiveThresholdMs = 30_000L

    /** The stream URL that is currently being played (direct or proxy). */
    val activeStreamUrl: String?
        get() {
            val slot = streamSlots.getOrNull(currentSlotIndex) ?: return null
            return slot.directUrl
        }

    val maxTotalAttempts: Int
        get() = streamSlots.mapIndexed { index, _ -> maxAttemptsForSlot(index) }.sum() +
            if (fallbackResolver != null) (MAX_FALLBACK_SLOTS - streamSlots.size).coerceAtLeast(0) else 0

    private fun maxAttemptsForSlot(slotIndex: Int): Int {
        val slot = streamSlots.getOrNull(slotIndex) ?: return 0
        val directAttempts = if (slotIndex == 0) 3 else 1
        val proxyAttempts = if (slot.proxyUrl != null) 1 else 0
        return directAttempts + proxyAttempts
    }

    private fun isProxyAttempt(): Boolean {
        val slot = streamSlots.getOrNull(currentSlotIndex) ?: return false
        val directAttempts = if (currentSlotIndex == 0) 3 else 1
        return attemptInSlot > directAttempts && slot.proxyUrl != null
    }

    private fun currentUrl(): String? {
        val slot = streamSlots.getOrNull(currentSlotIndex) ?: return null
        return if (isProxyAttempt()) slot.proxyUrl else slot.directUrl
    }

    private val playerListener = object : Player.Listener {
        override fun onPlayerError(error: PlaybackException) {
            handleError(error)
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_READY && isRecoveringState) {
                isRecoveringState = false
                reconnectJob?.cancel()
                onRecovered()
            }

            // Track buffering for unresponsive detection
            // Skip during error recovery — recovery already handles retries
            if (playbackState == Player.STATE_BUFFERING && !isRecoveringState) {
                startBufferWatch()
            } else {
                bufferWatchJob?.cancel()
                bufferWatchJob = null
            }
        }
    }

    init {
        player.addListener(playerListener)
    }

    private fun startBufferWatch() {
        bufferWatchJob?.cancel()
        bufferWatchJob = scope.launch {
            delay(unresponsiveThresholdMs)
            if (player.playbackState == Player.STATE_BUFFERING) {
                onStreamUnresponsive?.invoke()
                if (totalAttempts < maxTotalAttempts) {
                    attemptReconnect()
                } else {
                    onStreamDead("البث لا يستجيب (انتهت مهلة التخزين المؤقت)", "buffer_timeout")
                }
            }
        }
    }

    /**
     * Set the stream slots to use for fallback. The first slot is the primary stream.
     * Replaces the old setProxyUrl() API.
     */
    fun setStreamSlots(slots: List<StreamSlot>) {
        streamSlots = slots
        currentSlotIndex = 0
        attemptInSlot = 0
        totalAttempts = 0
        containerOverride = null
        oppositeContainerTried = false
    }

    fun setFallbackResolver(resolver: (suspend (slot: Int) -> StreamSlot?)?) {
        fallbackResolver = resolver
    }

    private fun handleError(error: PlaybackException) {
        val errorMessage = when (error.errorCode) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> {
                "انقطع اتصال الشبكة"
            }
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> {
                "خطأ في الخادم"
            }
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
            PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED -> {
                "تنسيق البث غير صالح"
            }
            else -> {
                "خطأ في التشغيل: ${error.message}"
            }
        }

        when {
            isParsingError(error) -> {
                // A parsing error means the bytes we got are unusable under the
                // container we guessed. Before giving up on the URL, retry it
                // ONCE with the opposite container (D4) — the relay's guess may
                // simply be wrong. Only then fall through to the proxy / next
                // slot ladder, and finally to dead.
                if (retryWithOppositeContainer()) {
                    onError(errorMessage)
                    return
                }
                if (totalAttempts < maxTotalAttempts && hasFallbackRemaining()) {
                    onError(errorMessage)
                    skipToFallback()
                    return
                }
                onStreamDead(errorMessage, error.errorCodeName)
            }
            isNetworkError(error) -> {
                if (totalAttempts >= maxTotalAttempts) {
                    onStreamDead(errorMessage, error.errorCodeName)
                    return
                }
                onError(errorMessage)
                attemptReconnect()
            }
            else -> onStreamDead(errorMessage, error.errorCodeName)
        }
    }

    /**
     * Retry the URL currently loaded with the opposite container, once per URL.
     *
     * Does not consume a slot attempt, so a wrong guess followed by a fatal
     * error can never loop: [oppositeContainerTried] flips true and only resets
     * when the URL changes (next slot or proxy switch).
     *
     * @return true when a retry was scheduled.
     */
    private fun retryWithOppositeContainer(): Boolean {
        if (oppositeContainerTried) return false
        val slot = streamSlots.getOrNull(currentSlotIndex) ?: return false
        val url = currentUrl() ?: return false
        val currentContainer = containerOverride
            ?: PlaybackSourceRouting.containerFor(url, slot.mimeType)
        val opposite = PlaybackSourceRouting.opposite(currentContainer)
        containerOverride = opposite
        oppositeContainerTried = true
        reconnectJob?.cancel()
        isRecoveringState = true
        reconnectJob = scope.launch {
            player.setMediaSource(buildMediaSource(url, slot.mimeType, opposite))
            onRecovering(totalAttempts + 1)
            delay(reconnectDelayMs)
            player.prepare()
            player.play()
        }
        return true
    }

    private fun isNetworkError(error: PlaybackException): Boolean {
        return error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
                error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ||
                error.errorCode == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS
    }

    private fun isParsingError(error: PlaybackException): Boolean {
        return error.errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED ||
                error.errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED ||
                error.errorCode == PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED ||
                error.errorCode == PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED
    }

    /**
     * True when another URL is still untried: this slot's proxy (only when one
     * exists), an already-known later slot, or a slot the resolver can provide.
     *
     * Deliberately does NOT require [StreamSlot.proxyUrl]: production runs with
     * ALLOW_DIRECT_PLAYBACK=false so proxyUrl is always null, and a proxy-only
     * gate silently disabled the whole ladder (D5).
     */
    private fun hasFallbackRemaining(): Boolean {
        val slot = streamSlots.getOrNull(currentSlotIndex)
        if (slot != null && !isProxyAttempt() && slot.proxyUrl != null) return true
        if (currentSlotIndex < streamSlots.size - 1) return true
        return fallbackResolver != null && currentSlotIndex < MAX_FALLBACK_SLOTS - 1
    }

    /**
     * Jump past the remaining same-URL retries so the next attempt uses the
     * slot's proxy URL (or moves to the next slot). Used for parsing errors,
     * where re-fetching identical bytes cannot recover playback.
     */
    private fun skipToFallback() {
        val directAttempts = if (currentSlotIndex == 0) 3 else 1
        attemptInSlot = maxOf(attemptInSlot, directAttempts)
        attemptReconnect()
    }

    private fun attemptReconnect() {
        reconnectJob?.cancel()
        isRecoveringState = true
        reconnectJob = scope.launch {
            attemptInSlot++
            totalAttempts++

            // Check if we've exhausted attempts for the current slot
            val maxForSlot = maxAttemptsForSlot(currentSlotIndex)
            if (attemptInSlot > maxForSlot) {
                // Resolve optional alternates only after the current stream fails.
                currentSlotIndex++
                attemptInSlot = 1

                if (currentSlotIndex >= streamSlots.size) {
                    val resolved = fallbackResolver?.invoke(currentSlotIndex)
                    if (resolved != null) streamSlots = streamSlots + resolved
                }

                if (currentSlotIndex >= streamSlots.size) {
                    onStreamDead("استُنفدت جميع مصادر البث", "recovery_exhausted")
                    return@launch
                }

                val newSlot = streamSlots[currentSlotIndex]
                onAlternateFallback?.invoke(newSlot.directUrl)

                // A new URL earns its own one-shot opposite-container retry, and
                // any container forced for the previous URL no longer applies.
                containerOverride = null
                oppositeContainerTried = false
                player.setMediaSource(
                    buildMediaSource(newSlot.directUrl, newSlot.mimeType, null),
                )
            } else if (isProxyAttempt()) {
                // Switch to proxy for current slot
                val slot = streamSlots[currentSlotIndex]
                val proxyUrl = slot.proxyUrl!!
                onProxyFallback?.invoke()
                containerOverride = null
                oppositeContainerTried = false
                player.setMediaSource(
                    buildMediaSource(proxyUrl, slot.mimeType, null),
                )
            }

            val delayTime = reconnectDelayMs * attemptInSlot
            onRecovering(totalAttempts)
            delay(delayTime)

            player.prepare()
            player.play()
        }
    }

    /**
     * Reset reconnection state. Call when switching to a new channel.
     */
    fun reset() {
        currentSlotIndex = 0
        attemptInSlot = 0
        totalAttempts = 0
        containerOverride = null
        oppositeContainerTried = false
        isRecoveringState = false
        reconnectJob?.cancel()
        bufferWatchJob?.cancel()
        fallbackResolver = null
    }

    fun retry() {
        currentSlotIndex = 0
        attemptInSlot = 0
        totalAttempts = 0
        containerOverride = null
        oppositeContainerTried = false
        isRecoveringState = true
        player.prepare()
        player.play()
    }

    private var isReleased = false

    companion object {
        private const val MAX_FALLBACK_SLOTS = 4
    }

    fun release() {
        if (isReleased) return
        isReleased = true
        reconnectJob?.cancel()
        bufferWatchJob?.cancel()
        player.removeListener(playerListener)
    }
}
