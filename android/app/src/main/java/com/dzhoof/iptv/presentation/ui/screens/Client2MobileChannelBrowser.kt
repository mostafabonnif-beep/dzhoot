package com.dzhoof.iptv.presentation.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.dzhoof.iptv.presentation.model.ChannelUiModel
import com.dzhoof.iptv.presentation.ui.theme.DzGreen300
import com.dzhoof.iptv.presentation.ui.theme.DzRed400
import com.dzhoof.iptv.presentation.ui.theme.categoryColor
import com.dzhoof.iptv.presentation.ui.theme.categoryIcon
import com.dzhoof.iptv.presentation.util.CategoryLocalizer
import com.dzhoof.iptv.presentation.util.ChannelCollectionOrganizer

private val BrowserPanelShape = CutCornerShape(
    topStart = 16.dp,
    topEnd = 4.dp,
    bottomEnd = 16.dp,
    bottomStart = 4.dp
)
private val BrowserControlShape = RoundedCornerShape(5.dp)

/**
 * Phone-first live channel browser. It deliberately avoids poster-style channel
 * grids: a live service is scanned faster as a numbered operational list.
 */
@Composable
internal fun Client2MobileChannelBrowser(
    channels: List<ChannelUiModel>,
    categories: List<String>,
    selectedCategory: String?,
    onCategorySelected: (String?) -> Unit,
    onChannelClick: (String) -> Unit,
    onToggleFavorite: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val selectedTitle = selectedCategory?.let {
        ChannelCollectionOrganizer.titleFor(it) ?: CategoryLocalizer.localize(it)
    } ?: "كل القنوات"

    LazyColumn(
        modifier = modifier.fillMaxHeight(),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 26.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item(key = "browser_header") {
            Column {
                Text(
                    text = "DZ HOOF / CHANNELS",
                    style = MaterialTheme.typography.labelMedium,
                    color = DzGreen300,
                    fontWeight = FontWeight.ExtraBold
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = selectedTitle,
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                    fontWeight = FontWeight.ExtraBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.height(7.dp))
                Text(
                    text = "${channels.size} قناة جاهزة للمشاهدة",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        item(key = "browser_filters") {
            Client2ChannelFilters(
                categories = categories,
                selectedCategory = selectedCategory,
                onCategorySelected = onCategorySelected
            )
        }

        item(key = "browser_divider") {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Box(modifier = Modifier.width(28.dp).height(2.dp).background(DzGreen300))
                Text(
                    text = "البث المباشر",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.Bold
                )
            }
        }

        items(channels, key = { it.id }) { channel ->
            Client2MobileChannelRow(
                channel = channel,
                onClick = { onChannelClick(channel.id) },
                onFavoriteClick = { onToggleFavorite(channel.id) }
            )
        }
    }
}

@Composable
private fun Client2ChannelFilters(
    categories: List<String>,
    selectedCategory: String?,
    onCategorySelected: (String?) -> Unit,
    modifier: Modifier = Modifier
) {
    LazyRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(end = 20.dp)
    ) {
        item(key = "all") {
            BrowserFilter(
                label = "الكل",
                active = selectedCategory == null,
                onClick = { onCategorySelected(null) }
            )
        }
        items(categories, key = { it }) { category ->
            BrowserFilter(
                label = ChannelCollectionOrganizer.titleFor(category) ?: CategoryLocalizer.localize(category),
                active = selectedCategory == category,
                onClick = { onCategorySelected(category) }
            )
        }
    }
}

@Composable
private fun BrowserFilter(
    label: String,
    active: Boolean,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        shape = BrowserControlShape,
        color = if (active) DzGreen300.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            1.dp,
            if (active) DzGreen300 else MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.70f)
        )
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = if (active) DzGreen300 else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp)
        )
    }
}

@Composable
private fun Client2MobileChannelRow(
    channel: ChannelUiModel,
    onClick: () -> Unit,
    onFavoriteClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val accent = categoryColor(channel.category)
    val title = channel.name
        .replace(Regex("^\\s*#+\\s*"), "")
        .replace(Regex("\\s+"), " ")
        .trim()
        .ifBlank { "قناة مباشرة" }
    val programme = channel.nowProgramTitle
        ?.replace(Regex("\\s+"), " ")
        ?.trim()
        ?.takeIf { it.isNotBlank() }
        ?: CategoryLocalizer.localize(channel.category).ifBlank { "بث مباشر" }

    Surface(
        onClick = onClick,
        shape = BrowserPanelShape,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, accent.copy(alpha = 0.32f)),
        modifier = modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(82.dp)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .width(3.dp)
                    .height(52.dp)
                    .background(accent)
            )
            Spacer(modifier = Modifier.width(9.dp))
            Surface(
                shape = BrowserControlShape,
                color = Color.White.copy(alpha = 0.95f),
                modifier = Modifier.size(54.dp)
            ) {
                if (channel.logoUrl != null) {
                    AsyncImage(
                        model = ImageRequest.Builder(context).data(channel.logoUrl).crossfade(true).build(),
                        contentDescription = title,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.padding(6.dp)
                    )
                } else {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = categoryIcon(channel.category),
                            contentDescription = null,
                            tint = accent,
                            modifier = Modifier.size(24.dp)
                        )
                    }
                }
            }
            Spacer(modifier = Modifier.width(11.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.ExtraBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = programme,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Surface(
                onClick = onFavoriteClick,
                shape = BrowserControlShape,
                color = if (channel.isFavorite) DzRed400.copy(alpha = 0.14f) else Color.Transparent,
                modifier = Modifier.size(38.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = if (channel.isFavorite) Icons.Default.Favorite else Icons.Default.PlayArrow,
                        contentDescription = if (channel.isFavorite) "إزالة من المفضلة" else "تشغيل",
                        tint = if (channel.isFavorite) DzRed400 else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }
    }
}
