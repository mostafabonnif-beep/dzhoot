package com.dzhoof.iptv.presentation.viewmodel

import com.dzhoof.iptv.MainDispatcherRule
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.source.remote.NetworkException
import com.dzhoof.iptv.domain.model.Channel
import com.dzhoof.iptv.domain.model.EpgProgram
import com.dzhoof.iptv.domain.usecase.GetChannelsUseCase
import com.dzhoof.iptv.domain.usecase.GetFavoriteChannelsUseCase
import com.dzhoof.iptv.domain.usecase.GetGuideProgramsUseCase
import com.dzhoof.iptv.presentation.mapper.GuideUiMapper
import com.dzhoof.iptv.presentation.model.ErrorType
import com.dzhoof.iptv.presentation.model.GuideFilter
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class GuideViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val getChannelsUseCase: GetChannelsUseCase = mockk()
    private val getFavoriteChannelsUseCase: GetFavoriteChannelsUseCase = mockk()
    private val getGuideProgramsUseCase: GetGuideProgramsUseCase = mockk()
    private val guideUiMapper = GuideUiMapper()
    private val favoritesFlow = MutableStateFlow<Result<List<Channel>>>(Result.Success(emptyList()))

    private val news = Channel(
        id = "news-1",
        name = "أخبار الجزائر",
        streamUrl = "https://example.test/news.m3u8",
        logoUrl = null,
        category = "أخبار",
        language = "ar",
        country = "DZ",
        tvgId = "tvg-news"
    )

    private val sports = Channel(
        id = "sports-1",
        name = "الرياضة",
        streamUrl = "https://example.test/sports.m3u8",
        logoUrl = null,
        category = "رياضة",
        language = "ar",
        country = "DZ",
        tvgId = "tvg-sports"
    )

    private val newsProgram = EpgProgram(
        channelEpgId = "tvg-news",
        title = "نشرة الصباح",
        description = "آخر الأخبار",
        startTime = Instant.parse("2026-08-15T08:00:00Z"),
        endTime = Instant.parse("2026-08-15T09:00:00Z"),
        icon = null
    )

    private val sportsProgram = EpgProgram(
        channelEpgId = "tvg-sports",
        title = "مباراة مباشرة",
        description = null,
        startTime = Instant.parse("2026-08-15T09:00:00Z"),
        endTime = Instant.parse("2026-08-15T11:00:00Z"),
        icon = null
    )

    @Test
    fun `loads guide rows and hydrates the visible program window`() = runTest {
        stubSuccessfulLoad()
        val viewModel = createViewModel()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isLoading)
        assertEquals(listOf("أخبار", "رياضة"), state.categories)
        assertEquals(listOf("news-1", "sports-1"), state.rows.map { it.channelId })
        assertTrue(state.rows.all { it.isHydrated })
        assertEquals("نشرة الصباح", state.rows.first().programs.single().title)
        assertTrue(state.windowStart.isBefore(state.windowEnd))
        assertFalse(state.timelineUnavailable)
        coVerify {
            getGuideProgramsUseCase(match { params ->
                params.tvgIds.toSet() == setOf("tvg-news", "tvg-sports") &&
                    params.from.isBefore(params.to)
            })
        }
    }

    @Test
    fun `category and favorites filters update the displayed rows`() = runTest {
        stubSuccessfulLoad()
        favoritesFlow.value = Result.Success(listOf(news))
        val viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.selectFilter(GuideFilter.Category("رياضة"))
        advanceUntilIdle()
        assertEquals(GuideFilter.Category("رياضة"), viewModel.uiState.value.selectedFilter)
        assertEquals(listOf("sports-1"), viewModel.uiState.value.rows.map { it.channelId })

        viewModel.selectFilter(GuideFilter.Favorites)
        advanceUntilIdle()
        assertEquals(listOf("news-1"), viewModel.uiState.value.rows.map { it.channelId })
        assertTrue(viewModel.uiState.value.hasFavorites)
    }

    @Test
    fun `favorite updates are reflected while the favorites filter is active`() = runTest {
        stubSuccessfulLoad()
        val viewModel = createViewModel()
        advanceUntilIdle()
        viewModel.selectFilter(GuideFilter.Favorites)
        advanceUntilIdle()
        assertTrue(viewModel.uiState.value.rows.isEmpty())

        favoritesFlow.value = Result.Success(listOf(sports))
        runCurrent()
        advanceUntilIdle()

        assertEquals(listOf("sports-1"), viewModel.uiState.value.rows.map { it.channelId })
    }

    @Test
    fun `network failure exposes a localized network error`() = runTest {
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Error(NetworkException("offline")))
        every { getFavoriteChannelsUseCase(Unit) } returns favoritesFlow

        val viewModel = createViewModel()
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.isLoading)
        assertEquals(ErrorType.NETWORK_ERROR, viewModel.uiState.value.errorType)
        assertEquals("تعذر الاتصال بالخادم — تحقق من عنوان الخادم في الإعدادات", viewModel.uiState.value.error)
    }

    private fun stubSuccessfulLoad() {
        every { getChannelsUseCase(Unit) } returns flowOf(Result.Success(listOf(news, sports)))
        every { getFavoriteChannelsUseCase(Unit) } returns favoritesFlow
        coEvery { getGuideProgramsUseCase(any()) } returns mapOf(
            "tvg-news" to listOf(newsProgram),
            "tvg-sports" to listOf(sportsProgram)
        )
    }

    private fun createViewModel() = GuideViewModel(
        getChannelsUseCase = getChannelsUseCase,
        getFavoriteChannelsUseCase = getFavoriteChannelsUseCase,
        getGuideProgramsUseCase = getGuideProgramsUseCase,
        guideUiMapper = guideUiMapper
    )
}
