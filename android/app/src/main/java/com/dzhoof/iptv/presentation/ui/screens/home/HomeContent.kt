package com.dzhoof.iptv.presentation.ui.screens.home

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import com.dzhoof.iptv.R
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.model.ChannelUiModel
import com.dzhoof.iptv.presentation.model.PopularCategoryUiModel
import com.dzhoof.iptv.presentation.ui.LocalPerfProfile
import com.dzhoof.iptv.presentation.ui.animation.animateItemEntrance
import com.dzhoof.iptv.presentation.ui.components.ChannelRowSkeleton
import com.dzhoof.iptv.presentation.ui.components.DemoModeBanner
import com.dzhoof.iptv.presentation.util.CategoryLocalizer
import com.dzhoof.iptv.presentation.ui.components.HomeHero
import com.dzhoof.iptv.presentation.ui.components.rememberHeroHeight
import com.dzhoof.iptv.presentation.ui.components.rememberShimmerBrush
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.presentation.ui.theme.Void800
import kotlinx.coroutines.delay

private const val HERO_SWAP_DEBOUNCE_MS = 300L
private const val HOME_CATEGORY_ROWS_LIMIT = 10

@Composable
fun HomeContent(
    channels: List<ChannelUiModel>,
    featuredChannels: List<ChannelUiModel>,
    recentlyWatched: List<ChannelUiModel>,
    forYou: List<ChannelUiModel>,
    popularCategories: List<PopularCategoryUiModel>,
    lastPlayedChannelId: String?,
    onChannelClick: (String) -> Unit,
    onNavigateToChannels: (String) -> Unit,
    onNavigateToSearch: () -> Unit,
    onNavigateToGuide: () -> Unit,
    onNavigateToFavorites: () -> Unit,
    onToggleFavorite: (String) -> Unit,
    onMultiviewClick: (String) -> Unit,
    isDemo: Boolean = false,
    modifier: Modifier = Modifier
) {
    val configuration = LocalConfiguration.current
    val isPortrait = configuration.orientation == Configuration.ORIENTATION_PORTRAIT
    val isCompact = configuration.screenWidthDp < COMPACT_WIDTH_DP
    val horizontalPadding =
        if (isPortrait) Dimens.ScreenPaddingHorizontalMobile else Dimens.ScreenPaddingHorizontalTv
    val rowGap = if (isCompact) Dimens.RowGapMobile else Dimens.RowGap
    val screenPaddingVertical =
        if (isCompact) Dimens.ScreenPaddingVerticalMobile else Dimens.ScreenPaddingVertical

    // On phones the default hero (0.35 of screen height) is TV-huge. Force a
    // banner-proportioned height off screen *width* so it takes a sensible
    // slice of a portrait screen; capped so it never dominates a short screen.
    // TV/landscape passes no override — HomeHero keeps its own height.
    val compactHeroHeight = remember(configuration.screenWidthDp, configuration.screenHeightDp) {
        val byWidth = configuration.screenWidthDp * 0.60f
        val cap = configuration.screenHeightDp * 0.30f
        // cap can undercut the 180dp floor on short/landscape screens — cap wins
        byWidth.coerceAtLeast(180f).coerceAtMost(cap).dp
    }

    // The phone uses a purpose-built Client 2.0 landing page rather than a
    // scaled-down TV layout. Keeping this branch here makes TV's focus-driven
    // browse experience independent from the touch-first mobile information
    // architecture.
    if (isCompact) {
        Client2MobileHome(
            channels = channels,
            featuredChannels = featuredChannels,
            recentlyWatched = recentlyWatched,
            forYou = forYou,
            onChannelClick = onChannelClick,
            onNavigateToChannels = onNavigateToChannels,
            onNavigateToSearch = onNavigateToSearch,
            onNavigateToGuide = onNavigateToGuide,
            onNavigateToFavorites = onNavigateToFavorites,
            onToggleFavorite = onToggleFavorite,
            isDemo = isDemo,
            modifier = modifier
        )
        return
    }

    val channelsByCategory = remember(channels) {
        channels.groupBy { it.category.ifBlank { "" } }
    }
    // التنظيم: اعرض فقط أكبر HOME_CATEGORY_ROWS_LIMIT تصنيفًا (بالعدد) —
    // الرئيسية تبقى قصيرة ومنظمة، والتصفح الكامل من شاشة التصنيفات.
    val categoryEntries = remember(channelsByCategory) {
        channelsByCategory.entries.toList()
            .sortedByDescending { it.value.size }
            .take(HOME_CATEGORY_ROWS_LIMIT)
    }
    val bannerChannels = remember(featuredChannels, channels) {
        featuredChannels.ifEmpty { channels.take(5) }
    }

    // Hero follows D-pad focus in the featured row, debounced so fast
    // scrubbing doesn't thrash image decodes. Defaults to the first
    // featured channel so the hero renders immediately.
    var focusedFeatured by remember(bannerChannels) { mutableStateOf(bannerChannels.firstOrNull()) }
    var heroChannel by remember(bannerChannels) { mutableStateOf(bannerChannels.firstOrNull()) }
    LaunchedEffect(focusedFeatured) {
        if (heroChannel != focusedFeatured) {
            delay(HERO_SWAP_DEBOUNCE_MS)
            heroChannel = focusedFeatured
        }
    }

    // Restore focus to the last played channel in exactly one section,
    // preferring the section closest to the top.
    val featuredFocusId = remember(lastPlayedChannelId, bannerChannels) {
        lastPlayedChannelId?.takeIf { id -> bannerChannels.any { it.id == id } }
    }
    val recentFocusId = remember(lastPlayedChannelId, featuredFocusId, recentlyWatched) {
        if (featuredFocusId != null) null
        else lastPlayedChannelId?.takeIf { id -> recentlyWatched.any { it.id == id } }
    }
    val categoryFocusId = if (featuredFocusId == null && recentFocusId == null) lastPlayedChannelId else null

    // Initial focus lands on "Watch now" so Home-load → OK starts playback.
    // Restoration to the last played channel (above) wins when it exists.
    val watchNowFocusRequester = remember { FocusRequester() }
    val hasRestoreTarget = remember(featuredFocusId, recentFocusId, categoryFocusId, channels) {
        featuredFocusId != null || recentFocusId != null ||
            (categoryFocusId != null && channels.any { it.id == categoryFocusId })
    }
    LaunchedEffect(hasRestoreTarget) {
        if (!hasRestoreTarget) runCatching { watchNowFocusRequester.requestFocus() }
    }

    // Stable entrance offset for category rows based on how many
    // optional sections are present (avoids mutable var during composition)
    val categoryRowOffset = remember(
        recentlyWatched.isNotEmpty(),
        forYou.isNotEmpty(),
        popularCategories.isNotEmpty()
    ) {
        var offset = 3 // Command deck + hero + featured row are always present
        if (recentlyWatched.isNotEmpty()) offset++
        if (forYou.isNotEmpty()) offset++
        if (popularCategories.isNotEmpty()) offset++
        offset
    }

    val listState = rememberLazyListState()

    LazyColumn(
        state = listState,
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = screenPaddingVertical)
    ) {
        if (isDemo) {
            item(key = "demo_banner") {
                DemoModeBanner(
                    modifier = Modifier
                        .padding(horizontal = horizontalPadding)
                        .padding(bottom = rowGap)
                )
            }
        }
        item(key = "command_deck") {
            HomeCommandDeck(
                channelCount = channels.size,
                favoriteCount = channels.count { it.isFavorite },
                onSearchClick = onNavigateToSearch,
                onLiveClick = { onNavigateToChannels("") },
                onGuideClick = onNavigateToGuide,
                onFavoritesClick = onNavigateToFavorites,
                modifier = Modifier
                    .padding(horizontal = horizontalPadding)
                    .padding(bottom = rowGap)
                    .animateItemEntrance(index = 0)
            )
        }
        item(key = "hero") {
            heroChannel?.let { hero ->
                HomeHero(
                    channel = hero,
                    onWatchNow = onChannelClick,
                    watchNowFocusRequester = watchNowFocusRequester,
                    modifier = Modifier
                        .padding(bottom = rowGap)
                        // requiredHeight overrides HomeHero's internal .height() so
                        // the phone hero shrinks; TV/landscape is left untouched.
                        .then(if (isCompact) Modifier.requiredHeight(compactHeroHeight) else Modifier)
                        .animateItemEntrance(index = 1)
                )
            }
        }

        item(key = "featured") {
            FeaturedRow(
                channels = bannerChannels,
                onChannelClick = onChannelClick,
                onToggleFavorite = onToggleFavorite,
                onMultiviewClick = onMultiviewClick,
                onChannelFocused = { focusedFeatured = it },
                focusChannelId = featuredFocusId,
                horizontalPadding = horizontalPadding,
                modifier = Modifier
                    .padding(bottom = rowGap)
                    .animateItemEntrance(index = 2)
            )
        }

        if (recentlyWatched.isNotEmpty()) {
            item(key = "recently_watched") {
                ChannelRow(
                    // Live re-tune shortcut — quick jump back to channels the
                    // user was just watching (never a resumed file position).
                    title = stringResource(R.string.home_recently_watched),
                    channels = recentlyWatched,
                    onChannelClick = onChannelClick,
                    onToggleFavorite = onToggleFavorite,
                    onMultiviewClick = onMultiviewClick,
                    focusChannelId = recentFocusId,
                    horizontalPadding = horizontalPadding,
                    modifier = Modifier
                        .padding(bottom = rowGap)
                        .animateItemEntrance(index = 3)
                )
            }
        }

        if (forYou.isNotEmpty()) {
            item(key = "for_you") {
                ChannelRow(
                    title = stringResource(R.string.home_for_you),
                    channels = forYou,
                    onChannelClick = onChannelClick,
                    onToggleFavorite = onToggleFavorite,
                    onMultiviewClick = onMultiviewClick,
                    focusChannelId = null,
                    horizontalPadding = horizontalPadding,
                    modifier = Modifier
                        .padding(bottom = rowGap)
                        .animateItemEntrance(index = if (recentlyWatched.isNotEmpty()) 4 else 3)
                )
            }
        }

        if (popularCategories.isNotEmpty()) {
            item(key = "popular_categories") {
                PopularCategoriesSlider(
                    categories = popularCategories,
                    onCategoryClick = onNavigateToChannels,
                    horizontalPadding = horizontalPadding,
                    modifier = Modifier
                        .padding(bottom = rowGap)
                        .animateItemEntrance(index = categoryRowOffset - 1)
                )
            }
        }

        itemsIndexed(
            items = categoryEntries,
            key = { _, entry -> "category_${entry.key}" }
        ) { index, (category, categoryChannels) ->
            val localizedCategory = CategoryLocalizer.localize(category)

            ChannelRow(
                title = localizedCategory,
                channels = categoryChannels,
                onChannelClick = onChannelClick,
                onToggleFavorite = onToggleFavorite,
                onMultiviewClick = onMultiviewClick,
                onSeeAllClick = { onNavigateToChannels(category) },
                focusChannelId = categoryFocusId,
                horizontalPadding = horizontalPadding,
                modifier = Modifier
                    .padding(bottom = rowGap)
                    .animateItemEntrance(index = categoryRowOffset + index)
            )
        }
    }
}

/** Skeleton matching the real home layout: full-bleed hero block, featured row, one channel row. */
@Composable
fun HomeSkeleton(modifier: Modifier = Modifier) {
    val configuration = LocalConfiguration.current
    val isPortrait = configuration.orientation == Configuration.ORIENTATION_PORTRAIT
    val isCompact = configuration.screenWidthDp < COMPACT_WIDTH_DP
    val horizontalPadding =
        if (isPortrait) Dimens.ScreenPaddingHorizontalMobile else Dimens.ScreenPaddingHorizontalTv
    val showShimmer = !LocalPerfProfile.current.reduceMotion
    val heroHeight = rememberHeroHeight()
    val (heroCardWidth, heroCardHeight) = rememberHeroCardSize()
    val cardWidth = if (isCompact) Dimens.ChannelCardWidthMobile else Dimens.ChannelCardWidthTv
    val cardHeight = if (isCompact) Dimens.ChannelCardHeightMobile else Dimens.ChannelCardHeightTv
    val rowGap = if (isCompact) Dimens.RowGapMobile else Dimens.RowGap
    val screenPaddingVertical =
        if (isCompact) Dimens.ScreenPaddingVerticalMobile else Dimens.ScreenPaddingVertical
    val shimmerBrush = if (showShimmer) rememberShimmerBrush() else null

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(vertical = screenPaddingVertical)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(heroHeight)
                .background(Void800)
        ) {
            if (shimmerBrush != null) {
                Box(modifier = Modifier.fillMaxSize().background(shimmerBrush))
            }
        }
        Column(modifier = Modifier.padding(horizontal = horizontalPadding)) {
            ChannelRowSkeleton(
                cardWidth = heroCardWidth,
                cardHeight = heroCardHeight,
                count = 4,
                showShimmer = showShimmer,
                modifier = Modifier.padding(top = rowGap, bottom = rowGap)
            )
            ChannelRowSkeleton(
                cardWidth = cardWidth,
                cardHeight = cardHeight,
                count = 6,
                showShimmer = showShimmer
            )
        }
    }
}
