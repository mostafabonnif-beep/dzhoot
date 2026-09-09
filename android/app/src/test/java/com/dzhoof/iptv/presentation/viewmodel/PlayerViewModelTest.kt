package com.dzhoof.iptv.presentation.viewmodel

import com.dzhoof.iptv.MainDispatcherRule
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.repository.TrackPreferenceMatcher
import com.dzhoof.iptv.data.source.remote.DzhoofApiService
import com.dzhoof.iptv.data.source.local.dao.ChannelHealthDao
import com.dzhoof.iptv.domain.model.Channel
import com.dzhoof.iptv.domain.model.EpgProgram
import com.dzhoof.iptv.domain.model.PlaybackState
import com.dzhoof.iptv.domain.repository.ChannelPrefsRepository
import com.dzhoof.iptv.domain.repository.ChannelTrackPreferencesRepository
import com.dzhoof.iptv.domain.repository.EpgRepository
import com.dzhoof.iptv.domain.repository.PlayerKeyAction
import com.dzhoof.iptv.domain.repository.UserPreferencesRepository
import com.dzhoof.iptv.domain.service.AnalyticsHelper
import com.dzhoof.iptv.domain.service.ChannelThumbnailExtractor
import com.dzhoof.iptv.domain.usecase.GetChannelByIdUseCase
import com.dzhoof.iptv.domain.usecase.GetChannelsByCategoryUseCase
import com.dzhoof.iptv.domain.usecase.GetChannelsUseCase
import com.dzhoof.iptv.domain.usecase.GetGuideProgramsUseCase
import com.dzhoof.iptv.domain.usecase.GetPlaybackPositionUseCase
import com.dzhoof.iptv.domain.usecase.ReportStreamPlayUseCase
import com.dzhoof.iptv.domain.usecase.ReportPlaybackQoeUseCase
import com.dzhoof.iptv.domain.usecase.ReportStreamStatusUseCase
import com.dzhoof.iptv.domain.usecase.SavePlaybackPositionUseCase
import com.dzhoof.iptv.domain.usecase.ToggleFavoriteUseCase
import com.dzhoof.iptv.presentation.mapper.ChannelUiMapper
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class PlayerViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val getChannelByIdUseCase: GetChannelByIdUseCase = mockk()
    private val getChannelsUseCase: GetChannelsUseCase = mockk()
    private val getChannelsByCategoryUseCase: GetChannelsByCategoryUseCase = mockk()
    private val savePlaybackPositionUseCase: SavePlaybackPositionUseCase = mockk()
    private val getPlaybackPositionUseCase: GetPlaybackPositionUseCase = mockk()
    private val toggleFavoriteUseCase: ToggleFavoriteUseCase = mockk()
    private val reportStreamStatusUseCase: ReportStreamStatusUseCase = mockk()
    private val reportStreamPlayUseCase: ReportStreamPlayUseCase = mockk()
    private val reportPlaybackQoeUseCase: ReportPlaybackQoeUseCase = mockk()
    private val channelUiMapper = ChannelUiMapper()
    private val channelHealthDao: ChannelHealthDao = mockk(relaxed = true)
    private val thumbnailExtractor: ChannelThumbnailExtractor = mockk(relaxed = true)
    private val epgRepository: EpgRepository = mockk(relaxed = true)
    private val getGuideProgramsUseCase: GetGuideProgramsUseCase = mockk()
    private val playerFactory: com.dzhoof.iptv.presentation.ui.player.PlayerFactory = mockk(relaxed = true)
    private val apiService: DzhoofApiService = mockk(relaxed = true)
    private val analyticsHelper: AnalyticsHelper = mockk(relaxed = true)
    private val userPreferencesRepository: UserPreferencesRepository = mockk {
        every { getBackExitProtection() } returns flowOf(true)
        every { getPlayerKeyUpDownAction() } returns flowOf(PlayerKeyAction.ZAP)
        every { getPlayerKeyLeftRightAction() } returns flowOf(PlayerKeyAction.ZAP)
        every { getPlayerLongOkAction() } returns flowOf(PlayerKeyAction.FAVORITE)
        every { getSleepTimerDefaultMinutes() } returns flowOf(0)
        every { getAlwaysShowProgramBar() } returns flowOf(false)
        every { getInfoBarTimeoutSeconds() } returns flowOf(4)
    }
    private val channelTrackPreferencesRepository: ChannelTrackPreferencesRepository = mockk()
    private val channelPrefsRepository: ChannelPrefsRepository = mockk()

    private lateinit var viewModel: PlayerViewModel

    private fun createChannel(
        id: String = "ch1",
        name: String = "Test Channel",
        category: String = "News",
        isFavorite: Boolean = false,
        tvgId: String? = null
    ) = Channel(
        id = id, name = name, streamUrl = "http://stream/$id",
        logoUrl = "http://logo/$id", category = category,
        language = "en", country = "US", tvgId = tvgId, isFavorite = isFavorite
    )

    @Before
    fun setup() {
        coEvery { savePlaybackPositionUseCase(any()) } returns Result.Success(Unit)
        coEvery { reportStreamStatusUseCase(any()) } returns Result.Success(Unit)
        coEvery { reportStreamPlayUseCase(any()) } returns Result.Success(Unit)
        coEvery { reportPlaybackQoeUseCase(any()) } returns Result.Success(Unit)
        every { getPlaybackPositionUseCase(any()) } returns flowOf(Result.Success(null))
        every { channelHealthDao.getAllHealth() } returns flowOf(emptyList())
        coEvery { epgRepository.getNowNext(any()) } returns Pair(null, null)
        every { epgRepository.getNowNextIfCached(any()) } returns null
        coEvery { getGuideProgramsUseCase(any()) } returns emptyMap()
        coEvery { channelTrackPreferencesRepository.getAudioLanguage(any()) } returns flowOf(null)
        coEvery { channelTrackPreferencesRepository.getSubtitleLanguage(any()) } returns flowOf(null)
        coEvery { channelTrackPreferencesRepository.getSubtitlesDisabled(any()) } returns flowOf(false)
        every { channelPrefsRepository.observeHiddenIds() } returns flowOf(emptySet())
        every { channelPrefsRepository.observeLockedIds() } returns flowOf(emptySet())

        viewModel = PlayerViewModel(
            getChannelByIdUseCase, getChannelsUseCase, getChannelsByCategoryUseCase,
            savePlaybackPositionUseCase, getPlaybackPositionUseCase, toggleFavoriteUseCase,
            reportStreamStatusUseCase, reportStreamPlayUseCase, reportPlaybackQoeUseCase, channelUiMapper,
            channelHealthDao, thumbnailExtractor, epgRepository, getGuideProgramsUseCase,
            analyticsHelper, userPreferencesRepository, playerFactory, apiService,
            channelTrackPreferencesRepository,
            channelPrefsRepository
        )
    }

    // ── Channel Loading ──────────────────────────────────────────

    @Test
    fun `loadChannel sets channel in state on success`() = runTest {
        val channel = createChannel()
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(channel))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(listOf(channel)))

        viewModel.loadChannel("ch1")
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals("ch1", state.channel?.id)
        assertEquals("Test Channel", state.channel?.name)
        assertFalse(state.isLoading)
        assertNull(state.error)
    }

    @Test
    fun `loadChannel sets error on failure`() = runTest {
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Error(Exception("Not found")))

        viewModel.loadChannel("ch1")
        advanceUntilIdle()

        assertEquals("Not found", viewModel.uiState.value.error)
        assertFalse(viewModel.uiState.value.isLoading)
    }

    @Test
    fun `loadChannel restores playback position`() = runTest {
        val channel = createChannel()
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(channel))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(listOf(channel)))
        every { getPlaybackPositionUseCase("ch1") } returns flowOf(
            Result.Success(PlaybackState(channelId = "ch1", position = 5000L, duration = 30000L, isPlaying = false))
        )

        viewModel.loadChannel("ch1")
        advanceUntilIdle()

        assertEquals(5000L, viewModel.uiState.value.position)
        assertEquals(30000L, viewModel.uiState.value.duration)
    }

    // ── Playback State ───────────────────────────────────────────

    @Test
    fun `updatePlaybackState updates state`() = runTest {
        // isPlaying=true triggers an infinite while(true) save loop,
        // so use isPlaying=false to test state update without hanging
        viewModel.updatePlaybackState(isPlaying = false, position = 1000L, duration = 5000L)
        runCurrent()

        val state = viewModel.uiState.value
        assertFalse(state.isPlaying)
        assertEquals(1000L, state.position)
        assertEquals(5000L, state.duration)
    }

    @Test
    fun `updateBufferingState updates buffering flag`() = runTest {
        viewModel.updateBufferingState(true)
        assertTrue(viewModel.uiState.value.isBuffering)

        viewModel.updateBufferingState(false)
        assertFalse(viewModel.uiState.value.isBuffering)
    }

    // ── Favorites ────────────────────────────────────────────────

    @Test
    fun `toggleFavorite optimistically toggles and calls use case`() = runTest {
        val channel = createChannel(isFavorite = false)
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(channel))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(listOf(channel)))
        coEvery { toggleFavoriteUseCase("ch1") } returns Result.Success(Unit)

        viewModel.loadChannel("ch1")
        advanceUntilIdle()
        assertFalse(viewModel.uiState.value.channel!!.isFavorite)

        viewModel.toggleFavorite()
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.channel!!.isFavorite)
        coVerify { toggleFavoriteUseCase("ch1") }
    }

    @Test
    fun `toggleFavorite reverts on error`() = runTest {
        val channel = createChannel(isFavorite = false)
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(channel))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(listOf(channel)))
        coEvery { toggleFavoriteUseCase("ch1") } returns Result.Error(Exception("fail"))

        viewModel.loadChannel("ch1")
        advanceUntilIdle()

        viewModel.toggleFavorite()
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.channel!!.isFavorite)
    }

    // ── Channel Overlay ──────────────────────────────────────────

    @Test
    fun `showOverlay sets overlay visible`() = runTest {
        val channel = createChannel()
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(channel))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(listOf(channel)))
        every { getChannelsByCategoryUseCase("News") } returns flowOf(Result.Success(listOf(channel)))

        viewModel.loadChannel("ch1")
        advanceUntilIdle()

        viewModel.showOverlay()
        // Don't use advanceUntilIdle — resetAutoHideTimer has a 7s delay
        runCurrent()

        assertTrue(viewModel.uiState.value.showChannelOverlay)
    }

    @Test
    fun `hideOverlay hides overlay`() = runTest {
        viewModel.hideOverlay()
        assertFalse(viewModel.uiState.value.showChannelOverlay)
    }

    @Test
    fun `loadChannelList loads channels by category`() = runTest {
        val channels = listOf(createChannel("ch1", category = "Sports"), createChannel("ch2", category = "Sports"))
        every { getChannelsByCategoryUseCase("Sports") } returns flowOf(Result.Success(channels))

        viewModel.loadChannelList("Sports")
        advanceUntilIdle()

        assertEquals(2, viewModel.uiState.value.overlayChannels.size)
        assertEquals("Sports", viewModel.uiState.value.overlaySelectedCategory)
    }

    @Test
    fun `loadChannelList loads all channels when no category`() = runTest {
        val channels = listOf(createChannel("ch1"), createChannel("ch2"))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(channels))

        viewModel.loadChannelList(null)
        advanceUntilIdle()

        assertEquals(2, viewModel.uiState.value.overlayChannels.size)
        assertNull(viewModel.uiState.value.overlaySelectedCategory)
    }

    // ── Next / Previous Channel ──────────────────────────────────

    @Test
    fun `nextChannel switches to next channel`() = runTest {
        val channels = listOf(createChannel("ch1"), createChannel("ch2"), createChannel("ch3"))
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(channels[0]))
        every { getChannelByIdUseCase("ch2") } returns flowOf(Result.Success(channels[1]))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(channels))

        viewModel.loadChannel("ch1")
        advanceUntilIdle()
        viewModel.loadChannelList(null)
        advanceUntilIdle()

        viewModel.nextChannel()
        advanceUntilIdle()

        assertEquals("ch2", viewModel.uiState.value.channel?.id)
    }

    @Test
    fun `nextChannel skips hidden channels`() = runTest {
        val channels = listOf(createChannel("ch1"), createChannel("ch2"), createChannel("ch3"))
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(channels[0]))
        every { getChannelByIdUseCase("ch3") } returns flowOf(Result.Success(channels[2]))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(channels))
        every { channelPrefsRepository.observeHiddenIds() } returns flowOf(setOf("ch2"))

        viewModel.loadChannel("ch1")
        advanceUntilIdle()
        viewModel.loadChannelList(null)
        advanceUntilIdle()

        viewModel.nextChannel()
        advanceUntilIdle()

        assertEquals("ch3", viewModel.uiState.value.channel?.id)
    }

    @Test
    fun `previousChannel skips hidden channels going backwards`() = runTest {
        val channels = listOf(createChannel("ch1"), createChannel("ch2"), createChannel("ch3"))
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(channels[0]))
        every { getChannelByIdUseCase("ch3") } returns flowOf(Result.Success(channels[2]))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(channels))
        every { channelPrefsRepository.observeHiddenIds() } returns flowOf(setOf("ch2"))

        viewModel.loadChannel("ch3")
        advanceUntilIdle()
        viewModel.loadChannelList(null)
        advanceUntilIdle()

        viewModel.previousChannel()
        advanceUntilIdle()

        assertEquals("ch1", viewModel.uiState.value.channel?.id)
    }

    @Test
    fun `lockedChannelIds reflects repository locked set`() = runTest {
        every { channelPrefsRepository.observeLockedIds() } returns flowOf(setOf("ch1", "ch9"))
        advanceUntilIdle()
        assertEquals(setOf("ch1", "ch9"), viewModel.lockedChannelIds.value)
    }

    @Test
    fun `previousChannel goes to last when at first`() = runTest {
        val channels = listOf(createChannel("ch1"), createChannel("ch2"), createChannel("ch3"))
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(channels[0]))
        every { getChannelByIdUseCase("ch3") } returns flowOf(Result.Success(channels[2]))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(channels))

        viewModel.loadChannel("ch1")
        advanceUntilIdle()
        viewModel.loadChannelList(null)
        advanceUntilIdle()

        viewModel.previousChannel()
        advanceUntilIdle()

        assertEquals("ch3", viewModel.uiState.value.channel?.id)
    }

    // ── Switch Channel ───────────────────────────────────────────

    @Test
    fun `switchChannel to same channel just hides overlay`() = runTest {
        val channel = createChannel()
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(channel))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(listOf(channel)))

        viewModel.loadChannel("ch1")
        advanceUntilIdle()

        viewModel.switchChannel("ch1")
        runCurrent()

        assertFalse(viewModel.uiState.value.showChannelOverlay)
        assertEquals("ch1", viewModel.uiState.value.channel?.id)
    }

    @Test
    fun `switchChannel to different channel loads new channel`() = runTest {
        val ch1 = createChannel("ch1")
        val ch2 = createChannel("ch2", name = "Channel 2")
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(ch1))
        every { getChannelByIdUseCase("ch2") } returns flowOf(Result.Success(ch2))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(listOf(ch1, ch2)))

        viewModel.loadChannel("ch1")
        advanceUntilIdle()

        viewModel.switchChannel("ch2")
        advanceUntilIdle()

        assertEquals("ch2", viewModel.uiState.value.channel?.id)
        assertFalse(viewModel.uiState.value.showChannelOverlay)
    }

    // ── Stream Recovery ──────────────────────────────────────────

    @Test
    fun `onPlaybackError sets error state`() = runTest {
        viewModel.onPlaybackError("Stream failed")

        assertEquals("Stream failed", viewModel.uiState.value.error)
        assertFalse(viewModel.uiState.value.isPlaying)
    }

    @Test
    fun `clearError clears error`() = runTest {
        viewModel.onPlaybackError("err")
        viewModel.clearError()
        assertNull(viewModel.uiState.value.error)
    }

    @Test
    fun `onRecovering sets recovery state`() = runTest {
        viewModel.onRecovering(2)

        val state = viewModel.uiState.value
        assertTrue(state.isRecovering)
        assertEquals(2, state.recoveryAttempt)
        assertNull(state.error)
        assertFalse(state.isStreamDead)
    }

    @Test
    fun `onRecovered clears recovery state`() = runTest {
        viewModel.onRecovering(1)
        viewModel.onRecovered()

        val state = viewModel.uiState.value
        assertFalse(state.isRecovering)
        assertEquals(0, state.recoveryAttempt)
        assertFalse(state.isStreamDead)
        assertEquals(0, state.deadStreamCountdown)
    }

    @Test
    fun `onProxyFallback sets proxy flag`() = runTest {
        viewModel.onProxyFallback()
        assertTrue(viewModel.uiState.value.isUsingProxy)
    }

    @Test
    fun `onAlternateFallback sets stream URL and clears proxy`() = runTest {
        viewModel.onProxyFallback()
        viewModel.onAlternateFallback("http://alt.stream")

        val state = viewModel.uiState.value
        assertEquals("http://alt.stream", state.activeStreamUrl)
        assertFalse(state.isUsingProxy)
    }

    @Test
    fun `onStreamDead sets dead state and reports status`() = runTest {
        val channel = createChannel()
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(channel))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(listOf(channel)))

        viewModel.loadChannel("ch1")
        advanceUntilIdle()

        viewModel.onStreamDead("Connection refused")
        // Use runCurrent instead of advanceUntilIdle to avoid countdown loop
        runCurrent()

        val state = viewModel.uiState.value
        assertTrue(state.isStreamDead)
        assertFalse(state.isRecovering)
        assertFalse(state.isPlaying)
        assertEquals("البث غير متاح", state.deadStreamTitle)
        coVerify { reportStreamStatusUseCase(any()) }
    }

    @Test
    fun `cancelDeadStreamCountdown stops countdown`() = runTest {
        viewModel.cancelDeadStreamCountdown()

        val state = viewModel.uiState.value
        assertEquals(0, state.deadStreamCountdown)
        assertFalse(state.shouldNavigateBack)
    }

    @Test
    fun `onNavigatedBack clears flag`() = runTest {
        viewModel.onNavigatedBack()
        assertFalse(viewModel.uiState.value.shouldNavigateBack)
    }

    // ── Overlay Favorite Toggle ──────────────────────────────────

    @Test
    fun `toggleOverlayFavorite toggles channel in overlay list`() = runTest {
        val channels = listOf(createChannel("ch1", isFavorite = false))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(channels))
        coEvery { toggleFavoriteUseCase("ch1") } returns Result.Success(Unit)

        viewModel.loadChannelList(null)
        advanceUntilIdle()

        viewModel.toggleOverlayFavorite("ch1")
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.overlayChannels[0].isFavorite)
    }

    @Test
    fun `toggleOverlayFavorite reverts on error`() = runTest {
        val channels = listOf(createChannel("ch1", isFavorite = false))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(channels))
        coEvery { toggleFavoriteUseCase("ch1") } returns Result.Error(Exception("fail"))

        viewModel.loadChannelList(null)
        advanceUntilIdle()

        viewModel.toggleOverlayFavorite("ch1")
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.overlayChannels[0].isFavorite)
    }

    // ── Sleep Timer ──────────────────────────────────────────────

    @Test
    fun `setSleepTimer starts countdown and expires into still watching flow`() = runTest {
        viewModel.setSleepTimer(1)
        runCurrent()

        assertEquals(1, viewModel.uiState.value.sleepTimerMinutes)
        assertEquals(60, viewModel.uiState.value.sleepTimerRemainingSeconds)

        // Final minute ticks every second
        advanceTimeBy(30_000)
        runCurrent()
        assertEquals(30, viewModel.uiState.value.sleepTimerRemainingSeconds)

        advanceTimeBy(31_000)
        runCurrent()
        assertTrue(viewModel.uiState.value.sleepTimerExpired)
        assertFalse(viewModel.uiState.value.sleepTimerNavigateBack)

        // Cancel window lapses → navigate back
        advanceTimeBy(61_000)
        runCurrent()
        assertTrue(viewModel.uiState.value.sleepTimerNavigateBack)
    }

    @Test
    fun `setSleepTimer null cancels timer`() = runTest {
        viewModel.setSleepTimer(30)
        runCurrent()
        assertEquals(30, viewModel.uiState.value.sleepTimerMinutes)

        viewModel.setSleepTimer(null)
        runCurrent()

        assertNull(viewModel.uiState.value.sleepTimerMinutes)
        assertNull(viewModel.uiState.value.sleepTimerRemainingSeconds)
    }

    @Test
    fun `cancelSleepTimerExpiry clears expiry within cancel window`() = runTest {
        viewModel.setSleepTimer(1)
        advanceTimeBy(61_000)
        runCurrent()
        assertTrue(viewModel.uiState.value.sleepTimerExpired)

        viewModel.cancelSleepTimerExpiry()
        runCurrent()

        val state = viewModel.uiState.value
        assertFalse(state.sleepTimerExpired)
        assertNull(state.sleepTimerMinutes)
        assertFalse(state.sleepTimerNavigateBack)

        // Cancelled window must not fire navigate-back later
        advanceTimeBy(61_000)
        runCurrent()
        assertFalse(viewModel.uiState.value.sleepTimerNavigateBack)
    }

    @Test
    fun `onSleepTimerNavigatedBack clears flag`() = runTest {
        viewModel.onSleepTimerNavigatedBack()
        assertFalse(viewModel.uiState.value.sleepTimerNavigateBack)
    }

    // ── Recent Channels (recall stack) ───────────────────────────

    private fun stubChannels(vararg ids: String) {
        val channels = ids.map { createChannel(it, name = "Channel $it") }
        channels.forEach { ch ->
            every { getChannelByIdUseCase(ch.id) } returns flowOf(Result.Success(ch))
        }
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(channels))
    }

    @Test
    fun `recents stack keeps most recent first capped at three`() = runTest {
        stubChannels("ch1", "ch2", "ch3", "ch4", "ch5")
        viewModel.loadChannel("ch1")
        advanceUntilIdle()

        listOf("ch2", "ch3", "ch4", "ch5").forEach {
            viewModel.switchChannel(it)
            advanceUntilIdle()
        }

        // Watched 1→2→3→4→5: recents = [4, 3, 2], capped at 3, current excluded
        assertEquals(listOf("ch4", "ch3", "ch2"), viewModel.uiState.value.recentChannels.map { it.id })
        assertEquals("ch4", viewModel.uiState.value.lastChannel?.id)
    }

    @Test
    fun `recents never contain the switch target and dedupe revisits`() = runTest {
        stubChannels("ch1", "ch2", "ch3")
        viewModel.loadChannel("ch1")
        advanceUntilIdle()

        viewModel.switchChannel("ch2")
        advanceUntilIdle()
        viewModel.switchChannel("ch1") // back to a channel already in recents
        advanceUntilIdle()

        assertEquals(listOf("ch2"), viewModel.uiState.value.recentChannels.map { it.id })
    }

    @Test
    fun `recallLastChannel flips back to previous channel`() = runTest {
        stubChannels("ch1", "ch2")
        viewModel.loadChannel("ch1")
        advanceUntilIdle()
        viewModel.switchChannel("ch2")
        advanceUntilIdle()

        viewModel.recallLastChannel()
        advanceUntilIdle()

        assertEquals("ch1", viewModel.uiState.value.channel?.id)
        assertEquals("ch2", viewModel.uiState.value.lastChannel?.id)
    }

    // ── Program Boundary Watcher ─────────────────────────────────

    private fun program(title: String, startsInSec: Long, endsInSec: Long) = EpgProgram(
        channelEpgId = "epg1",
        title = title,
        description = null,
        startTime = Instant.now().plusSeconds(startsInSec),
        endTime = Instant.now().plusSeconds(endsInSec),
        icon = null
    )

    @Test
    fun `program boundary refetches now-next and bumps token`() = runTest {
        val progA = program("Program A", -600, 600)
        val progB = program("Program B", 600, 1200)
        val channel = createChannel(tvgId = "epg1")
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(channel))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(listOf(channel)))
        coEvery { epgRepository.getNowNext("epg1") } returnsMany listOf(
            Pair(progA, progB), // initial fetch
            Pair(progB, null)   // refetch at the boundary
        )

        viewModel.loadChannel("ch1")
        runCurrent()
        assertEquals("Program A", viewModel.uiState.value.nowPlaying?.title)
        assertEquals(0, viewModel.uiState.value.programChangedToken)

        // Cross progA's end (+2s grace)
        advanceTimeBy(603_000)
        runCurrent()

        assertEquals("Program B", viewModel.uiState.value.nowPlaying?.title)
        assertEquals(1, viewModel.uiState.value.programChangedToken)
    }

    @Test
    fun `boundary does not fire after switching channels`() = runTest {
        val progA = program("Program A", -600, 600)
        val ch1 = createChannel("ch1", tvgId = "epg1")
        val ch2 = createChannel("ch2")
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(ch1))
        every { getChannelByIdUseCase("ch2") } returns flowOf(Result.Success(ch2))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(listOf(ch1, ch2)))
        coEvery { epgRepository.getNowNext("epg1") } returns Pair(progA, null)

        viewModel.loadChannel("ch1")
        runCurrent()
        viewModel.switchChannel("ch2")
        runCurrent()

        advanceTimeBy(700_000)
        runCurrent()

        assertEquals(0, viewModel.uiState.value.programChangedToken)
    }

    // ── Dead Stream Countdown ────────────────────────────────────

    @Test
    fun `dead stream countdown triggers navigate back after timeout`() = runTest {
        val channel = createChannel()
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(channel))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(listOf(channel)))

        viewModel.loadChannel("ch1")
        advanceUntilIdle()

        viewModel.onStreamDead("error")
        // Advance past the 5-second countdown (5 x 1000ms ticks)
        advanceTimeBy(6000)
        runCurrent()

        assertTrue(viewModel.uiState.value.shouldNavigateBack)
    }

    // ── Per-Channel Track Preferences (audio/subtitle auto-apply) ─

    private fun stubLoadedChannel(channel: Channel) {
        every { getChannelByIdUseCase(channel.id) } returns flowOf(Result.Success(channel))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(listOf(channel)))
    }

    private fun snapshotWith(
        audioLanguages: List<String?> = emptyList(),
        textLanguages: List<String?> = emptyList()
    ) = TrackPreferenceMatcher.TrackSelectionSnapshot(
        audioTracks = audioLanguages.mapIndexed { index, language ->
            TrackPreferenceMatcher.AudioTrackLike(groupIndex = 0, trackIndex = index, language = language)
        },
        textTracks = textLanguages.mapIndexed { index, language ->
            TrackPreferenceMatcher.TextTrackLike(groupIndex = 0, trackIndex = index, language = language)
        }
    )

    @Test
    fun `currentMediaKey encodes channel id and stream slots`() = runTest {
        val channel = createChannel("ch1")
        stubLoadedChannel(channel)
        viewModel.loadChannel("ch1")
        advanceUntilIdle()

        assertEquals("ch1|http://stream/ch1|", viewModel.currentMediaKey())
        assertEquals("ch1", viewModel.currentChannelId())
    }

    @Test
    fun `saveAudioTrackPreference persists via repository`() = runTest {
        val channel = createChannel("ch1")
        stubLoadedChannel(channel)
        viewModel.loadChannel("ch1")
        advanceUntilIdle()

        viewModel.saveAudioTrackPreference("ch1", "fr")
        advanceUntilIdle()
        coVerify { channelTrackPreferencesRepository.setAudioLanguage("ch1", "fr") }

        // null clears the stored choice
        viewModel.saveAudioTrackPreference("ch1", null)
        advanceUntilIdle()
        coVerify { channelTrackPreferencesRepository.setAudioLanguage("ch1", null) }
    }

    @Test
    fun `saveSubtitleTrackPreference and saveSubtitlesDisabled persist via repository`() = runTest {
        val channel = createChannel("ch1")
        stubLoadedChannel(channel)
        viewModel.loadChannel("ch1")
        advanceUntilIdle()

        viewModel.saveSubtitleTrackPreference("ch1", "ar")
        viewModel.saveSubtitlesDisabled("ch1", true)
        advanceUntilIdle()
        coVerify { channelTrackPreferencesRepository.setSubtitleLanguage("ch1", "ar") }
        coVerify { channelTrackPreferencesRepository.setSubtitlesDisabled("ch1", true) }
    }

    @Test
    fun `onTrackGroupsAvailable emits matching decision from stored prefs`() = runTest {
        val channel = createChannel("ch1")
        stubLoadedChannel(channel)
        coEvery { channelTrackPreferencesRepository.getAudioLanguage("ch1") } returns flowOf("ar")
        coEvery { channelTrackPreferencesRepository.getSubtitleLanguage("ch1") } returns flowOf("fr")

        viewModel.loadChannel("ch1")
        advanceUntilIdle()
        val key = viewModel.currentMediaKey()!!

        viewModel.onTrackGroupsAvailable(
            key,
            snapshotWith(audioLanguages = listOf("ar", "en"), textLanguages = listOf("fr", "ar"))
        )
        advanceUntilIdle()

        val request = viewModel.pendingTrackDecision.value
        assertNotNull(request)
        assertEquals(key, request?.mediaKey)
        assertEquals(TrackPreferenceMatcher.TrackRef(0, 0), request?.decision?.selectAudio)
        assertEquals(TrackPreferenceMatcher.TrackRef(0, 0), request?.decision?.selectSubtitle)
        assertFalse(request?.decision?.subtitlesDisabled ?: true)
        assertTrue(key in viewModel.appliedTrackPrefsForMediaKey)
    }

    @Test
    fun `auto-apply runs once per media key`() = runTest {
        val channel = createChannel("ch1")
        stubLoadedChannel(channel)
        coEvery { channelTrackPreferencesRepository.getAudioLanguage("ch1") } returns flowOf("ar")

        viewModel.loadChannel("ch1")
        advanceUntilIdle()
        val key = viewModel.currentMediaKey()!!

        viewModel.onTrackGroupsAvailable(key, snapshotWith(audioLanguages = listOf("ar", "en")))
        advanceUntilIdle()
        assertNotNull(viewModel.pendingTrackDecision.value)

        viewModel.onTrackDecisionApplied(key)
        assertNull(viewModel.pendingTrackDecision.value)

        // Same media key again: already auto-applied → no second decision.
        viewModel.onTrackGroupsAvailable(key, snapshotWith(audioLanguages = listOf("ar", "en")))
        advanceUntilIdle()
        assertNull(viewModel.pendingTrackDecision.value)
        coVerify(exactly = 1) { channelTrackPreferencesRepository.getAudioLanguage("ch1") }
    }

    @Test
    fun `manual selection beats queued auto-apply`() = runTest {
        val channel = createChannel("ch1")
        stubLoadedChannel(channel)
        coEvery { channelTrackPreferencesRepository.getAudioLanguage("ch1") } returns flowOf("ar")

        viewModel.loadChannel("ch1")
        advanceUntilIdle()
        val key = viewModel.currentMediaKey()!!

        // Auto-apply launched (async pref read), then the user picks a track
        // before the coroutine resumes.
        viewModel.onTrackGroupsAvailable(key, snapshotWith(audioLanguages = listOf("ar", "en")))
        viewModel.markCurrentItemManuallySet()
        advanceUntilIdle()

        assertNull(viewModel.pendingTrackDecision.value)
        assertFalse(key in viewModel.appliedTrackPrefsForMediaKey)
        coVerify(exactly = 0) { channelTrackPreferencesRepository.getAudioLanguage("ch1") }
    }

    @Test
    fun `markTracksApplied suppresses later auto-apply for the item`() = runTest {
        val channel = createChannel("ch1")
        stubLoadedChannel(channel)
        coEvery { channelTrackPreferencesRepository.getAudioLanguage("ch1") } returns flowOf("ar")

        viewModel.loadChannel("ch1")
        advanceUntilIdle()
        val key = viewModel.currentMediaKey()!!

        viewModel.markTracksApplied(key)
        viewModel.onTrackGroupsAvailable(key, snapshotWith(audioLanguages = listOf("ar")))
        advanceUntilIdle()

        assertNull(viewModel.pendingTrackDecision.value)
    }

    @Test
    fun `no stored prefs still publishes default decision for the item`() = runTest {
        val channel = createChannel("ch1")
        stubLoadedChannel(channel)
        // Repository defaults: no audio/subtitle language, subtitles enabled.

        viewModel.loadChannel("ch1")
        advanceUntilIdle()
        val key = viewModel.currentMediaKey()!!

        viewModel.onTrackGroupsAvailable(key, snapshotWith(audioLanguages = listOf("ar"), textLanguages = listOf("ar")))
        advanceUntilIdle()

        val request = viewModel.pendingTrackDecision.value
        assertNotNull(request)
        assertNull(request?.decision?.selectAudio)
        assertNull(request?.decision?.selectSubtitle)
        assertFalse(request?.decision?.subtitlesDisabled ?: true)
    }

    @Test
    fun `switching channel resets auto-apply bookkeeping`() = runTest {
        val ch1 = createChannel("ch1")
        val ch2 = createChannel("ch2")
        every { getChannelByIdUseCase("ch1") } returns flowOf(Result.Success(ch1))
        every { getChannelByIdUseCase("ch2") } returns flowOf(Result.Success(ch2))
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(listOf(ch1, ch2)))
        coEvery { channelTrackPreferencesRepository.getAudioLanguage("ch1") } returns flowOf("ar")

        viewModel.loadChannel("ch1")
        advanceUntilIdle()
        val key1 = viewModel.currentMediaKey()!!
        viewModel.onTrackGroupsAvailable(key1, snapshotWith(audioLanguages = listOf("ar")))
        advanceUntilIdle()
        assertNotNull(viewModel.pendingTrackDecision.value)
        assertTrue(key1 in viewModel.appliedTrackPrefsForMediaKey)

        viewModel.onTrackDecisionApplied(key1)
        viewModel.switchChannel("ch2")
        advanceUntilIdle()

        // Bookkeeping cleared for the previous item; ch2 auto-apply is free to run.
        assertFalse(key1 in viewModel.appliedTrackPrefsForMediaKey)
        val key2 = viewModel.currentMediaKey()!!
        assertNotEquals(key1, key2)
        viewModel.onTrackGroupsAvailable(key2, snapshotWith(audioLanguages = listOf("ar")))
        advanceUntilIdle()
        val request = viewModel.pendingTrackDecision.value
        assertNotNull(request)
        assertEquals(key2, request?.mediaKey)
    }
}
