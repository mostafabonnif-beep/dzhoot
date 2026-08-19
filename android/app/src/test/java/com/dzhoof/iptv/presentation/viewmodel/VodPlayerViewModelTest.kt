package com.dzhoof.iptv.presentation.viewmodel

import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.dzhoof.iptv.MainDispatcherRule
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.model.PlaybackAuthorization
import com.dzhoof.iptv.domain.repository.CatalogRepository
import com.dzhoof.iptv.domain.repository.PlaybackRepository
import com.dzhoof.iptv.presentation.ui.player.PlayerFactory
import io.mockk.Runs
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class VodPlayerViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val catalogRepository: CatalogRepository = mockk()
    private val playbackRepository: PlaybackRepository = mockk(relaxed = true)
    private val playerFactory: PlayerFactory = mockk()

    private val authorization = PlaybackAuthorization(
        url = "https://example.test/movie.m3u8",
        expiresAt = 1_800_000_000_000L,
    )

    @Test
    fun `start restores saved position and authorizes playback`() = runTest {
        every { playbackRepository.getPlaybackPosition("vod:movie:movie-1") } returns flowOf(Result.Success(42_000L))
        coEvery { catalogRepository.authorizePlayback("movie", "movie-1") } returns Result.Success(authorization)

        val viewModel = createViewModel()
        viewModel.start("movie", "movie-1")
        advanceUntilIdle()

        assertEquals(authorization.url, viewModel.uiState.value.playbackUrl)
        assertEquals(42_000L, viewModel.uiState.value.resumePositionMs)
        assertEquals(false, viewModel.uiState.value.isLoading)
        assertEquals(null, viewModel.uiState.value.error)
        coVerify(exactly = 1) { catalogRepository.authorizePlayback("movie", "movie-1") }
    }

    @Test
    fun `authorization failure is exposed in the player state`() = runTest {
        every { playbackRepository.getPlaybackPosition("vod:series:episode-1") } returns flowOf(Result.Success(null))
        coEvery {
            catalogRepository.authorizePlayback("series", "episode-1")
        } returns Result.Error(IllegalStateException("اشتراك غير صالح"))

        val viewModel = createViewModel()
        viewModel.start("series", "episode-1")
        advanceUntilIdle()

        assertEquals(null, viewModel.uiState.value.playbackUrl)
        assertEquals("اشتراك غير صالح", viewModel.uiState.value.error)
        assertEquals(false, viewModel.uiState.value.isLoading)
    }

    @Test
    fun `restarting the same authorized content does not duplicate the request`() = runTest {
        every { playbackRepository.getPlaybackPosition("vod:movie:movie-1") } returns flowOf(Result.Success(0L))
        coEvery { catalogRepository.authorizePlayback("movie", "movie-1") } returns Result.Success(authorization)

        val viewModel = createViewModel()
        viewModel.start("movie", "movie-1")
        advanceUntilIdle()
        viewModel.start("movie", "movie-1")
        advanceUntilIdle()

        coVerify(exactly = 1) { catalogRepository.authorizePlayback("movie", "movie-1") }
    }

    @Test
    fun `player error refreshes the authorization URL`() = runTest {
        every { playbackRepository.getPlaybackPosition("vod:movie:movie-1") } returns flowOf(Result.Success(0L))
        val refreshedAuthorization = authorization.copy(url = "https://example.test/movie-refresh.m3u8")
        coEvery {
            catalogRepository.authorizePlayback("movie", "movie-1")
        } returnsMany listOf(Result.Success(authorization), Result.Success(refreshedAuthorization))
        val player = mockk<ExoPlayer>(relaxed = true)
        val listenerSlot = slot<Player.Listener>()
        every { playerFactory.create() } returns player
        every { player.addListener(capture(listenerSlot)) } just Runs

        val viewModel = createViewModel()
        viewModel.createPlayer()
        viewModel.start("movie", "movie-1")
        advanceUntilIdle()
        listenerSlot.captured.onPlayerError(mockk(relaxed = true))
        advanceUntilIdle()

        assertEquals(refreshedAuthorization.url, viewModel.uiState.value.playbackUrl)
        coVerify(exactly = 2) { catalogRepository.authorizePlayback("movie", "movie-1") }
    }

    @Test
    fun `saveCurrentProgress persists the current player position`() = runTest {
        every { playbackRepository.getPlaybackPosition("vod:movie:movie-1") } returns flowOf(Result.Success(0L))
        coEvery { catalogRepository.authorizePlayback("movie", "movie-1") } returns Result.Success(authorization)
        val player = mockk<ExoPlayer>(relaxed = true)
        every { player.duration } returns 100_000L
        every { player.currentPosition } returns 12_500L
        every { playerFactory.create() } returns player
        every { player.addListener(any()) } just Runs

        val viewModel = createViewModel()
        assertSame(player, viewModel.createPlayer())
        viewModel.start("movie", "movie-1")
        advanceUntilIdle()
        viewModel.saveCurrentProgress()
        advanceUntilIdle()

        coVerify { playbackRepository.savePlaybackPosition("vod:movie:movie-1", 12_500L, 100_000L) }
    }

    private fun createViewModel() = VodPlayerViewModel(
        catalogRepository = catalogRepository,
        playbackRepository = playbackRepository,
        playerFactory = playerFactory,
    )
}
