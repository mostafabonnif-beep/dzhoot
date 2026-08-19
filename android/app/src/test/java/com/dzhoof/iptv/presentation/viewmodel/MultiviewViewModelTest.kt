package com.dzhoof.iptv.presentation.viewmodel

import androidx.media3.exoplayer.ExoPlayer
import com.dzhoof.iptv.MainDispatcherRule
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.model.Channel
import com.dzhoof.iptv.domain.usecase.GetChannelsUseCase
import com.dzhoof.iptv.presentation.ui.player.PlayerFactory
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MultiviewViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val getChannelsUseCase: GetChannelsUseCase = mockk()
    private val playerFactory: PlayerFactory = mockk()

    private val channels = listOf(
        Channel(
            id = "news-1",
            name = "أخبار الجزائر",
            streamUrl = "https://example.test/news.m3u8",
            logoUrl = null,
            category = "أخبار",
            language = "ar",
            country = "DZ"
        ),
        Channel(
            id = "sports-1",
            name = "الرياضة",
            streamUrl = "https://example.test/sports.m3u8",
            logoUrl = null,
            category = "رياضة",
            language = "ar",
            country = "DZ"
        )
    )

    @Test
    fun `loads the full channel list for pane selection`() = runTest {
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(channels))

        val viewModel = MultiviewViewModel(getChannelsUseCase, playerFactory)
        advanceUntilIdle()

        assertEquals(channels, viewModel.channels.value)
        assertEquals(4, MultiviewViewModel.MAX_PANES)
    }

    @Test
    fun `createPlayer delegates to the shared player factory`() = runTest {
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(emptyList()))
        val player = mockk<ExoPlayer>()
        every { playerFactory.create() } returns player
        val viewModel = MultiviewViewModel(getChannelsUseCase, playerFactory)

        assertSame(player, viewModel.createPlayer())
    }

    @Test
    fun `ignores channel loading errors and keeps the empty state`() = runTest {
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Error(Exception("offline")))

        val viewModel = MultiviewViewModel(getChannelsUseCase, playerFactory)
        advanceUntilIdle()

        assertEquals(emptyList<Channel>(), viewModel.channels.value)
    }
}
