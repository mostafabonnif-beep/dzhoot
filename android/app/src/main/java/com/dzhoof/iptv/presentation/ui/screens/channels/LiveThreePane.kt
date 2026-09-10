package com.dzhoof.iptv.presentation.ui.screens.channels

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.dzhoof.iptv.presentation.model.ChannelUiModel
import com.dzhoof.iptv.presentation.ui.components.EpgProgressBar
import com.dzhoof.iptv.presentation.ui.components.SelectableRow
import com.dzhoof.iptv.presentation.ui.components.tvFocusVisuals
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.presentation.ui.theme.FocusBorder
import com.dzhoof.iptv.presentation.ui.theme.ShapeMedium
import com.dzhoof.iptv.presentation.ui.theme.ShapeSmall
import com.dzhoof.iptv.presentation.ui.theme.OnVideo
import com.dzhoof.iptv.presentation.ui.theme.subtleBorder
import java.util.Locale

/**
 * The TV "Live" screen: three panes side by side, the layout viewers expect
 * from a professional IPTV box.
 *
 *  - left   : categories with channel counts,
 *  - centre : numbered channel rows (focus drives the preview),
 *  - right  : preview of the focused channel with now/next programme + actions.
 *
 * Focus never leaves the centre list into dead space: Up/Down move the
 * selection (and therefore the preview), OK plays, the action buttons on the
 * right are reachable with Right.
 */
@Composable
fun LiveThreePane(
    categories: List<String>,
    categoryCounts: Map<String, Int>,
    selectedCategory: String?,
    totalCount: Int,
    channels: List<ChannelUiModel>,
    selectedChannelId: String?,
    onCategorySelected: (String?) -> Unit,
    onChannelFocused: (ChannelUiModel) -> Unit,
    onChannelOpen: (String) -> Unit,
    onToggleFavorite: (String) -> Unit,
    onMultiviewClick: (String) -> Unit,
    onOpenGuide: () -> Unit,
    modifier: Modifier = Modifier
) {
    val categoryFocus = remember { FocusRequester() }
    val firstChannelFocus = remember { FocusRequester() }

    // Land focus on the list as soon as it has content (OK = play immediately).
    LaunchedEffect(channels.firstOrNull()?.id) {
        if (channels.isNotEmpty()) runCatching { firstChannelFocus.requestFocus() }
    }

    Row(modifier = modifier.fillMaxSize()) {
        LiveCategoryPane(
            categories = categories,
            counts = categoryCounts,
            selectedCategory = selectedCategory,
            totalCount = totalCount,
            onSelect = onCategorySelected,
            focusRequester = categoryFocus,
            modifier = Modifier
                .width(Dimens.LiveCategoryPaneWidth)
                .fillMaxHeight()
                .padding(
                    start = Dimens.ScreenPaddingHorizontalTv,
                    end = Dimens.Space3,
                    bottom = Dimens.Space5
                )
        )

        LiveChannelListPane(
            channels = channels,
            selectedChannelId = selectedChannelId,
            onFocused = onChannelFocused,
            onOpen = onChannelOpen,
            onToggleFavorite = onToggleFavorite,
            firstItemFocus = firstChannelFocus,
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight()
                .padding(end = Dimens.Space3)
        )

        val selected = channels.firstOrNull { it.id == selectedChannelId } ?: channels.firstOrNull()
        LivePreviewPane(
            channel = selected,
            onWatch = { selected?.let { onChannelOpen(it.id) } },
            onToggleFavorite = { selected?.let { onToggleFavorite(it.id) } },
            onMultiview = { selected?.let { onMultiviewClick(it.id) } },
            onOpenGuide = onOpenGuide,
            modifier = Modifier
                .width(Dimens.LivePreviewPaneWidth)
                .fillMaxHeight()
                .padding(end = Dimens.ScreenPaddingHorizontalTv, bottom = Dimens.Space5)
        )
    }
}

/** Left pane: category list with counts; the first row is "all channels". */
@Composable
private fun LiveCategoryPane(
    categories: List<String>,
    counts: Map<String, Int>,
    selectedCategory: String?,
    totalCount: Int,
    onSelect: (String?) -> Unit,
    focusRequester: FocusRequester,
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()
    val selectedIndex = if (selectedCategory == null) 0 else categories.indexOf(selectedCategory) + 1
    LaunchedEffect(selectedCategory, categories) {
        if (selectedIndex >= 0) runCatching { listState.animateScrollToItem(maxOf(0, selectedIndex - 2)) }
    }

    Column(modifier = modifier) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(Dimens.Space1)
        ) {
            item(key = "__all__") {
                CategoryRow(
                    label = "كل القنوات",
                    count = totalCount,
                    selected = selectedCategory == null,
                    onClick = { onSelect(null) },
                    focusRequester = focusRequester
                )
            }
            itemsIndexed(items = categories, key = { _, name -> name }) { _, name ->
                CategoryRow(
                    label = name,
                    count = counts[name] ?: 0,
                    selected = selectedCategory == name,
                    onClick = { onSelect(name) },
                    focusRequester = null
                )
            }
        }
    }
}

@Composable
private fun CategoryRow(
    label: String,
    count: Int,
    selected: Boolean,
    onClick: () -> Unit,
    focusRequester: FocusRequester?
) {
    Row(modifier = Modifier.fillMaxWidth()) {
        SelectableRow(
            label = "$label  ($count)",
            selected = selected,
            onClick = onClick,
            focusRequester = focusRequester,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

/** Centre pane: numbered channel rows; focus updates the preview pane. */
@Composable
private fun LiveChannelListPane(
    channels: List<ChannelUiModel>,
    selectedChannelId: String?,
    onFocused: (ChannelUiModel) -> Unit,
    onOpen: (String) -> Unit,
    onToggleFavorite: (String) -> Unit,
    firstItemFocus: FocusRequester,
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()
    LazyColumn(
        state = listState,
        modifier = modifier,
        contentPadding = PaddingValues(vertical = Dimens.Space2),
        verticalArrangement = Arrangement.spacedBy(Dimens.Space1)
    ) {
        itemsIndexed(items = channels, key = { _, channel -> channel.id }) { index, channel ->
            LiveChannelRow(
                number = index + 1,
                channel = channel,
                selected = channel.id == selectedChannelId,
                onFocus = { onFocused(channel) },
                onClick = { onOpen(channel.id) },
                onToggleFavorite = { onToggleFavorite(channel.id) },
                focusRequester = if (index == 0) firstItemFocus else null
            )
        }
    }
}

@Composable
private fun LiveChannelRow(
    number: Int,
    channel: ChannelUiModel,
    selected: Boolean,
    onFocus: () -> Unit,
    onClick: () -> Unit,
    onToggleFavorite: () -> Unit,
    focusRequester: FocusRequester?
) {
    var isFocused by remember { mutableStateOf(false) }
    val shape = MaterialTheme.shapes.small

    androidx.compose.material3.Card(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
            .tvFocusVisuals(focused = isFocused, shape = shape)
            .onFocusChanged {
                isFocused = it.isFocused
                if (it.isFocused) onFocus()
            },
        shape = shape,
        border = when {
            isFocused -> BorderStroke(2.dp, FocusBorder)
            selected -> BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.55f))
            else -> BorderStroke(1.dp, subtleBorder)
        },
        colors = androidx.compose.material3.CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.surfaceVariant
            else MaterialTheme.colorScheme.surface
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = Dimens.Space3, vertical = Dimens.Space2),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = String.format(Locale.US, "%03d", number),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.width(Dimens.LiveChannelNumberWidth)
            )
            ChannelLogo(url = channel.logoUrl, name = channel.name)
            Spacer(modifier = Modifier.width(Dimens.Space3))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = channel.name,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                channel.nowProgramTitle?.let { now ->
                    Text(
                        text = now,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            if (channel.isFavorite) {
                Icon(
                    imageVector = Icons.Filled.Favorite,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(Dimens.Space4)
                )
            }
        }
    }
}

@Composable
private fun ChannelLogo(url: String?, name: String) {
    Box(
        modifier = Modifier
            .size(Dimens.LiveChannelLogoSize)
            .clip(ShapeSmall)
            .background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center
    ) {
        if (url.isNullOrBlank()) {
            Icon(
                imageVector = Icons.Filled.Tv,
                contentDescription = name,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(Dimens.Space4)
            )
        } else {
            AsyncImage(
                model = url,
                contentDescription = name,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize()
            )
        }
    }
}

/** Right pane: what the focused channel is playing and what to do with it. */
@Composable
private fun LivePreviewPane(
    channel: ChannelUiModel?,
    onWatch: () -> Unit,
    onToggleFavorite: () -> Unit,
    onMultiview: () -> Unit,
    onOpenGuide: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(Dimens.LivePreviewArtHeight)
                .clip(ShapeMedium)
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center
        ) {
            if (channel == null) {
                Icon(
                    imageVector = Icons.Filled.Tv,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(Dimens.Space6)
                )
            } else {
                AsyncImage(
                    model = channel.logoUrl ?: channel.thumbnailPath,
                    contentDescription = channel.name,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(Dimens.Space4)
                )
            }
        }

        Spacer(modifier = Modifier.height(Dimens.Space3))

        Text(
            text = channel?.name ?: "—",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )

        Spacer(modifier = Modifier.height(Dimens.Space1))

        Text(
            text = channel?.category.orEmpty(),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )

        Spacer(modifier = Modifier.height(Dimens.Space3))

        // Now / next — the same EPG data the guide uses, surfaced where the
        // viewer is deciding what to watch.
        channel?.nowProgramTitle?.let { now ->
            Text(
                text = "الآن: $now",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            val start = channel.nowProgramStartMs
            val end = channel.nowProgramEndMs
            if (start != null && end != null && end > start) {
                Spacer(modifier = Modifier.height(Dimens.Space1))
                EpgProgressBar(startMs = start, endMs = end, modifier = Modifier.fillMaxWidth())
            }
            Spacer(modifier = Modifier.height(Dimens.Space2))
        }
        channel?.nextProgramTitle?.let { next ->
            Text(
                text = "التالي: $next",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }

        Spacer(modifier = Modifier.weight(1f))

        Button(
            onClick = onWatch,
            enabled = channel != null,
            shape = ShapeMedium,
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary
            ),
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(Dimens.Space4))
            Spacer(modifier = Modifier.width(Dimens.Space2))
            Text("شاهد الآن", fontWeight = FontWeight.SemiBold)
        }

        Spacer(modifier = Modifier.height(Dimens.Space2))

        Row(horizontalArrangement = Arrangement.spacedBy(Dimens.Space2)) {
            LiveAction(
                label = if (channel?.isFavorite == true) "في المفضلة" else "المفضلة",
                icon = Icons.Filled.Favorite,
                onClick = onToggleFavorite,
                enabled = channel != null,
                modifier = Modifier.weight(1f)
            )
            LiveAction(
                label = "متعدد",
                icon = Icons.Filled.GridView,
                onClick = onMultiview,
                enabled = channel != null,
                modifier = Modifier.weight(1f)
            )
        }

        Spacer(modifier = Modifier.height(Dimens.Space2))

        OutlinedButton(
            onClick = onOpenGuide,
            shape = ShapeMedium,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("دليل البرامج")
        }
    }
}

@Composable
private fun LiveAction(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    OutlinedButton(onClick = onClick, enabled = enabled, shape = ShapeMedium, modifier = modifier) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(Dimens.Space4))
        Spacer(modifier = Modifier.width(Dimens.Space1))
        Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Bottom hint bar — tells the viewer which remote key does what. */
@Composable
fun LiveHintBar(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(
                start = Dimens.ScreenPaddingHorizontalTv,
                end = Dimens.ScreenPaddingHorizontalTv,
                bottom = Dimens.Space3
            ),
        horizontalArrangement = Arrangement.spacedBy(Dimens.Space5),
        verticalAlignment = Alignment.CenterVertically
    ) {
        listOf(
            "OK" to "تشغيل",
            "MENU" to "مفضلة",
            "◀" to "رجوع"
        ).forEach { (key, action) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(OnVideo.copy(alpha = 0.10f))
                        .padding(horizontal = Dimens.Space2, vertical = 2.dp)
                ) {
                    Text(
                        text = key,
                        style = MaterialTheme.typography.labelSmall,
                        color = OnVideo.copy(alpha = 0.75f)
                    )
                }
                Spacer(modifier = Modifier.width(Dimens.Space1))
                Text(
                    text = action,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
