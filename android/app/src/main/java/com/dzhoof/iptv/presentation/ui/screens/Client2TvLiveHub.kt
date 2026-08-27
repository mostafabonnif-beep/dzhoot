package com.dzhoof.iptv.presentation.ui.screens

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
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
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DividerDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.dzhoof.iptv.domain.model.ChannelHealthStatus
import com.dzhoof.iptv.presentation.model.ChannelUiModel
import com.dzhoof.iptv.presentation.model.ChannelsUiState
import com.dzhoof.iptv.presentation.ui.animation.DURATION_FAST
import com.dzhoof.iptv.presentation.ui.animation.EaseOutQuart
import com.dzhoof.iptv.presentation.ui.components.LiveBadge
import com.dzhoof.iptv.presentation.ui.components.tvFocusVisuals
import com.dzhoof.iptv.presentation.ui.theme.DzGreen300
import com.dzhoof.iptv.presentation.ui.theme.FocusBorder
import com.dzhoof.iptv.presentation.ui.theme.OnVideo
import com.dzhoof.iptv.presentation.ui.theme.Atlas700
import com.dzhoof.iptv.presentation.ui.theme.Atlas800
import com.dzhoof.iptv.presentation.ui.theme.categoryColor
import com.dzhoof.iptv.presentation.util.CategoryLocalizer

/**
 * Client 2.0 TV-first Live hub.
 *
 * This is a presentation-only layer over [ChannelsUiState]: categories, channel
 * playback, favourites, health and EPG remain supplied by the existing DZ HOOF
 * repositories and view model. The three-pane composition deliberately gives
 * Android TV a clear "where am I / what is selected / what will play" path.
 */
@Composable
internal fun Client2TvLiveHub(
    uiState: ChannelsUiState,
    onCategorySelected: (String?) -> Unit,
    onChannelClick: (String) -> Unit,
    onToggleFavorite: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var focusedChannelId by rememberSaveable { mutableStateOf<String?>(null) }
    val selectedChannel = uiState.channels.firstOrNull { it.id == focusedChannelId }
        ?: uiState.channels.firstOrNull()

    LaunchedEffect(uiState.selectedCategory, uiState.channels) {
        if (uiState.channels.none { it.id == focusedChannelId }) {
            focusedChannelId = uiState.channels.firstOrNull()?.id
        }
    }

    Row(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 28.dp, vertical = 22.dp),
        horizontalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Client2CategoryPane(
            categories = uiState.categories,
            selectedCategory = uiState.selectedCategory,
            onCategorySelected = onCategorySelected,
            modifier = Modifier
                .width(224.dp)
                .fillMaxHeight()
        )

        Client2ChannelPane(
            channels = uiState.channels,
            selectedChannelId = selectedChannel?.id,
            onChannelFocused = { focusedChannelId = it },
            onChannelClick = onChannelClick,
            modifier = Modifier
                .width(332.dp)
                .fillMaxHeight()
        )

        Client2SpotlightPane(
            channel = selectedChannel,
            categoryLabel = uiState.selectedCategory?.let(CategoryLocalizer::localize) ?: "كل القنوات",
            onPlay = { selectedChannel?.let { onChannelClick(it.id) } },
            onToggleFavorite = { selectedChannel?.let { onToggleFavorite(it.id) } },
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight()
        )
    }
}

@Composable
private fun Client2CategoryPane(
    categories: List<String>,
    selectedCategory: String?,
    onCategorySelected: (String?) -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.extraLarge,
        color = Atlas800.copy(alpha = 0.92f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f))
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp)
            ) {
                Surface(
                    shape = MaterialTheme.shapes.small,
                    color = DzGreen300.copy(alpha = 0.16f)
                ) {
                    Icon(
                        imageVector = Icons.Default.Tv,
                        contentDescription = null,
                        tint = DzGreen300,
                        modifier = Modifier.padding(8.dp)
                    )
                }
                Spacer(modifier = Modifier.width(10.dp))
                Column {
                    Text(
                        text = "البث المباشر",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "المجموعات",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            HorizontalDivider(
                modifier = Modifier.padding(vertical = 10.dp),
                color = DividerDefaults.color.copy(alpha = 0.45f)
            )
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .focusGroup(),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                contentPadding = PaddingValues(bottom = 8.dp)
            ) {
                item(key = "all") {
                    Client2CategoryItem(
                        label = "كل القنوات",
                        selected = selectedCategory == null,
                        onClick = { onCategorySelected(null) }
                    )
                }
                items(categories, key = { it }) { category ->
                    Client2CategoryItem(
                        label = CategoryLocalizer.localize(category),
                        selected = category == selectedCategory,
                        accent = categoryColor(category),
                        onClick = { onCategorySelected(category) }
                    )
                }
            }
        }
    }
}

@Composable
private fun Client2CategoryItem(
    label: String,
    selected: Boolean,
    accent: Color = DzGreen300,
    onClick: () -> Unit
) {
    var focused by remember { mutableStateOf(false) }
    val container by animateColorAsState(
        targetValue = when {
            focused -> accent
            selected -> accent.copy(alpha = 0.16f)
            else -> Color.Transparent
        },
        animationSpec = tween(DURATION_FAST, easing = EaseOutQuart),
        label = "client2CategoryColor"
    )
    val contentColor = if (focused) Color.Black else MaterialTheme.colorScheme.onSurface

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .tvFocusVisuals(focused = focused, shape = MaterialTheme.shapes.medium, glowColor = accent)
            .clip(MaterialTheme.shapes.medium)
            .background(container)
            .onFocusChanged { focused = it.isFocused }
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(if (selected || focused) 8.dp else 6.dp)
                .clip(MaterialTheme.shapes.small)
                .background(if (focused) Color.Black else accent)
        )
        Spacer(modifier = Modifier.width(10.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (selected || focused) FontWeight.Bold else FontWeight.Medium,
            color = contentColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
private fun Client2ChannelPane(
    channels: List<ChannelUiModel>,
    selectedChannelId: String?,
    onChannelFocused: (String) -> Unit,
    onChannelClick: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.extraLarge,
        color = Atlas800.copy(alpha = 0.9f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f))
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "القنوات",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f)
                )
                Surface(
                    shape = MaterialTheme.shapes.small,
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f)
                ) {
                    Text(
                        text = channels.size.toString(),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp)
                    )
                }
            }
            HorizontalDivider(
                modifier = Modifier.padding(vertical = 10.dp),
                color = DividerDefaults.color.copy(alpha = 0.45f)
            )
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .focusGroup(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(bottom = 8.dp)
            ) {
                items(channels, key = { it.id }) { channel ->
                    Client2ChannelRow(
                        channel = channel,
                        selected = channel.id == selectedChannelId,
                        onFocused = { onChannelFocused(channel.id) },
                        onClick = { onChannelClick(channel.id) }
                    )
                }
            }
        }
    }
}

@Composable
private fun Client2ChannelRow(
    channel: ChannelUiModel,
    selected: Boolean,
    onFocused: () -> Unit,
    onClick: () -> Unit
) {
    var focused by remember { mutableStateOf(false) }
    val accent = categoryColor(channel.category)
    val container by animateColorAsState(
        targetValue = when {
            focused -> Atlas700
            selected -> accent.copy(alpha = 0.12f)
            else -> MaterialTheme.colorScheme.surface.copy(alpha = 0.46f)
        },
        animationSpec = tween(DURATION_FAST, easing = EaseOutQuart),
        label = "client2ChannelRowColor"
    )
    val context = LocalContext.current

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .height(86.dp)
            .tvFocusVisuals(focused = focused, shape = MaterialTheme.shapes.large, glowColor = accent)
            .onFocusChanged {
                focused = it.isFocused
                if (it.isFocused) onFocused()
            }
            .clickable(onClick = onClick),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = container),
        border = BorderStroke(if (focused) 2.dp else 1.dp, if (focused) FocusBorder else MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f))
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                shape = MaterialTheme.shapes.medium,
                color = Color.Black.copy(alpha = 0.22f),
                modifier = Modifier.size(62.dp)
            ) {
                if (channel.logoUrl != null) {
                    AsyncImage(
                        model = ImageRequest.Builder(context).data(channel.logoUrl).build(),
                        contentDescription = null,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.padding(7.dp)
                    )
                } else {
                    Text(
                        text = channel.name.take(2).uppercase(),
                        modifier = Modifier.padding(12.dp),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.ExtraBold,
                        color = accent
                    )
                }
            }
            Spacer(modifier = Modifier.width(11.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = channel.name,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.height(3.dp))
                Text(
                    text = channel.nowProgramTitle ?: "لا توجد بيانات برنامج حالياً",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (channel.healthStatus == ChannelHealthStatus.ONLINE) {
                LiveBadge()
            }
        }
    }
}

@Composable
private fun Client2SpotlightPane(
    channel: ChannelUiModel?,
    categoryLabel: String,
    onPlay: () -> Unit,
    onToggleFavorite: () -> Unit,
    modifier: Modifier = Modifier
) {
    val accent = channel?.let { categoryColor(it.category) } ?: DzGreen300
    val context = LocalContext.current

    Card(
        modifier = modifier,
        shape = MaterialTheme.shapes.extraLarge,
        colors = CardDefaults.cardColors(containerColor = Atlas800.copy(alpha = 0.94f)),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f))
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        colors = listOf(accent.copy(alpha = 0.3f), Color.Transparent, Atlas800)
                    )
                )
        ) {
            if (channel == null) {
                Column(
                    modifier = Modifier
                        .align(Alignment.Center)
                        .padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Icon(
                        imageVector = Icons.Default.Tv,
                        contentDescription = null,
                        tint = accent,
                        modifier = Modifier.size(56.dp)
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text("اختر قناة للمعاينة", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        "ستظهر معلومات البث والبرنامج هنا",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(34.dp),
                    verticalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(
                            shape = MaterialTheme.shapes.small,
                            color = accent.copy(alpha = 0.18f)
                        ) {
                            Text(
                                text = categoryLabel,
                                style = MaterialTheme.typography.labelLarge,
                                color = accent,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 11.dp, vertical = 7.dp)
                            )
                        }
                        Spacer(modifier = Modifier.weight(1f))
                        IconButton(onClick = onToggleFavorite) {
                            Icon(
                                imageVector = Icons.Default.Favorite,
                                contentDescription = if (channel.isFavorite) "إزالة من المفضلة" else "إضافة إلى المفضلة",
                                tint = if (channel.isFavorite) accent else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                        Surface(
                            shape = MaterialTheme.shapes.extraLarge,
                            color = Color.Black.copy(alpha = 0.24f),
                            modifier = Modifier.size(176.dp)
                        ) {
                            if (channel.logoUrl != null) {
                                AsyncImage(
                                    model = ImageRequest.Builder(context).data(channel.logoUrl).build(),
                                    contentDescription = null,
                                    contentScale = ContentScale.Fit,
                                    modifier = Modifier.padding(24.dp)
                                )
                            } else {
                                Icon(
                                    imageVector = Icons.Default.Tv,
                                    contentDescription = null,
                                    tint = accent,
                                    modifier = Modifier.padding(52.dp)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(24.dp))
                        Text(
                            text = channel.name,
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.ExtraBold,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = channel.nowProgramTitle ?: "البث المباشر جاهز للتشغيل",
                            style = MaterialTheme.typography.titleMedium,
                            color = OnVideo.copy(alpha = 0.9f),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                        channel.nextProgramTitle?.let { next ->
                            Text(
                                text = "التالي: $next",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(top = 7.dp)
                            )
                        }
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = onPlay,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(58.dp),
                            shape = MaterialTheme.shapes.large
                        ) {
                            Icon(Icons.Default.PlayArrow, contentDescription = null)
                            Spacer(modifier = Modifier.width(9.dp))
                            Text("مشاهدة البث", fontWeight = FontWeight.Bold)
                        }
                        OutlinedButton(
                            onClick = onToggleFavorite,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp),
                            shape = MaterialTheme.shapes.large
                        ) {
                            Text(if (channel.isFavorite) "إزالة من المفضلة" else "إضافة إلى المفضلة")
                        }
                    }
                }
            }
        }
    }
}
