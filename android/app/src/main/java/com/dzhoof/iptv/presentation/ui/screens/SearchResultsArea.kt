package com.dzhoof.iptv.presentation.ui.screens

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.SoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import com.dzhoof.iptv.R
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.domain.model.UnifiedChannelResult
import com.dzhoof.iptv.domain.model.UnifiedContentResult
import com.dzhoof.iptv.domain.model.UnifiedProgramResult
import com.dzhoof.iptv.presentation.model.SearchUiState
import com.dzhoof.iptv.presentation.ui.LocalPerfProfile
import com.dzhoof.iptv.presentation.ui.animation.DURATION_NORMAL
import com.dzhoof.iptv.presentation.ui.animation.EaseOutQuart
import com.dzhoof.iptv.presentation.ui.animation.animateItemEntrance
import com.dzhoof.iptv.presentation.ui.components.ChannelCard
import com.dzhoof.iptv.presentation.ui.components.ErrorState
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import coil.compose.AsyncImage

@Composable
internal fun SearchResultsArea(
    uiState: SearchUiState,
    searchQuery: String,
    isMobile: Boolean,
    onChannelClick: (String) -> Unit,
    onFavoriteClick: (String) -> Unit,
    onMultiviewClick: (String) -> Unit,
    onRetry: () -> Unit,
    onRecentSearchClick: (String) -> Unit,
    onClearHistory: () -> Unit,
    keyboardController: SoftwareKeyboardController?,
    onMovieClick: (String) -> Unit = {},
    onSeriesClick: (String) -> Unit = {},
    onProgramClick: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val searchState = when {
        uiState.isLoading -> "loading"
        uiState.error != null -> "error"
        searchQuery.isBlank() && uiState.recentSearches.isNotEmpty() -> "recent"
        searchQuery.isBlank() -> "prompt"
        uiState.results.isEmpty() && uiState.unifiedResults.totalCount == 0 -> "no_results"
        else -> "results"
    }

    Crossfade(
        targetState = searchState,
        animationSpec = tween(DURATION_NORMAL, easing = EaseOutQuart),
        label = "searchState",
        modifier = modifier,
    ) { state ->
        when (state) {
            "loading" -> SearchResultsSkeleton(showShimmer = !LocalPerfProfile.current.reduceMotion)
            "error" -> ErrorState(message = uiState.error ?: "Search failed", onRetry = onRetry)
            "recent" -> RecentSearches(
                searches = uiState.recentSearches,
                onSearchClick = onRecentSearchClick,
                onClearHistory = onClearHistory,
            )
            "prompt" -> SearchPrompt()
            "no_results" -> NoResultsState(query = searchQuery)
            else -> {
                if (isMobile) {
                    LaunchedEffect(Unit) { keyboardController?.hide() }
                }
                Column(modifier = Modifier.fillMaxSize()) {
                    val totalCount = uiState.results.size + uiState.unifiedResults.totalCount
                    Text(
                        text = "$totalCount result${if (totalCount != 1) "s" else ""} for \"$searchQuery\"",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier.padding(bottom = Dimens.RowTitleGap),
                    )
                    val matchedCategories = remember(uiState.results, searchQuery) {
                        val q = searchQuery.trim()
                        if (q.isBlank()) emptyList()
                        else uiState.results
                            .map { it.category }
                            .filter { it.isNotBlank() && it.contains(q, ignoreCase = true) }
                            .distinct()
                            .take(4)
                    }
                    if (matchedCategories.isNotEmpty()) {
                        CategoryMatchHints(
                            categories = matchedCategories,
                            modifier = Modifier.padding(bottom = Dimens.RowTitleGap),
                        )
                    }
                    UnifiedContentSections(
                        channels = uiState.unifiedResults.channels,
                        movies = uiState.unifiedResults.movies,
                        series = uiState.unifiedResults.series,
                        programs = uiState.unifiedResults.programs,
                        onChannelClick = onChannelClick,
                        onMovieClick = onMovieClick,
                        onSeriesClick = onSeriesClick,
                        onProgramClick = onProgramClick,
                    )
                    if (uiState.results.isNotEmpty()) {
                        Text(
                            text = stringResource(R.string.search_live_channels),
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.padding(vertical = Dimens.RowTitleGap),
                        )
                        val screenWidthDp = LocalConfiguration.current.screenWidthDp
                        LazyVerticalGrid(
                            columns = GridCells.Adaptive(minSize = if (screenWidthDp < 600) 100.dp else 140.dp),
                            modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(bottom = 24.dp),
                            horizontalArrangement = Arrangement.spacedBy(Dimens.GridGap),
                            verticalArrangement = Arrangement.spacedBy(Dimens.GridGap),
                        ) {
                            itemsIndexed(uiState.results, key = { _, channel -> channel.id }) { index, channel ->
                                ChannelCard(
                                    channel = channel,
                                    onClick = { onChannelClick(channel.id) },
                                    onFavoriteClick = { onFavoriteClick(channel.id) },
                                    onMultiviewClick = { onMultiviewClick(channel.id) },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(Dimens.GridCardHeight)
                                        .animateItemEntrance(index),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun UnifiedContentSections(
    channels: List<UnifiedChannelResult>,
    movies: List<UnifiedContentResult>,
    series: List<UnifiedContentResult>,
    programs: List<UnifiedProgramResult>,
    onChannelClick: (String) -> Unit,
    onMovieClick: (String) -> Unit,
    onSeriesClick: (String) -> Unit,
    onProgramClick: (String) -> Unit,
) {
    if (channels.isNotEmpty()) {
        SearchChannelSection(channels = channels.take(8), onClick = onChannelClick)
    }
    if (movies.isNotEmpty()) {
        SearchResultSection(title = stringResource(R.string.search_movies), items = movies.take(6), onClick = onMovieClick)
    }
    if (series.isNotEmpty()) {
        SearchResultSection(title = stringResource(R.string.search_series), items = series.take(6), onClick = onSeriesClick)
    }
    if (programs.isNotEmpty()) {
        Text(
            text = stringResource(R.string.search_programmes),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(vertical = Dimens.RowTitleGap),
        )
        programs.take(6).forEach { program ->
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 6.dp)
                    .clickable { onProgramClick(program.id) },
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(program.name, style = MaterialTheme.typography.titleSmall)
                    program.description?.takeIf { it.isNotBlank() }?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                    }
                    val metadata = listOfNotNull(
                        program.category?.takeIf { it.isNotBlank() },
                        if (program.catchupAvailable) stringResource(R.string.search_catchup_available) else null,
                    ).joinToString(" • ")
                    if (metadata.isNotBlank()) {
                        Text(
                            text = metadata,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.secondary,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchChannelSection(
    channels: List<UnifiedChannelResult>,
    onClick: (String) -> Unit,
) {
    Text(
        text = stringResource(R.string.search_live_channels),
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(vertical = Dimens.RowTitleGap),
    )
    channels.forEach { channel ->
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 6.dp)
                .clickable { onClick(channel.id) },
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Text(channel.name, style = MaterialTheme.typography.titleSmall)
                channel.group?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
                }
            }
        }
    }
}

@Composable
private fun SearchResultSection(
    title: String,
    items: List<UnifiedContentResult>,
    onClick: (String) -> Unit,
) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(vertical = Dimens.RowTitleGap),
    )
    items.forEach { item ->
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 6.dp)
                .clickable { onClick(item.id) },
        ) {
            Row(modifier = Modifier.padding(12.dp)) {
                AsyncImage(
                    model = item.poster,
                    contentDescription = item.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(64.dp)
                        .clip(MaterialTheme.shapes.small),
                )
                Spacer(modifier = Modifier.size(12.dp))
                Column {
                    Text(item.name, style = MaterialTheme.typography.titleSmall)
                    item.category?.takeIf { it.isNotBlank() }?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
                    }
                }
            }
        }
    }
}
