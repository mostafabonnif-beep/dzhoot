package com.dzhoof.iptv.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.model.Episode
import com.dzhoof.iptv.domain.model.Movie
import com.dzhoof.iptv.domain.model.Season
import com.dzhoof.iptv.domain.model.Series
import com.dzhoof.iptv.domain.repository.CatalogRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class CatalogTab { MOVIES, SERIES }

data class CatalogUiState(
    val tab: CatalogTab = CatalogTab.MOVIES,
    val movies: List<Movie> = emptyList(),
    val series: List<Series> = emptyList(),
    val seasons: List<Season> = emptyList(),
    val episodes: List<Episode> = emptyList(),
    val selectedMovie: Movie? = null,
    val selectedSeries: Series? = null,
    val selectedSeason: Season? = null,
    val isLoadingMovie: Boolean = false,
    val movieError: String? = null,
    val page: Int = 1,
    val totalCount: Int = 0,
    val isLoading: Boolean = false,
    val isLoadingDetails: Boolean = false,
    val isLoadingMore: Boolean = false,
    val error: String? = null,
    val detailsError: String? = null,
    val query: String = "",
)

@HiltViewModel
class CatalogViewModel @Inject constructor(
    private val repository: CatalogRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(CatalogUiState())
    val uiState: StateFlow<CatalogUiState> = _uiState.asStateFlow()

    init {
        loadMovies()
    }

    fun selectTab(tab: CatalogTab) {
        if (_uiState.value.tab == tab) return
        _uiState.value = _uiState.value.copy(tab = tab, page = 1, query = "", error = null)
        if (tab == CatalogTab.MOVIES) loadMovies() else loadSeries()
    }

    fun updateQuery(query: String) {
        _uiState.value = _uiState.value.copy(query = query)
    }

    fun submitSearch() {
        if (_uiState.value.tab == CatalogTab.MOVIES) loadMovies() else loadSeries()
    }

    fun refresh() {
        if (_uiState.value.tab == CatalogTab.MOVIES) loadMovies() else loadSeries()
    }

    fun loadMore() {
        val current = _uiState.value
        if (current.isLoading || current.isLoadingMore) return
        val loadedCount = if (current.tab == CatalogTab.MOVIES) current.movies.size else current.series.size
        if (current.totalCount > 0 && loadedCount >= current.totalCount) return
        if (current.tab == CatalogTab.MOVIES) loadMovies(page = current.page + 1, append = true)
        else loadSeries(page = current.page + 1, append = true)
    }

    fun selectMovie(movie: Movie) {
        _uiState.value = _uiState.value.copy(
            selectedMovie = movie,
            movieError = null,
            isLoadingMovie = false,
            selectedSeries = null,
            selectedSeason = null,
            seasons = emptyList(),
            episodes = emptyList(),
        )
    }

    fun selectMovieById(movieId: String, fallbackTitle: String = "فيلم") {
        _uiState.value = _uiState.value.copy(
            selectedMovie = Movie(
                id = movieId,
                title = fallbackTitle,
                category = "",
                poster = null,
                backdrop = null,
                description = null,
                year = null,
                durationMinutes = null,
                rating = null,
            ),
            movieError = null,
            isLoadingMovie = true,
            selectedSeries = null,
            selectedSeason = null,
            seasons = emptyList(),
            episodes = emptyList(),
        )
        viewModelScope.launch {
            when (val result = repository.getMovieById(movieId)) {
                is Result.Success -> _uiState.value = _uiState.value.copy(
                    selectedMovie = result.data,
                    isLoadingMovie = false,
                )
                is Result.Error -> _uiState.value = _uiState.value.copy(
                    isLoadingMovie = false,
                    movieError = result.exception.message ?: "تعذر تحميل تفاصيل الفيلم",
                )
            }
        }
    }

    fun selectSeriesById(seriesId: String, fallbackTitle: String = "مسلسل") {
        viewModelScope.launch {
            when (val result = repository.getSeriesById(seriesId)) {
                is Result.Success -> selectSeries(result.data)
                is Result.Error -> _uiState.value = _uiState.value.copy(
                    selectedSeries = Series(
                        id = seriesId,
                        title = fallbackTitle,
                        category = "",
                        poster = null,
                        backdrop = null,
                        plot = null,
                        cast = null,
                        director = null,
                        genre = null,
                        releaseDate = null,
                        rating = null,
                    ),
                    isLoadingDetails = false,
                    detailsError = result.exception.message ?: "تعذر تحميل تفاصيل المسلسل",
                )
            }
        }
    }

    fun selectSeries(series: Series) {
        _uiState.value = _uiState.value.copy(
            selectedMovie = null,
            selectedSeries = series,
            selectedSeason = null,
            movieError = null,
            seasons = emptyList(),
            episodes = emptyList(),
            isLoadingDetails = true,
            detailsError = null,
        )
        viewModelScope.launch {
            when (val result = repository.getSeasons(series.id)) {
                is Result.Success -> _uiState.value = _uiState.value.copy(
                    seasons = result.data,
                    isLoadingDetails = false,
                )
                is Result.Error -> _uiState.value = _uiState.value.copy(
                    isLoadingDetails = false,
                    detailsError = result.exception.message ?: "تعذر تحميل المواسم",
                )
            }
        }
    }

    fun selectSeason(season: Season) {
        _uiState.value = _uiState.value.copy(
            selectedSeason = season,
            episodes = emptyList(),
            isLoadingDetails = true,
            detailsError = null,
        )
        viewModelScope.launch {
            when (val result = repository.getEpisodes(season.id)) {
                is Result.Success -> _uiState.value = _uiState.value.copy(
                    episodes = result.data,
                    isLoadingDetails = false,
                )
                is Result.Error -> _uiState.value = _uiState.value.copy(
                    isLoadingDetails = false,
                    detailsError = result.exception.message ?: "تعذر تحميل الحلقات",
                )
            }
        }
    }

    fun retryDetails() {
        val current = _uiState.value
        current.selectedSeason?.let { selectSeason(it) } ?: current.selectedSeries?.let { selectSeries(it) }
    }

    suspend fun authorizePlayback(contentType: String, contentId: String): String? {
        return when (val result = repository.authorizePlayback(contentType, contentId)) {
            is Result.Success -> result.data.url
            is Result.Error -> {
                _uiState.value = _uiState.value.copy(error = result.exception.message ?: "تعذر تفويض تشغيل المحتوى")
                null
            }
        }
    }

    fun clearDetails() {
        _uiState.value = _uiState.value.copy(
            selectedMovie = null,
            selectedSeries = null,
            isLoadingMovie = false,
            movieError = null,
            selectedSeason = null,
            seasons = emptyList(),
            episodes = emptyList(),
            detailsError = null,
        )
    }

    private fun loadMovies(page: Int = 1, append: Boolean = false) {
        if (append) _uiState.value = _uiState.value.copy(isLoadingMore = true, error = null)
        else _uiState.value = _uiState.value.copy(isLoading = true, page = page, error = null)
        viewModelScope.launch {
            when (val result = repository.getMovies(page, search = _uiState.value.query.takeIf { it.isNotBlank() })) {
                is Result.Success -> {
                    val old = if (append) _uiState.value.movies else emptyList()
                    _uiState.value = _uiState.value.copy(
                        movies = old + result.data.items,
                        page = result.data.page,
                        totalCount = result.data.totalCount,
                        isLoading = false,
                        isLoadingMore = false,
                    )
                }
                is Result.Error -> _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    isLoadingMore = false,
                    error = result.exception.message ?: "تعذر تحميل الأفلام",
                )
            }
        }
    }

    private fun loadSeries(page: Int = 1, append: Boolean = false) {
        if (append) _uiState.value = _uiState.value.copy(isLoadingMore = true, error = null)
        else _uiState.value = _uiState.value.copy(isLoading = true, page = page, error = null)
        viewModelScope.launch {
            when (val result = repository.getSeries(page, search = _uiState.value.query.takeIf { it.isNotBlank() })) {
                is Result.Success -> {
                    val old = if (append) _uiState.value.series else emptyList()
                    _uiState.value = _uiState.value.copy(
                        series = old + result.data.items,
                        page = result.data.page,
                        totalCount = result.data.totalCount,
                        isLoading = false,
                        isLoadingMore = false,
                    )
                }
                is Result.Error -> _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    isLoadingMore = false,
                    error = result.exception.message ?: "تعذر تحميل المسلسلات",
                )
            }
        }
    }
}
