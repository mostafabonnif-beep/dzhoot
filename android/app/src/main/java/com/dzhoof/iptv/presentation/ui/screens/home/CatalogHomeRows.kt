package com.dzhoof.iptv.presentation.ui.screens.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.model.CatalogPosterItem
import com.dzhoof.iptv.presentation.ui.components.CatalogPosterCard
import com.dzhoof.iptv.presentation.ui.components.SectionHeader
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.presentation.ui.theme.categoryColor

/**
 * Horizontal poster row for the home screen (movies/series). Mirrors
 * ChannelRow's focus behaviour so D-pad navigation works identically on TV.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
internal fun CatalogPosterRow(
    title: String,
    items: List<CatalogPosterItem>,
    onItemClick: (String) -> Unit,
    horizontalPadding: Dp,
    modifier: Modifier = Modifier,
    onSeeAllClick: (() -> Unit)? = null,
) {
    if (items.isEmpty()) return
    val isCompact = LocalConfiguration.current.screenWidthDp < 600
    val cardWidth = if (isCompact) 118.dp else 150.dp
    val titleGap = if (isCompact) Dimens.RowTitleGapMobile else Dimens.RowTitleGap
    val cardGap = if (isCompact) Dimens.CardGapMobile else Dimens.CardGap

    val rowState = rememberLazyListState()

    Column(modifier = modifier.padding(horizontal = horizontalPadding)) {
        SectionHeader(
            title = title,
            accentColor = categoryColor(title),
            onSeeAllClick = onSeeAllClick,
        )
        Spacer(modifier = Modifier.height(titleGap))
        LazyRow(
            state = rowState,
            modifier = Modifier.focusRestorer(),
            contentPadding = PaddingValues(vertical = if (isCompact) 4.dp else 12.dp),
            horizontalArrangement = Arrangement.spacedBy(cardGap),
        ) {
            items(items.size, key = { i -> items[i].key }) { i ->
                val item = items[i]
                CatalogPosterCard(
                    title = item.title,
                    subtitle = item.subtitle,
                    imageUrl = item.imageUrl,
                    onClick = { onItemClick(item.key) },
                    modifier = Modifier.width(cardWidth),
                )
            }
        }
    }
}
