package com.dzhoof.iptv.presentation.ui.screens

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dzhoof.iptv.presentation.ui.animation.DURATION_NORMAL
import com.dzhoof.iptv.presentation.ui.animation.EaseOutQuart
import com.dzhoof.iptv.presentation.ui.animation.animateItemEntrance
import com.dzhoof.iptv.presentation.util.CategoryLocalizer
import com.dzhoof.iptv.presentation.ui.components.*
import com.dzhoof.iptv.presentation.ui.theme.Dimens
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

    ScreenScaffold(title = "التصنيفات", modifier = modifier) {
        val contentState = when {
            uiState.isLoading && uiState.categories.isEmpty() -> "loading"
            uiState.error != null && uiState.categories.isEmpty() -> "error"
            uiState.categories.isEmpty() -> "empty"
            else -> "content"
        }

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
                else -> {
                    val categoriesData = remember(uiState.channels, uiState.favoriteCategoryNames) {
                        val favorites = uiState.favoriteCategoryNames
                        uiState.channels
                            .groupBy { it.category.ifBlank { "Other" } }
                            .map { (name, channels) ->
                                Triple(
                                    name,
                                    channels.size,
                                    channels.firstOrNull { it.thumbnailPath != null }?.thumbnailPath
                                        ?: channels.firstOrNull { it.logoUrl != null }?.logoUrl
                                )
                            }
                            // Show every category, including small and newly imported
                            // groups. Hiding groups with fewer than three channels made
                            // valid operator categories disappear from the app.
                            .sortedWith(
                                compareByDescending<Triple<String, Int, String?>> { it.first in favorites }
                                    .thenByDescending { it.second }
                                    .thenBy { CategoryLocalizer.localize(it.first) }
                                    .thenBy { it.first }
                            )
                    }

                    Column(modifier = Modifier.fillMaxSize()) {
                    LazyVerticalGrid(
                        columns = if (isCompact) GridCells.Fixed(2)
                                  else GridCells.Adaptive(minSize = 160.dp),
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(
                            start = if (isCompact) Dimens.ScreenPaddingHorizontalMobile
                                    else Dimens.ScreenPaddingHorizontalTv,
                            end = if (isCompact) Dimens.ScreenPaddingHorizontalMobile
                                  else Dimens.ScreenPaddingHorizontalTv,
                            top = 0.dp,
                            bottom = if (isCompact) Dimens.ScreenPaddingVerticalMobile
                                     else Dimens.ScreenPaddingVertical
                        ),
                        horizontalArrangement = Arrangement.spacedBy(
                            if (isCompact) Dimens.CategoryCardGap else Dimens.GridGap
                        ),
                        verticalArrangement = Arrangement.spacedBy(
                            if (isCompact) Dimens.CategoryCardGap else Dimens.GridGap
                        )
                    ) {
                        itemsIndexed(categoriesData) { index, (category, count, imageUrl) ->
                            CategoryCard(
                                name = CategoryLocalizer.localize(category),
                                channelCount = count,
                                imageUrl = imageUrl,
                                isFavorite = category in uiState.favoriteCategoryNames,
                                onClick = { onCategoryClick(category) },
                                onToggleFavorite = { viewModel.toggleCategoryFavorite(category) },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(if (isCompact) Dimens.CategoryCardHeightMobile else 142.dp)
                                    .animateItemEntrance(index)
                            )
                        }
                    }
                    if (!isCompact) {
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
                }
            }
        }
    }
}
