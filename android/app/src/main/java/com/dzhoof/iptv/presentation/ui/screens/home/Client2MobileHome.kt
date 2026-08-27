package com.dzhoof.iptv.presentation.ui.screens.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.dzhoof.iptv.presentation.model.ChannelUiModel
import com.dzhoof.iptv.presentation.model.PopularCategoryUiModel
import com.dzhoof.iptv.presentation.ui.components.DemoModeBanner
import com.dzhoof.iptv.presentation.ui.theme.DzGreen300
import com.dzhoof.iptv.presentation.ui.theme.DzGreen400
import com.dzhoof.iptv.presentation.ui.theme.DzRed400
import com.dzhoof.iptv.presentation.ui.theme.categoryColor
import com.dzhoof.iptv.presentation.ui.theme.categoryIcon
import com.dzhoof.iptv.presentation.util.CategoryLocalizer

/**
 * Phone-first Client 2.0 landing experience.
 *
 * This deliberately does not reuse the TV hero, the old command cards, or the
 * generic horizontal channel rails. On a phone, Live TV should read as a quick
 * "what can I watch now?" surface: a single live lead, thumb-reachable actions,
 * clear category pills, and compact vertical channel lists with real programme
 * metadata.
 */
@Composable
internal fun Client2MobileHome(
    channels: List<ChannelUiModel>,
    featuredChannels: List<ChannelUiModel>,
    recentlyWatched: List<ChannelUiModel>,
    forYou: List<ChannelUiModel>,
    popularCategories: List<PopularCategoryUiModel>,
    onChannelClick: (String) -> Unit,
    onNavigateToChannels: (String) -> Unit,
    onNavigateToSearch: () -> Unit,
    onNavigateToGuide: () -> Unit,
    onNavigateToFavorites: () -> Unit,
    onToggleFavorite: (String) -> Unit,
    isDemo: Boolean,
    modifier: Modifier = Modifier
) {
    val leadChannel = remember(featuredChannels, channels) {
        (featuredChannels + channels).firstOrNull()
    }
    val nowPlaying = remember(featuredChannels, recentlyWatched, forYou, channels) {
        (featuredChannels + recentlyWatched + forYou + channels)
            .distinctBy { it.id }
            .take(8)
    }
    val personalized = remember(forYou, recentlyWatched, featuredChannels) {
        (forYou + recentlyWatched + featuredChannels)
            .distinctBy { it.id }
            .take(4)
    }
    val categories = remember(popularCategories, channels) {
        if (popularCategories.isNotEmpty()) {
            popularCategories
                .sortedByDescending { it.channelCount }
                .take(10)
                .map { MobileCategory(it.name, it.channelCount) }
        } else {
            channels.groupBy { it.category.trim() }
                .filterKeys { it.isNotBlank() }
                .entries
                .sortedByDescending { it.value.size }
                .take(10)
                .map { MobileCategory(it.key, it.value.size) }
        }
    }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 30.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp)
    ) {
        if (isDemo) {
            item(key = "demo_banner") {
                DemoModeBanner()
            }
        }

        item(key = "mobile_identity") {
            MobileHomeIdentity(
                channelCount = channels.size,
                onSearchClick = onNavigateToSearch
            )
        }

        leadChannel?.let { channel ->
            item(key = "mobile_live_lead_${channel.id}") {
                MobileLiveLeadCard(
                    channel = channel,
                    onWatch = { onChannelClick(channel.id) }
                )
            }
        }

        item(key = "mobile_shortcuts") {
            MobileShortcutRow(
                onLiveClick = { onNavigateToChannels("") },
                onGuideClick = onNavigateToGuide,
                onFavoritesClick = onNavigateToFavorites
            )
        }

        if (categories.isNotEmpty()) {
            item(key = "mobile_categories") {
                MobileCategoryShelf(
                    categories = categories,
                    onCategoryClick = onNavigateToChannels
                )
            }
        }

        if (nowPlaying.isNotEmpty()) {
            item(key = "mobile_now_playing") {
                MobileChannelListSection(
                    eyebrow = "اختر بسرعة",
                    title = "يبث الآن",
                    channels = nowPlaying,
                    onChannelClick = onChannelClick,
                    onToggleFavorite = onToggleFavorite,
                    onSeeAllClick = { onNavigateToChannels("") }
                )
            }
        }

        if (personalized.isNotEmpty()) {
            item(key = "mobile_personalized") {
                MobileChannelListSection(
                    eyebrow = "لك",
                    title = if (recentlyWatched.isNotEmpty()) "أكمل المشاهدة" else "اختيارات مقترحة",
                    channels = personalized,
                    onChannelClick = onChannelClick,
                    onToggleFavorite = onToggleFavorite,
                    onSeeAllClick = { onNavigateToChannels("") }
                )
            }
        }
    }
}

private data class MobileCategory(val name: String, val channelCount: Int)

@Composable
private fun MobileHomeIdentity(
    channelCount: Int,
    onSearchClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "منصة البث",
                style = MaterialTheme.typography.labelLarge,
                color = DzGreen300,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "شاهد ما يهمك الآن",
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onBackground,
                fontWeight = FontWeight.ExtraBold
            )
            Spacer(modifier = Modifier.height(5.dp))
            Text(
                text = if (channelCount > 0) "$channelCount قناة مرتبة لك" else "قنواتك ستظهر هنا فور جاهزيتها",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Surface(
            onClick = onSearchClick,
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.65f)),
            modifier = Modifier.size(52.dp)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = Icons.Default.Search,
                    contentDescription = "بحث",
                    tint = DzGreen300,
                    modifier = Modifier.size(25.dp)
                )
            }
        }
    }
}

@Composable
private fun MobileLiveLeadCard(
    channel: ChannelUiModel,
    onWatch: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val accent = categoryColor(channel.category)
    val cleanName = cleanChannelTitle(channel.name)
    val category = CategoryLocalizer.localize(channel.category).takeIf { it.isNotBlank() }

    Surface(
        onClick = onWatch,
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.extraLarge,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
        modifier = modifier.fillMaxWidth()
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(220.dp)
                .background(
                    Brush.linearGradient(
                        colors = listOf(
                            MaterialTheme.colorScheme.surface,
                            accent.copy(alpha = 0.16f),
                            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.72f)
                        )
                    )
                )
        ) {
            Icon(
                imageVector = categoryIcon(channel.category),
                contentDescription = null,
                tint = accent.copy(alpha = 0.10f),
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = 16.dp)
                    .size(172.dp)
            )

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(20.dp),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(
                        color = DzRed400.copy(alpha = 0.14f),
                        shape = MaterialTheme.shapes.small
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(7.dp)
                                    .clip(MaterialTheme.shapes.extraSmall)
                                    .background(DzRed400)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "مباشر الآن",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                    category?.let {
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = it,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }

                Column(modifier = Modifier.fillMaxWidth(0.78f)) {
                    channel.logoUrl?.let { logo ->
                        Surface(
                            color = Color.White.copy(alpha = 0.94f),
                            shape = MaterialTheme.shapes.medium,
                            modifier = Modifier.size(52.dp)
                        ) {
                            AsyncImage(
                                model = ImageRequest.Builder(context).data(logo).crossfade(true).build(),
                                contentDescription = cleanName,
                                contentScale = ContentScale.Fit,
                                modifier = Modifier.padding(6.dp)
                            )
                        }
                        Spacer(modifier = Modifier.height(10.dp))
                    }
                    Text(
                        text = cleanName,
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.ExtraBold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = channel.nowProgramTitle?.let { "يعرض الآن: ${cleanChannelTitle(it)}" } ?: "البث متاح للمشاهدة الآن",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                Button(
                    onClick = onWatch,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = DzGreen400,
                        contentColor = Color(0xFF052015)
                    ),
                    contentPadding = PaddingValues(horizontal = 17.dp, vertical = 10.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.PlayArrow,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(5.dp))
                    Text(text = "ابدأ المشاهدة", fontWeight = FontWeight.ExtraBold)
                }
            }
        }
    }
}

@Composable
private fun MobileShortcutRow(
    onLiveClick: () -> Unit,
    onGuideClick: () -> Unit,
    onFavoritesClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        MobileShortcut(
            label = "القنوات",
            icon = Icons.Default.LiveTv,
            tint = DzGreen300,
            onClick = onLiveClick,
            modifier = Modifier.weight(1f)
        )
        MobileShortcut(
            label = "الدليل",
            icon = Icons.Default.CalendarToday,
            tint = MaterialTheme.colorScheme.tertiary,
            onClick = onGuideClick,
            modifier = Modifier.weight(1f)
        )
        MobileShortcut(
            label = "المفضلة",
            icon = Icons.Default.Favorite,
            tint = DzRed400,
            onClick = onFavoritesClick,
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
private fun MobileShortcut(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    tint: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        onClick = onClick,
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.large,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.52f)),
        modifier = modifier.height(82.dp)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(imageVector = icon, contentDescription = label, tint = tint, modifier = Modifier.size(24.dp))
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.Bold,
                maxLines = 1
            )
        }
    }
}

@Composable
private fun MobileCategoryShelf(
    categories: List<MobileCategory>,
    onCategoryClick: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        MobileSectionTitle(eyebrow = "استكشف", title = "تصفح حسب الفئة")
        Spacer(modifier = Modifier.height(12.dp))
        LazyRow(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            items(categories, key = { it.name }) { category ->
                val tint = categoryColor(category.name)
                Surface(
                    onClick = { onCategoryClick(category.name) },
                    color = tint.copy(alpha = 0.10f),
                    shape = MaterialTheme.shapes.large,
                    border = BorderStroke(1.dp, tint.copy(alpha = 0.25f))
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = categoryIcon(category.name),
                            contentDescription = null,
                            tint = tint,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(7.dp))
                        Text(
                            text = CategoryLocalizer.localize(category.name),
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.onSurface,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = category.channelCount.toString(),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MobileChannelListSection(
    eyebrow: String,
    title: String,
    channels: List<ChannelUiModel>,
    onChannelClick: (String) -> Unit,
    onToggleFavorite: (String) -> Unit,
    onSeeAllClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            MobileSectionTitle(eyebrow = eyebrow, title = title)
            Text(
                text = "عرض الكل",
                style = MaterialTheme.typography.labelLarge,
                color = DzGreen300,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.clickable(onClick = onSeeAllClick)
            )
        }
        Spacer(modifier = Modifier.height(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            channels.forEach { channel ->
                MobileChannelListItem(
                    channel = channel,
                    onClick = { onChannelClick(channel.id) },
                    onFavoriteClick = { onToggleFavorite(channel.id) }
                )
            }
        }
    }
}

@Composable
private fun MobileSectionTitle(eyebrow: String, title: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        Text(
            text = eyebrow,
            style = MaterialTheme.typography.labelMedium,
            color = DzGreen300,
            fontWeight = FontWeight.Bold
        )
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onBackground,
            fontWeight = FontWeight.ExtraBold
        )
    }
}

@Composable
private fun MobileChannelListItem(
    channel: ChannelUiModel,
    onClick: () -> Unit,
    onFavoriteClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val accent = categoryColor(channel.category)
    val cleanName = cleanChannelTitle(channel.name)

    Surface(
        onClick = onClick,
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.large,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.48f)),
        modifier = modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(84.dp)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                color = Color.White.copy(alpha = 0.95f),
                shape = MaterialTheme.shapes.medium,
                modifier = Modifier.size(58.dp)
            ) {
                if (channel.logoUrl != null) {
                    AsyncImage(
                        model = ImageRequest.Builder(context).data(channel.logoUrl).crossfade(true).build(),
                        contentDescription = cleanName,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.padding(7.dp)
                    )
                } else {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = categoryIcon(channel.category),
                            contentDescription = null,
                            tint = accent,
                            modifier = Modifier.size(25.dp)
                        )
                    }
                }
            }
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = cleanName,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = channel.nowProgramTitle?.let { cleanChannelTitle(it) }
                        ?: CategoryLocalizer.localize(channel.category).ifBlank { "بث مباشر" },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Surface(
                onClick = onFavoriteClick,
                color = if (channel.isFavorite) DzRed400.copy(alpha = 0.14f) else Color.Transparent,
                shape = MaterialTheme.shapes.medium,
                modifier = Modifier.size(40.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Default.Favorite,
                        contentDescription = if (channel.isFavorite) "إزالة من المفضلة" else "إضافة إلى المفضلة",
                        tint = if (channel.isFavorite) DzRed400 else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(21.dp)
                    )
                }
            }
        }
    }
}

private fun cleanChannelTitle(value: String): String = value
    .replace(Regex("^\\s*#+\\s*"), "")
    .replace(Regex("\\s+"), " ")
    .trim()
    .ifBlank { "قناة مباشرة" }
