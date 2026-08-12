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
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
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
import androidx.compose.runtime.getValue
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
    modifier: Modifier = Modifier,
    viewModel: CatalogViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    ScreenScaffold(title = "Movies & Series", modifier = modifier) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 16.dp),
        ) {
            if (state.selectedSeries == null) {
                CatalogToolbar(
                    tab = state.tab,
                    query = state.query,
                    onTabSelected = viewModel::selectTab,
                    onQueryChanged = viewModel::updateQuery,
                    onSearch = viewModel::submitSearch,
                )
                Spacer(modifier = Modifier.height(16.dp))
                CatalogContent(
                    state = state,
                    onMovieClick = { movie -> onPlayMovie(movie.id, movie.title) },
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
            label = { Text("Movies") },
        )
        FilterChip(
            selected = tab == CatalogTab.SERIES,
            onClick = { onTabSelected(CatalogTab.SERIES) },
            label = { Text("Series") },
        )
        AppTextField(
            value = query,
            onValueChange = onQueryChanged,
            placeholder = "Search titles",
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = "Search") },
            modifier = Modifier.weight(1f),
        )
        Button(onClick = onSearch) { Text("Search") }
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
        EmptyState(message = "No titles found")
        return
    }

    if (state.tab == CatalogTab.MOVIES) {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 150.dp),
            contentPadding = PaddingValues(bottom = 28.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            items(state.movies, key = { it.id }) { movie ->
                PosterCard(
                    title = movie.title,
                    subtitle = movie.year?.toString() ?: movie.category,
                    imageUrl = movie.poster,
                    onClick = { onMovieClick(movie) },
                )
            }
            if (state.movies.size < state.totalCount) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    OutlinedButton(onClick = onLoadMore, modifier = Modifier.fillMaxWidth()) {
                        Text(if (state.isLoadingMore) "Loading…" else "Load more")
                    }
                }
            }
        }
    } else {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 150.dp),
            contentPadding = PaddingValues(bottom = 28.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            items(state.series, key = { it.id }) { series ->
                PosterCard(
                    title = series.title,
                    subtitle = series.category,
                    imageUrl = series.poster,
                    onClick = { onSeriesClick(series) },
                )
            }
            if (state.series.size < state.totalCount) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    OutlinedButton(onClick = onLoadMore, modifier = Modifier.fillMaxWidth()) {
                        Text(if (state.isLoadingMore) "Loading…" else "Load more")
                    }
                }
            }
        }
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
    onSeasonSelected: (Season) -> Unit,
    onEpisodeClick: (Episode) -> Unit,
) {
    if (series == null) return
    Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(onClick = onBack) { Text("Back") }
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
        ErrorState(message = it, onRetry = { onBack(); })
        return
    }
    if (seasons.isEmpty()) {
        EmptyState(message = "No seasons found")
        return
    }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(seasons, key = { it.id }) { season ->
            FilterChip(
                selected = selectedSeason?.id == season.id,
                onClick = { onSeasonSelected(season) },
                label = { Text(season.name.ifBlank { "Season ${season.seasonNumber}" }) },
            )
        }
    }
    Spacer(modifier = Modifier.height(16.dp))
    if (selectedSeason == null) {
        Text("Select a season to view episodes")
    } else if (episodes.isEmpty()) {
        EmptyState(message = "No episodes found")
    } else {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(episodes, key = { it.id }) { episode ->
                EpisodeRow(episode = episode, onClick = { onEpisodeClick(episode) })
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
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        AsyncImage(
            model = imageUrl,
            contentDescription = title,
            modifier = Modifier
                .fillMaxWidth()
                .height(210.dp)
                .clip(MaterialTheme.shapes.medium),
            contentScale = ContentScale.Crop,
        )
        Column(modifier = Modifier.padding(10.dp)) {
            Text(title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
            Text(subtitle, maxLines = 1, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
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
                Text("Episode ${episode.episodeNumber}: ${episode.title}", style = MaterialTheme.typography.titleMedium)
                episode.description?.takeIf { it.isNotBlank() }?.let {
                    Text(it, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
