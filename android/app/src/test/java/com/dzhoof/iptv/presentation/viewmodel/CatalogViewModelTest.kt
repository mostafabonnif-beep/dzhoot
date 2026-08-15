package com.dzhoof.iptv.presentation.viewmodel

import com.dzhoof.iptv.MainDispatcherRule
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.model.CatalogPage
import com.dzhoof.iptv.domain.model.Episode
import com.dzhoof.iptv.domain.model.Movie
import com.dzhoof.iptv.domain.model.PlaybackAuthorization
import com.dzhoof.iptv.domain.model.Season
import com.dzhoof.iptv.domain.model.Series
import com.dzhoof.iptv.domain.model.UnifiedSearchResults
import com.dzhoof.iptv.domain.repository.CatalogRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CatalogViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val movie = Movie("movie-1", "Movie One", "Drama", null, null, "Plot", 2026, 100, 8.0)
    private val series = Series("series-1", "Series One", "Drama", null, null, "Plot", null, null, null, null, 8.1)
    private val season = Season("season-1", "series-1", 1, "Season 1", null)
    private val episode = Episode("episode-1", "series-1", "season-1", 1, "Episode One", null, null, 42)

    @Test
    fun `loads movies on startup and appends next page`() = runTest {
        val repository = FakeCatalogRepository(
            movies = listOf(movie),
            moviePage = CatalogPage(listOf(movie), totalCount = 2, page = 1, limit = 30),
        )
        val viewModel = CatalogViewModel(repository)
        advanceUntilIdle()

        assertEquals(listOf(movie), viewModel.uiState.value.movies)
        viewModel.loadMore()
        advanceUntilIdle()
        assertEquals(2, viewModel.uiState.value.movies.size)
    }

    @Test
    fun `loads seasons and episodes when a series is selected`() = runTest {
        val repository = FakeCatalogRepository(series = listOf(series), seasons = listOf(season), episodes = listOf(episode))
        val viewModel = CatalogViewModel(repository)
        viewModel.selectTab(CatalogTab.SERIES)
        advanceUntilIdle()
        viewModel.selectSeries(series)
        advanceUntilIdle()
        assertEquals(listOf(season), viewModel.uiState.value.seasons)
        viewModel.selectSeason(season)
        advanceUntilIdle()
        assertEquals(listOf(episode), viewModel.uiState.value.episodes)
    }

    @Test
    fun `loads series details by id for direct search navigation`() = runTest {
        val repository = FakeCatalogRepository(series = listOf(series), seasons = listOf(season))
        val viewModel = CatalogViewModel(repository)
        viewModel.selectSeriesById(series.id)
        advanceUntilIdle()

        assertEquals(series, viewModel.uiState.value.selectedSeries)
        assertEquals(listOf(season), viewModel.uiState.value.seasons)
    }

    @Test
    fun `authorizes VOD playback through repository`() = runTest {
        val repository = FakeCatalogRepository(authorization = PlaybackAuthorization("/api/v1/tv/playback/token", 123L))
        val viewModel = CatalogViewModel(repository)
        val url = viewModel.authorizePlayback("MOVIE", "movie-1")
        assertEquals("/api/v1/tv/playback/token", url)
        assertNotNull(repository.authorizedContent)
    }

    private class FakeCatalogRepository(
        private val movies: List<Movie> = emptyList(),
        private val series: List<Series> = emptyList(),
        private val seasons: List<Season> = emptyList(),
        private val episodes: List<Episode> = emptyList(),
        private val moviePage: CatalogPage<Movie> = CatalogPage(movies, movies.size, 1, 30),
        private val authorization: PlaybackAuthorization = PlaybackAuthorization("", 0L),
    ) : CatalogRepository {
        var authorizedContent: Pair<String, String>? = null

        override suspend fun searchCatalog(query: String): Result<UnifiedSearchResults> =
            Result.Success(UnifiedSearchResults())

        override suspend fun getMovies(page: Int, limit: Int, search: String?): Result<CatalogPage<Movie>> =
            Result.Success(moviePage.copy(page = page))

        override suspend fun getSeries(page: Int, limit: Int, search: String?): Result<CatalogPage<Series>> =
            Result.Success(CatalogPage(series, series.size, page, limit))

        override suspend fun getSeriesById(seriesId: String): Result<Series> =
            Result.Success(series.firstOrNull { it.id == seriesId } ?: Series(id = seriesId, title = "Series"))

        override suspend fun getSeasons(seriesId: String): Result<List<Season>> = Result.Success(seasons)

        override suspend fun getEpisodes(seasonId: String): Result<List<Episode>> = Result.Success(episodes)

        override suspend fun authorizePlayback(contentType: String, contentId: String): Result<PlaybackAuthorization> {
            authorizedContent = contentType to contentId
            return Result.Success(authorization)
        }
    }
}
