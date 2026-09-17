package com.dzhoof.iptv.presentation.ui.player

import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.MediaSource
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ErrorRecoveryManagerTest {

    private lateinit var player: ExoPlayer
    private val listenerSlot = slot<Player.Listener>()

    /** Sources requested through the injected builder, in order. */
    private data class BuiltSource(
        val url: String,
        val mimeType: String?,
        val container: PlaybackContainer?,
    )
    private val builtSources = mutableListOf<BuiltSource>()

    private val onErrorMessages = mutableListOf<String>()
    private val onRecoveringAttempts = mutableListOf<Int>()
    private var onRecoveredCalled = false
    private val onStreamDeadMessages = mutableListOf<String>()
    private var onStreamUnresponsiveCalled = false
    private var onProxyFallbackCalled = false
    private val onAlternateFallbackUrls = mutableListOf<String>()

    @Before
    fun setup() {
        player = mockk(relaxed = true)
        every { player.addListener(capture(listenerSlot)) } just runs
        builtSources.clear()
        onErrorMessages.clear()
        onRecoveringAttempts.clear()
        onRecoveredCalled = false
        onStreamDeadMessages.clear()
        onStreamUnresponsiveCalled = false
        onProxyFallbackCalled = false
        onAlternateFallbackUrls.clear()
    }

    private fun makeManager(scope: kotlinx.coroutines.CoroutineScope): ErrorRecoveryManager {
        return ErrorRecoveryManager(
            player = player,
            scope = scope,
            buildMediaSource = { url, mimeType, container ->
                builtSources.add(BuiltSource(url, mimeType, container))
                mockk<MediaSource>(relaxed = true)
            },
            onError = { onErrorMessages.add(it) },
            onRecovering = { onRecoveringAttempts.add(it) },
            onRecovered = { onRecoveredCalled = true },
            onStreamDead = { message, _ -> onStreamDeadMessages.add(message) },
            onStreamUnresponsive = { onStreamUnresponsiveCalled = true },
            onProxyFallback = { onProxyFallbackCalled = true },
            onAlternateFallback = { onAlternateFallbackUrls.add(it) }
        )
    }

    private fun networkError(): PlaybackException =
        PlaybackException("Network error", null, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED)

    private fun parsingError(): PlaybackException =
        PlaybackException("Parsing error", null, PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED)

    private fun nonNetworkError(): PlaybackException =
        PlaybackException("Decode error", null, PlaybackException.ERROR_CODE_UNSPECIFIED)

    private fun primarySlot(
        directUrl: String = "http://primary.m3u8",
        proxyUrl: String? = null,
        mimeType: String? = null
    ) = ErrorRecoveryManager.StreamSlot(
        directUrl = directUrl,
        proxyUrl = proxyUrl,
        isPrimary = true,
        mimeType = mimeType,
    )

    private fun alternateSlot(
        directUrl: String = "http://alt.m3u8",
        proxyUrl: String? = null,
        mimeType: String? = null
    ) = ErrorRecoveryManager.StreamSlot(
        directUrl = directUrl,
        proxyUrl = proxyUrl,
        isPrimary = false,
        mimeType = mimeType,
    )

    // ── Registration ─────────────────────────────────────────────

    @Test
    fun `init registers player listener`() = runTest {
        makeManager(this)
        verify { player.addListener(any()) }
    }

    // ── Network error handling ───────────────────────────────────

    @Test
    fun `network error with slots available calls onError and attemptReconnect`() = runTest {
        val manager = makeManager(this)
        manager.setStreamSlots(listOf(primarySlot()))

        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(3000)
        runCurrent()

        assertEquals(1, onErrorMessages.size)
        assertEquals(1, onRecoveringAttempts.size)
        verify { player.prepare() }
        verify { player.play() }
    }

    @Test
    fun `non-network error with no retries left calls onStreamDead directly`() = runTest {
        val manager = makeManager(this)
        manager.setStreamSlots(listOf(primarySlot()))

        listenerSlot.captured.onPlayerError(nonNetworkError())
        runCurrent()

        assertEquals(1, onStreamDeadMessages.size)
        assertEquals(0, onErrorMessages.size)
    }

    // ── Max retries ──────────────────────────────────────────────

    @Test
    fun `after max retries calls onStreamDead`() = runTest {
        val manager = makeManager(this)
        // Primary slot with no proxy: 3 direct attempts → maxTotalAttempts = 3
        manager.setStreamSlots(listOf(primarySlot()))

        // Exhaust 3 attempts
        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(3000)
        runCurrent()

        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(5000)
        runCurrent()

        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(7000)
        runCurrent()

        // Fourth error: totalAttempts (3) is no longer < maxTotalAttempts (3)
        listenerSlot.captured.onPlayerError(networkError())
        runCurrent()

        assertEquals(1, onStreamDeadMessages.size)
    }

    // ── Recovery ─────────────────────────────────────────────────

    @Test
    fun `recovers when playback state becomes READY while recovering`() = runTest {
        val manager = makeManager(this)
        manager.setStreamSlots(listOf(primarySlot()))

        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(3000)
        runCurrent()

        listenerSlot.captured.onPlaybackStateChanged(Player.STATE_READY)
        runCurrent()

        assert(onRecoveredCalled)
    }

    // ── reset() ──────────────────────────────────────────────────

    @Test
    fun `reset cancels jobs and resets state`() = runTest {
        val manager = makeManager(this)
        manager.setStreamSlots(listOf(primarySlot()))

        listenerSlot.captured.onPlayerError(networkError())
        runCurrent()

        manager.reset()
        runCurrent()

        // After reset, a subsequent non-network error should hit onStreamDead
        // because totalAttempts was reset to 0, but isRecoveringState is false
        // and a non-network error always calls onStreamDead
        listenerSlot.captured.onPlayerError(nonNetworkError())
        runCurrent()

        assertEquals(1, onStreamDeadMessages.size)
    }

    // ── retry() ──────────────────────────────────────────────────

    @Test
    fun `retry resets and prepares player`() = runTest {
        val manager = makeManager(this)
        manager.setStreamSlots(listOf(primarySlot()))

        manager.retry()
        runCurrent()

        verify { player.prepare() }
        verify { player.play() }
    }

    // ── release() ────────────────────────────────────────────────

    @Test
    fun `release removes listener and cancels jobs`() = runTest {
        val manager = makeManager(this)

        manager.release()

        verify { player.removeListener(any()) }
    }

    // ── setStreamSlots() ─────────────────────────────────────────

    @Test
    fun `setStreamSlots resets counters`() = runTest {
        val manager = makeManager(this)
        manager.setStreamSlots(listOf(primarySlot()))

        // Fire one error to increment counters
        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(3000)
        runCurrent()

        // Re-set slots: counters should reset
        manager.setStreamSlots(listOf(primarySlot()))

        // Should be able to attempt again from zero
        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(3000)
        runCurrent()

        // onRecovering called twice (once per error)
        assertEquals(2, onRecoveringAttempts.size)
    }

    // ── Proxy fallback ───────────────────────────────────────────

    @Test
    fun `proxy attempt switches to proxy URL`() = runTest {
        val manager = makeManager(this)
        manager.setStreamSlots(listOf(primarySlot(proxyUrl = "http://proxy.m3u8")))

        // Three direct attempts exhaust the primary direct quota (maxDirectAttempts = 3)
        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(3000)
        runCurrent()

        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(5000)
        runCurrent()

        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(7000)
        runCurrent()

        // Fourth error triggers proxy attempt
        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(9000)
        runCurrent()

        assert(onProxyFallbackCalled)
    }

    // ── activeStreamUrl ──────────────────────────────────────────

    @Test
    fun `activeStreamUrl returns direct url of current slot`() = runTest {
        val manager = makeManager(this)
        manager.setStreamSlots(listOf(primarySlot(directUrl = "http://stream.m3u8")))

        assertEquals("http://stream.m3u8", manager.activeStreamUrl)
    }

    @Test
    fun `activeStreamUrl returns null when no slots set`() = runTest {
        val manager = makeManager(this)

        assertNull(manager.activeStreamUrl)
    }

    // ── Unresponsive buffering ────────────────────────────────────

    @Test
    fun `long buffering reports unresponsive and starts automatic recovery`() = runTest {
        val manager = makeManager(this)
        manager.setStreamSlots(listOf(primarySlot()))
        every { player.playbackState } returns Player.STATE_BUFFERING

        listenerSlot.captured.onPlaybackStateChanged(Player.STATE_BUFFERING)
        advanceTimeBy(30_000)
        runCurrent()

        assertEquals(true, onStreamUnresponsiveCalled)
        assertEquals(1, onRecoveringAttempts.size)
    }

    // ── maxTotalAttempts ─────────────────────────────────────────

    @Test
    fun `maxTotalAttempts sums max attempts for all slots`() = runTest {
        val manager = makeManager(this)
        // Primary (index 0) with no proxy = 3 direct attempts
        // Alternate (index 1) with no proxy = 1 direct attempt
        manager.setStreamSlots(
            listOf(
                primarySlot(directUrl = "http://primary.m3u8"),
                alternateSlot(directUrl = "http://alt.m3u8")
            )
        )

        assertEquals(4, manager.maxTotalAttempts)
    }

    @Test
    fun `maxTotalAttempts includes proxy slots`() = runTest {
        val manager = makeManager(this)
        // Primary with proxy = 3 direct + 1 proxy = 4
        // Alternate with proxy = 1 direct + 1 proxy = 2
        manager.setStreamSlots(
            listOf(
                primarySlot(proxyUrl = "http://proxy.m3u8"),
                alternateSlot(proxyUrl = "http://alt-proxy.m3u8")
            )
        )

        assertEquals(6, manager.maxTotalAttempts)
    }

    // ── Opposite-container retry (D4) ────────────────────────────

    @Test
    fun `parsing error rebuilds same url with opposite container before failing over`() = runTest {
        val manager = makeManager(this)
        manager.setStreamSlots(
            listOf(primarySlot(directUrl = "http://relay/opaque", mimeType = "application/x-mpegURL")),
        )

        listenerSlot.captured.onPlayerError(parsingError())
        advanceTimeBy(3000)
        runCurrent()

        assertEquals(1, builtSources.size)
        assertEquals("http://relay/opaque", builtSources[0].url)
        // HLS was the routed container, so the retry must force PROGRESSIVE.
        assertEquals(PlaybackContainer.PROGRESSIVE, builtSources[0].container)
        verify { player.setMediaSource(any()) }
        assertEquals(0, onAlternateFallbackUrls.size)
        assertEquals(1, onErrorMessages.size)
    }

    @Test
    fun `parsing error on progressive relay forces hls on retry`() = runTest {
        val manager = makeManager(this)
        manager.setStreamSlots(listOf(primarySlot(directUrl = "http://relay/opaque", mimeType = "video/mp2t")))

        listenerSlot.captured.onPlayerError(parsingError())
        advanceTimeBy(3000)
        runCurrent()

        assertEquals(1, builtSources.size)
        assertEquals(PlaybackContainer.HLS, builtSources[0].container)
    }

    @Test
    fun `opposite container retry happens only once per url and then moves to alternate`() = runTest {
        val manager = makeManager(this)
        manager.setStreamSlots(
            listOf(
                primarySlot(directUrl = "http://relay/primary", mimeType = "application/x-mpegURL"),
                alternateSlot(directUrl = "http://relay/alt", mimeType = "application/x-mpegURL"),
            ),
        )

        // 1st parsing error: opposite-container retry on the same url.
        listenerSlot.captured.onPlayerError(parsingError())
        advanceTimeBy(3000)
        runCurrent()
        assertEquals(1, builtSources.size)

        // 2nd parsing error: no second flip, ladder moves to the next slot.
        listenerSlot.captured.onPlayerError(parsingError())
        advanceTimeBy(3000)
        runCurrent()

        assertEquals(2, builtSources.size)
        assertEquals("http://relay/alt", builtSources[1].url)
        assertNull(builtSources[1].container)
        assertEquals(listOf("http://relay/alt"), onAlternateFallbackUrls)
    }

    @Test
    fun `opposite container retry cannot loop and dead-ends when no fallback remains`() = runTest {
        val manager = makeManager(this)
        manager.setStreamSlots(
            listOf(primarySlot(directUrl = "http://relay/opaque", mimeType = "application/x-mpegURL")),
        )

        listenerSlot.captured.onPlayerError(parsingError())
        advanceTimeBy(3000)
        runCurrent()
        assertEquals(1, builtSources.size)

        listenerSlot.captured.onPlayerError(parsingError())
        runCurrent()

        assertEquals(1, builtSources.size)
        assertEquals(1, onStreamDeadMessages.size)
    }

    // ── Proxy-free recovery ladder (D5) ──────────────────────────

    @Test
    fun `parsing error failover reaches resolver even when proxy url is null`() = runTest {
        val manager = makeManager(this)
        val resolvedSlots = mutableListOf<Int>()
        // Production: ALLOW_DIRECT_PLAYBACK=false means proxyUrl is always null.
        manager.setStreamSlots(listOf(primarySlot(directUrl = "http://relay/primary")))
        manager.setFallbackResolver { slot ->
            resolvedSlots.add(slot)
            alternateSlot(directUrl = "http://relay/alt-$slot")
        }

        listenerSlot.captured.onPlayerError(parsingError())
        advanceTimeBy(3000)
        runCurrent()

        listenerSlot.captured.onPlayerError(parsingError())
        advanceTimeBy(3000)
        runCurrent()

        assertEquals(listOf(1), resolvedSlots)
        assertEquals("http://relay/alt-1", onAlternateFallbackUrls.last())
        assertEquals("http://relay/alt-1", builtSources.last().url)
    }

    // ── Recovery-time source building (D2) ───────────────────────

    @Test
    fun `proxy switch rebuilds source through the injected builder`() = runTest {
        val manager = makeManager(this)
        manager.setStreamSlots(
            listOf(primarySlot(proxyUrl = "http://proxy.m3u8", mimeType = "video/mp2t")),
        )

        // Three direct attempts exhaust the primary direct quota.
        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(3000)
        runCurrent()
        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(5000)
        runCurrent()
        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(7000)
        runCurrent()

        // Fourth error triggers the proxy attempt.
        listenerSlot.captured.onPlayerError(networkError())
        advanceTimeBy(9000)
        runCurrent()

        assert(onProxyFallbackCalled)
        assertEquals("http://proxy.m3u8", builtSources.last().url)
        assertEquals("video/mp2t", builtSources.last().mimeType)
        assertNull(builtSources.last().container)
    }
}
