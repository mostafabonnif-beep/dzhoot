package com.dzhoof.iptv.presentation.ui.screens

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dzhoof.iptv.presentation.ui.animation.DURATION_NORMAL
import com.dzhoof.iptv.presentation.ui.animation.EaseOutQuart
import com.dzhoof.iptv.presentation.ui.animation.animateItemEntrance
import com.dzhoof.iptv.presentation.ui.components.CategoryCard
import com.dzhoof.iptv.presentation.ui.components.EmptyState
import com.dzhoof.iptv.presentation.ui.components.ErrorState
import com.dzhoof.iptv.presentation.ui.components.LoadingIndicator
import com.dzhoof.iptv.presentation.ui.components.ScreenScaffold
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.presentation.util.CategoryLocalizer
import com.dzhoof.iptv.presentation.viewmodel.ChannelsViewModel

@Composable
fun CategoriesScreen(
    onCategoryClick: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ChannelsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val isCompact = LocalConfiguration.current.screenWidthDp < 600

    LaunchedEffect(Unit) {
        viewModel.loadChannels()
    }

    val contentState = when {
        uiState.isLoading && uiState.categories.isEmpty() -> "loading"
        uiState.error != null && uiState.categories.isEmpty() -> "error"
        uiState.categories.isEmpty() -> "empty"
        else -> "content"
    }
    val categoriesData = remember(uiState.channels, uiState.favoriteCategoryNames) {
        uiState.channels
            .groupBy { it.category.ifBlank { "Other" } }
            .map { (name, channels) ->
                Client2MobileCategory(
                    sourceName = name,
                    displayName = cleanCategoryTitle(CategoryLocalizer.localize(name)),
                    channelCount = channels.size,
                    isFavorite = name in uiState.favoriteCategoryNames
                )
            }
            // Favourites remain immediately reachable, then categories are ordered
            // by the amount of live content actually available.
            .sortedWith(
                compareByDescending<Client2MobileCategory> { it.isFavorite }
                    .thenByDescending { it.channelCount }
                    .thenBy { it.displayName }
            )
    }

    if (isCompact) {
        Crossfade(
            targetState = contentState,
            animationSpec = tween(DURATION_NORMAL, easing = EaseOutQuart),
            label = "mobileCategoriesState"
        ) { state ->
            when (state) {
                "loading" -> LoadingIndicator(message = "جارٍ تجهيز دليل القنوات…")
                "error" -> ErrorState(
                    message = uiState.error ?: "تعذر تحميل التصنيفات",
                    onRetry = { viewModel.loadChannels() }
                )
                "empty" -> EmptyState(
                    message = "لا توجد تصنيفات متاحة",
                    onRetry = { viewModel.loadChannels() }
                )
                else -> Client2MobileCategories(
                    categories = categoriesData,
                    totalChannelCount = uiState.channels.size,
                    onCategoryClick = onCategoryClick,
                    onToggleFavorite = viewModel::toggleCategoryFavorite,
                    modifier = modifier
                )
            }
        }
    } else {
        ScreenScaffold(title = "التصنيفات", modifier = modifier) {
            Crossfade(
                targetState = contentState,
                animationSpec = tween(DURATION_NORMAL, easing = EaseOutQuart),
                label = "categoriesState"
            ) { state ->
                when (state) {
                    "loading" -> LoadingIndicator(message = "جارٍ تحميل التصنيفات…")
                    "error" -> ErrorState(
                        message = uiState.error ?: "تعذر تحميل التصنيفات",
                        onRetry = { viewModel.loadChannels() }
                    )
                    "empty" -> EmptyState(
                        message = "لا توجد تصنيفات متاحة",
                        onRetry = { viewModel.loadChannels() }
                    )
                    else -> DesktopCategoriesGrid(
                        categories = categoriesData,
                        onCategoryClick = onCategoryClick,
                        onToggleFavorite = viewModel::toggleCategoryFavorite
                    )
                }
            }
        }
    }
}

@Composable
private fun DesktopCategoriesGrid(
    categories: List<Client2MobileCategory>,
    onCategoryClick: (String) -> Unit,
    onToggleFavorite: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxSize()) {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 160.dp),
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(
                start = Dimens.ScreenPaddingHorizontalTv,
                end = Dimens.ScreenPaddingHorizontalTv,
                top = 0.dp,
                bottom = Dimens.ScreenPaddingVertical
            ),
            horizontalArrangement = Arrangement.spacedBy(Dimens.GridGap),
            verticalArrangement = Arrangement.spacedBy(Dimens.GridGap)
        ) {
            itemsIndexed(categories, key = { _, category -> category.sourceName }) { index, category ->
                CategoryCard(
                    name = category.displayName,
                    channelCount = category.channelCount,
                    imageUrl = null,
                    isFavorite = category.isFavorite,
                    onClick = { onCategoryClick(category.sourceName) },
                    onToggleFavorite = { onToggleFavorite(category.sourceName) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(142.dp)
                        .animateItemEntrance(index)
                )
            }
        }
        Text(
            text = "اضغط OK للدخول إلى التصنيف",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 18.dp, bottom = 22.dp)
                .wrapContentWidth(Alignment.CenterHorizontally)
        )
    }
}

private fun cleanCategoryTitle(value: String): String = value
    .replace(Regex("^\\s*#+\\s*"), "")
    .replace(Regex("\\s+"), " ")
    .trim()
    .ifBlank { "تصنيفات متنوعة" }
