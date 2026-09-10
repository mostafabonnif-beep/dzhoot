package com.dzhoof.iptv.presentation.ui.screens.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import com.dzhoof.iptv.R
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.model.ChannelUiModel
import com.dzhoof.iptv.presentation.model.PopularCategoryUiModel
import com.dzhoof.iptv.presentation.model.SportsMatchUiModel
import com.dzhoof.iptv.presentation.ui.components.CategoryCard
import com.dzhoof.iptv.presentation.ui.components.ChannelCard
import com.dzhoof.iptv.presentation.ui.components.tvFocusVisuals
import com.dzhoof.iptv.presentation.ui.components.SectionHeader
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.presentation.ui.theme.FocusBorder
import com.dzhoof.iptv.presentation.ui.theme.categoryColor
import com.dzhoof.iptv.presentation.ui.theme.subtleBorder
import com.dzhoof.iptv.presentation.util.CategoryLocalizer

internal const val COMPACT_WIDTH_DP = 600

/** Responsive featured card size: fraction of screen width, clamped per form factor. */
@Composable
internal fun rememberHeroCardSize(): Pair<Dp, Dp> {
    val screenWidthDp = LocalConfiguration.current.screenWidthDp
    return remember(screenWidthDp) {
        val screenWidth = screenWidthDp.dp
        val width = if (screenWidthDp < COMPACT_WIDTH_DP) {
            (screenWidth * 0.42f).coerceIn(140.dp, 220.dp)
        } else {
            (screenWidth * 0.22f).coerceIn(200.dp, 320.dp)
        }
        width to (width * 0.6f).coerceIn(90.dp, 192.dp)
    }
}

/**
 * Featured channel row beneath the hero. Focusing a card hoists it via
 * [onChannelFocused] so the hero backdrop follows D-pad browsing.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
internal fun FeaturedRow(
    channels: List<ChannelUiModel>,
    onChannelClick: (String) -> Unit,
    onToggleFavorite: (String) -> Unit,
    onMultiviewClick: (String) -> Unit,
    onChannelFocused: (ChannelUiModel) -> Unit,
    focusChannelId: String?,
    horizontalPadding: Dp,
    modifier: Modifier = Modifier
) {
    val isCompact = LocalConfiguration.current.screenWidthDp < COMPACT_WIDTH_DP
    val titleGap = if (isCompact) Dimens.RowTitleGapMobile else Dimens.RowTitleGap
    val cardGap = if (isCompact) Dimens.HeroCardGapMobile else Dimens.HeroCardGap
    val (cardWidth, cardHeight) = rememberHeroCardSize()
    val rowState = rememberLazyListState()
    val focusRequester = remember { FocusRequester() }
    val focusIndex = remember(focusChannelId, channels) {
        channels.indexOfFirst { it.id == focusChannelId }
    }

    LaunchedEffect(focusIndex) {
        if (focusIndex >= 0) {
            rowState.scrollToItem(focusIndex)
            runCatching { focusRequester.requestFocus() }
        }
    }

    Column(modifier = modifier.padding(horizontal = horizontalPadding)) {
        SectionHeader(
            title = stringResource(R.string.home_featured),
            accentColor = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.height(titleGap))
        LazyRow(
            state = rowState,
            modifier = Modifier.focusRestorer(),
            // Vertical room so a focused card's scale-up + glow isn't clipped by the row.
            contentPadding = PaddingValues(vertical = if (isCompact) Dimens.Space1 else 12.dp),
            horizontalArrangement = Arrangement.spacedBy(cardGap)
        ) {
            items(channels.size, key = { i -> "$i:${channels[i].id}" }) { i ->
                val channel = channels[i]
                ChannelCard(
                    channel = channel,
                    onClick = { onChannelClick(channel.id) },
                    onFavoriteClick = { onToggleFavorite(channel.id) },
                    onMultiviewClick = { onMultiviewClick(channel.id) },
                    modifier = Modifier
                        .width(cardWidth)
                        .height(cardHeight)
                        .onFocusChanged { if (it.isFocused) onChannelFocused(channel) }
                        .then(
                            if (channel.id == focusChannelId) Modifier.focusRequester(focusRequester)
                            else Modifier
                        )
                )
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
internal fun PopularCategoriesSlider(
    categories: List<PopularCategoryUiModel>,
    onCategoryClick: (String) -> Unit,
    horizontalPadding: Dp,
    modifier: Modifier = Modifier
) {
    val isCompact = LocalConfiguration.current.screenWidthDp < COMPACT_WIDTH_DP
    val cardWidth = if (isCompact) Dimens.CategoryCardWidthMobile else Dimens.CategoryCardWidthTv
    val cardHeight = if (isCompact) Dimens.CategoryCardHeightMobile else Dimens.CategoryCardHeightTv
    val titleGap = if (isCompact) Dimens.RowTitleGapMobile else Dimens.RowTitleGap

    Column(modifier = modifier.padding(horizontal = horizontalPadding)) {
        SectionHeader(
            title = stringResource(R.string.home_popular_categories),
            accentColor = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.height(titleGap))
        LazyRow(
            state = rememberLazyListState(),
            modifier = Modifier.focusRestorer(),
            contentPadding = PaddingValues(vertical = if (isCompact) Dimens.Space1 else 12.dp),
            horizontalArrangement = Arrangement.spacedBy(Dimens.CategoryCardGap)
        ) {
            items(categories, key = { it.name }) { category ->
                CategoryCard(
                    // `name` stays raw (it's the LazyRow key + navigation arg);
                    // localize only what the user sees.
                    name = CategoryLocalizer.localize(category.name),
                    channelCount = category.channelCount,
                    imageUrl = category.imageUrl,
                    isFavorite = category.isFavorite,
                    onClick = { onCategoryClick(category.name) },
                    subtitle = stringResource(R.string.home_live_count, category.channelCount),
                    modifier = Modifier
                        .width(cardWidth)
                        .height(cardHeight)
                )
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
internal fun ChannelRow(
    title: String,
    channels: List<ChannelUiModel>,
    onChannelClick: (String) -> Unit,
    onToggleFavorite: (String) -> Unit,
    onMultiviewClick: (String) -> Unit,
    focusChannelId: String?,
    horizontalPadding: Dp,
    modifier: Modifier = Modifier,
    onSeeAllClick: (() -> Unit)? = null
) {
    val isCompact = LocalConfiguration.current.screenWidthDp < COMPACT_WIDTH_DP
    val cardWidth = if (isCompact) Dimens.ChannelCardWidthMobile else Dimens.ChannelCardWidthTv
    val cardHeight = if (isCompact) Dimens.ChannelCardHeightMobile else Dimens.ChannelCardHeightTv
    val titleGap = if (isCompact) Dimens.RowTitleGapMobile else Dimens.RowTitleGap
    val cardGap = if (isCompact) Dimens.CardGapMobile else Dimens.CardGap

    val rowState = rememberLazyListState()
    val focusRequester = remember { FocusRequester() }
    val focusIndex = remember(focusChannelId, channels) {
        channels.indexOfFirst { it.id == focusChannelId }
    }

    LaunchedEffect(focusIndex) {
        if (focusIndex >= 0) {
            rowState.scrollToItem(focusIndex)
            runCatching { focusRequester.requestFocus() }
        }
    }

    Column(modifier = modifier.padding(horizontal = horizontalPadding)) {
        SectionHeader(
            title = title,
            accentColor = categoryColor(title),
            onSeeAllClick = onSeeAllClick
        )
        Spacer(modifier = Modifier.height(titleGap))
        LazyRow(
            state = rowState,
            modifier = Modifier.focusRestorer(),
            contentPadding = PaddingValues(vertical = if (isCompact) Dimens.Space1 else 12.dp),
            horizontalArrangement = Arrangement.spacedBy(cardGap)
        ) {
            items(channels.size, key = { i -> "$i:${channels[i].id}" }) { i ->
                val channel = channels[i]
                ChannelCard(
                    channel = channel,
                    onClick = { onChannelClick(channel.id) },
                    onFavoriteClick = { onToggleFavorite(channel.id) },
                    onMultiviewClick = { onMultiviewClick(channel.id) },
                    modifier = Modifier
                        .width(cardWidth)
                        .height(cardHeight)
                        .then(
                            if (channel.id == focusChannelId) Modifier.focusRequester(focusRequester)
                            else Modifier
                        )
                )
            }
        }
    }
}

/**
 * "مباريات اليوم" — today's live/upcoming sports matches from the server EPG.
 * Tapping a card tunes straight to the catalog channel carrying the match.
 * The row is hidden entirely when there is nothing to show.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
internal fun SportsMatchesRow(
    matches: List<SportsMatchUiModel>,
    onMatchClick: (String) -> Unit,
    horizontalPadding: Dp,
    modifier: Modifier = Modifier
) {
    val isCompact = LocalConfiguration.current.screenWidthDp < COMPACT_WIDTH_DP
    val cardWidth = if (isCompact) 168.dp else 240.dp
    val cardHeight = if (isCompact) 96.dp else 116.dp
    val titleGap = if (isCompact) Dimens.RowTitleGapMobile else Dimens.RowTitleGap
    val cardGap = if (isCompact) Dimens.CardGapMobile else Dimens.CardGap

    Column(modifier = modifier.padding(horizontal = horizontalPadding)) {
        SectionHeader(
            title = stringResource(R.string.home_matches_today),
            accentColor = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.height(titleGap))
        LazyRow(
            state = rememberLazyListState(),
            modifier = Modifier.focusRestorer(),
            contentPadding = PaddingValues(vertical = if (isCompact) Dimens.Space1 else 12.dp),
            horizontalArrangement = Arrangement.spacedBy(cardGap)
        ) {
            items(matches.size, key = { i -> "${matches[i].channelId}:${matches[i].startEpochMs}" }) { i ->
                SportsMatchCard(
                    match = matches[i],
                    onClick = { onMatchClick(matches[i].channelId) },
                    modifier = Modifier
                        .width(cardWidth)
                        .height(cardHeight)
                )
            }
        }
    }
}

/** Compact schedule card: kickoff/LIVE badge + teams, channel name at the foot. */
@Composable
private fun SportsMatchCard(
    match: SportsMatchUiModel,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    var isFocused by remember { mutableStateOf(false) }

    Card(
        onClick = onClick,
        modifier = modifier
            .tvFocusVisuals(focused = isFocused, shape = MaterialTheme.shapes.medium)
            .onFocusChanged { isFocused = it.isFocused },
        shape = MaterialTheme.shapes.medium,
        border = if (isFocused) {
            BorderStroke(2.dp, FocusBorder)
        } else {
            BorderStroke(1.dp, subtleBorder)
        },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(
            modifier = Modifier
                .fillMaxHeight()
                .padding(horizontal = 12.dp, vertical = 10.dp)
        ) {
            if (match.isLive) {
                LiveBadge()
            } else {
                Text(
                    text = match.timeLabel,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = match.title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(modifier = Modifier.weight(1f))
            match.channelName?.let { channelName ->
                Text(
                    text = channelName,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/** Red "مباشر" pill shown while the match is already on air. */
@Composable
private fun LiveBadge(modifier: Modifier = Modifier) {
    val liveColor = Color(0xFFE53935)
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .width(8.dp)
                .height(8.dp)
                .background(liveColor, CircleShape)
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = stringResource(R.string.match_live_badge),
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            color = liveColor
        )
    }
}
