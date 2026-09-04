package com.dzhoof.iptv.presentation.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.dzhoof.iptv.domain.model.Episode
import com.dzhoof.iptv.domain.model.Movie
import com.dzhoof.iptv.domain.model.Season
import com.dzhoof.iptv.domain.model.Series
import com.dzhoof.iptv.presentation.ui.components.AppTextField
import com.dzhoof.iptv.presentation.ui.components.EmptyState
import com.dzhoof.iptv.presentation.ui.components.ErrorState
import com.dzhoof.iptv.presentation.ui.components.ScreenScaffold
import com.dzhoof.iptv.presentation.viewmodel.CatalogTab
import com.dzhoof.iptv.presentation.viewmodel.CatalogViewModel

@Composable
fun CatalogScreen(
    onPlayMovie: (String, String) -> Unit,
    onPlayEpisode: (String, String) -> Unit,
    onOpenSettings: () -> Unit = {},
    initialSeriesId: String? = null,
    initialSeriesTitle: String? = null,
    initialMovieId: String? = null,
    initialMovieTitle: String? = null,
    modifier: Modifier = Modifier,
    viewModel: CatalogViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(initialMovieId) {
        initialMovieId?.takeIf { it.isNotBlank() }?.let { id ->
            viewModel.selectMovieById(id, initialMovieTitle ?: "فيلم")
        }
    }

    LaunchedEffect(initialSeriesId) {
        initialSeriesId?.takeIf { it.isNotBlank() }?.let { id ->
            viewModel.selectSeriesById(id, initialSeriesTitle ?: "مسلسل")
        }
    }

    ScreenScaffold(title = "الأفلام والمسلسلات", modifier = modifier) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 16.dp),
        ) {
            val selectedMovie = state.selectedMovie
            if (selectedMovie != null) {
                MovieDetails(
                    movie = selectedMovie,
                    isLoading = state.isLoadingMovie,
                    error = state.movieError,
                    onBack = viewModel::clearDetails,
                    onRetry = {
                        viewModel.selectMovieById(selectedMovie.id, selectedMovie.title)
                    },
                    onPlay = { movie -> onPlayMovie(movie.id, movie.title) },
                )
            } else if (state.selectedSeries == null) {
                CatalogToolbar(
                    onOpenSettings = onOpenSettings,
                    tab = state.tab,
                    query = state.query,
                    onTabSelected = viewModel::selectTab,
                    onQueryChanged = viewModel::updateQuery,
                    onSearch = viewModel::submitSearch,
                )
                Spacer(modifier = Modifier.height(16.dp))
                CatalogContent(
                    state = state,
                    onMovieClick = viewModel::selectMovie,
                    onSeriesClick = viewModel::selectSeries,
                    onLoadMore = viewModel::loadMore,
                    onRetry = viewModel::refresh,
                )
            } else {
                SeriesDetails(
                    series = state.selectedSeries,
                    seasons = state.seasons,
                    selectedSeason = state.selectedSeason,
                    episodes = state.episodes,
                    isLoading = state.isLoadingDetails,
                    error = state.detailsError,
                    onBack = viewModel::clearDetails,
                    onRetry = viewModel::retryDetails,
                    onSeasonSelected = viewModel::selectSeason,
                    onEpisodeClick = { episode -> onPlayEpisode(episode.id, episode.title) },
                )
            }
        }
    }
}

@Composable
private fun CatalogToolbar(
    tab: CatalogTab,
    query: String,
    onOpenSettings: () -> Unit,
    onTabSelected: (CatalogTab) -> Unit,
    onQueryChanged: (String) -> Unit,
    onSearch: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FilterChip(
            selected = tab == CatalogTab.MOVIES,
            onClick = { onTabSelected(CatalogTab.MOVIES) },
            label = { Text("أفلام") },
        )
        FilterChip(
            selected = tab == CatalogTab.SERIES,
            onClick = { onTabSelected(CatalogTab.SERIES) },
            label = { Text("مسلسلات") },
        )
        AppTextField(
            value = query,
            onValueChange = onQueryChanged,
            placeholder = "ابحث في المحتوى",
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = "بحث") },
            modifier = Modifier.weight(1f),
        )
        Button(onClick = onSearch) { Text("بحث") }
        OutlinedButton(onClick = onOpenSettings) {
            Icon(Icons.Default.Settings, contentDescription = "الإعدادات")
            Spacer(modifier = Modifier.width(6.dp))
            Text("الإعدادات")
        }
    }
}

@Composable
private fun CatalogContent(
    state: com.dzhoof.iptv.presentation.viewmodel.CatalogUiState,
    onMovieClick: (Movie) -> Unit,
    onSeriesClick: (Series) -> Unit,
    onLoadMore: () -> Unit,
    onRetry: () -> Unit,
) {
    if (state.isLoading && state.movies.isEmpty() && state.series.isEmpty()) {
        CircularProgressIndicator(modifier = Modifier.fillMaxWidth())
        return
    }
    state.error?.let { error ->
        ErrorState(message = error, onRetry = onRetry)
        return
    }

    if (state.tab == CatalogTab.MOVIES && state.movies.isEmpty() ||
        state.tab == CatalogTab.SERIES && state.series.isEmpty()
    ) {
        EmptyState(message = "لم يتم العثور على محتوى")
        return
    }

    if (state.tab == CatalogTab.MOVIES) {
        PosterGrid(
            items = state.movies,
            totalCount = state.totalCount,
            isLoadingMore = state.isLoadingMore,
            onLoadMore = onLoadMore,
            keyOf = { it.id },
            posterContent = { movie ->
                PosterCard(
                    title = movie.title,
                    subtitle = movie.year?.toString() ?: movie.category,
                    imageUrl = movie.poster,
                    onClick = { onMovieClick(movie) },
                )
            },
        )
    } else {
        PosterGrid(
            items = state.series,
            totalCount = state.totalCount,
            isLoadingMore = state.isLoadingMore,
            onLoadMore = onLoadMore,
            keyOf = { it.id },
            posterContent = { series ->
                PosterCard(
                    title = series.title,
                    subtitle = series.releaseDate?.take(4) ?: series.category,
                    imageUrl = series.poster,
                    onClick = { onSeriesClick(series) },
                )
            },
        )
    }
}

@Composable
private fun MovieDetails(
    movie: Movie?,
    isLoading: Boolean,
    error: String?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onPlay: (Movie) -> Unit,
) {
    if (movie == null) return
    Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(onClick = onBack) { Text("رجوع") }
        Spacer(modifier = Modifier.width(16.dp))
        Text(movie.title, style = MaterialTheme.typography.headlineSmall)
    }
    Spacer(modifier = Modifier.height(16.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        AsyncImage(
            model = movie.poster,
            contentDescription = movie.title,
            modifier = Modifier
                .width(180.dp)
                .height(260.dp)
                .clip(MaterialTheme.shapes.medium),
            contentScale = ContentScale.Crop,
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            movie.description?.takeIf { it.isNotBlank() }?.let { Text(it, maxLines = 6, overflow = TextOverflow.Ellipsis) }
            Text("التصنيف: ${movie.category}")
            movie.year?.let { Text("السنة: $it") }
            movie.rating?.let { Text("التقييم: $it") }
            movie.durationMinutes?.let { Text("المدة: $it دقيقة") }
            Button(onClick = { onPlay(movie) }) { Text("تشغيل الفيلم") }
        }
    }
    if (isLoading) CircularProgressIndicator()
    error?.let {
        Spacer(modifier = Modifier.height(12.dp))
        ErrorState(message = it, onRetry = onRetry)
    }
}

@Composable
private fun SeriesDetails(
    series: Series?,
    seasons: List<Season>,
    selectedSeason: Season?,
    episodes: List<Episode>,
    isLoading: Boolean,
    error: String?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onSeasonSelected: (Season) -> Unit,
    onEpisodeClick: (Episode) -> Unit,
) {
    if (series == null) return
    Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(onClick = onBack) { Text("رجوع") }
        Spacer(modifier = Modifier.width(16.dp))
        Text(series.title, style = MaterialTheme.typography.headlineSmall)
    }
    Spacer(modifier = Modifier.height(12.dp))
    series.plot?.takeIf { it.isNotBlank() }?.let {
        Text(it, maxLines = 3, overflow = TextOverflow.Ellipsis)
        Spacer(modifier = Modifier.height(12.dp))
    }
    if (isLoading) {
        CircularProgressIndicator()
        return
    }
    error?.let {
        ErrorState(message = it, onRetry = onRetry)

        return
    }
    if (seasons.isEmpty()) {
        EmptyState(message = "لا توجد مواسم")
        return
    }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(seasons.size, key = { i -> "$i:${seasons[i].id}" }) { i ->
            val season = seasons[i]
            FilterChip(
                selected = selectedSeason?.id == season.id,
                onClick = { onSeasonSelected(season) },
                label = { Text(season.name.ifBlank { "الموسم ${season.seasonNumber}" }) },
            )
        }
    }
    Spacer(modifier = Modifier.height(16.dp))
    if (selectedSeason == null) {
        Text("اختر موسمًا لعرض الحلقات")
    } else if (episodes.isEmpty()) {
        EmptyState(message = "لا توجد حلقات")
    } else {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(episodes.size, key = { i -> "$i:${episodes[i].id}" }) { i ->
                val episode = episodes[i]
                EpisodeRow(episode = episode, onClick = { onEpisodeClick(episode) })
            }
        }
    }
}

/**
 * Shared poster grid for movies/series with TV-friendly infinite scroll.
 */
@Composable
private fun <T> PosterGrid(
    items: List<T>,
    totalCount: Int,
    isLoadingMore: Boolean,
    onLoadMore: () -> Unit,
    keyOf: (T) -> Any,
    posterContent: @Composable (T) -> Unit,
) {
    val gridState = rememberLazyGridState()
    val tailVisible by remember(items.size) {
        derivedStateOf {
            val last = gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            items.isNotEmpty() && last >= items.size - 1
        }
    }
    LaunchedEffect(tailVisible, items.size, totalCount, isLoadingMore) {
        if (tailVisible && items.size < totalCount && !isLoadingMore) onLoadMore()
    }
    LazyVerticalGrid(
        state = gridState,
        columns = GridCells.Adaptive(minSize = 150.dp),
        contentPadding = PaddingValues(bottom = 28.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        items(items, key = keyOf) { item -> posterContent(item) }
        if (items.size < totalCount) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                OutlinedButton(onClick = onLoadMore, modifier = Modifier.fillMaxWidth()) {
                    Text(if (isLoadingMore) "جارٍ التحميل…" else "تحميل المزيد")
                }
            }
        }
    }
}

@Composable
private fun PosterCard(
    title: String,
    subtitle: String,
    imageUrl: String?,
    onClick: () -> Unit,
) {
    CatalogPosterCard(
        title = title,
        subtitle = subtitle,
        imageUrl = imageUrl,
        onClick = onClick,
    )
}

@Composable
private fun EpisodeRow(episode: Episode, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AsyncImage(
                model = episode.thumbnail,
                contentDescription = episode.title,
                modifier = Modifier
                    .width(180.dp)
                    .height(100.dp)
                    .clip(MaterialTheme.shapes.small),
                contentScale = ContentScale.Crop,
            )
            Spacer(modifier = Modifier.width(14.dp))
            Column {
                Text("الحلقة ${episode.episodeNumber}: ${episode.title}", style = MaterialTheme.typography.titleMedium)
                episode.description?.takeIf { it.isNotBlank() }?.let {
                    Text(it, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
