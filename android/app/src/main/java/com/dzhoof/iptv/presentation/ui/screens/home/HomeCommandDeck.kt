package com.dzhoof.iptv.presentation.ui.screens.home

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.WifiTethering
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.ui.animation.DURATION_FAST
import com.dzhoof.iptv.presentation.ui.animation.EaseOutQuart
import com.dzhoof.iptv.presentation.ui.components.tvFocusVisuals
import com.dzhoof.iptv.presentation.ui.player.isTvDevice
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.presentation.ui.theme.DzRed400
import com.dzhoof.iptv.presentation.ui.theme.FocusBorder
import com.dzhoof.iptv.presentation.ui.theme.subtleBorder

private data class HomeCommand(
    val label: String,
    val description: String,
    val icon: ImageVector,
    val accent: Color,
    val onClick: () -> Unit
)

/**
 * High-frequency launch points for the browse landing page.
 *
 * The strip deliberately exposes the actions people need before they start
 * scrolling a catalog: searching, entering the live grid, opening the guide,
 * and returning to favourites. It is a horizontal rail on a phone and a fixed
 * command deck on TV, so neither form factor gets a desktop-style compromise.
 */
@Composable
internal fun HomeCommandDeck(
    channelCount: Int,
    favoriteCount: Int,
    onSearchClick: () -> Unit,
    onLiveClick: () -> Unit,
    onGuideClick: () -> Unit,
    onFavoritesClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val isTv = remember(context) { isTvDevice(context) }
    val isCompact = LocalConfiguration.current.screenWidthDp < COMPACT_WIDTH_DP
    val primary = MaterialTheme.colorScheme.primary
    val tertiary = MaterialTheme.colorScheme.tertiary
    val commands = remember(channelCount, favoriteCount, primary, tertiary) {
        listOf(
            HomeCommand(
                label = "البحث",
                description = "ابحث في القنوات والمحتوى",
                icon = Icons.Default.Search,
                accent = primary,
                onClick = onSearchClick
            ),
            HomeCommand(
                label = "البث المباشر",
                description = if (channelCount > 0) "$channelCount قناة جاهزة الآن" else "تصفح كل القنوات",
                icon = Icons.Default.WifiTethering,
                accent = DzRed400,
                onClick = onLiveClick
            ),
            HomeCommand(
                label = "دليل البرامج",
                description = "اعرف ما يُعرض الآن وبعد قليل",
                icon = Icons.Default.CalendarToday,
                accent = tertiary,
                onClick = onGuideClick
            ),
            HomeCommand(
                label = "مفضلتي",
                description = if (favoriteCount > 0) "$favoriteCount قناة محفوظة" else "احفظ قنواتك السريعة",
                icon = Icons.Default.Favorite,
                accent = DzRed400,
                onClick = onFavoritesClick
            )
        )
    }

    Column(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "بثك الآن",
                    style = if (isCompact) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                    fontWeight = FontWeight.ExtraBold
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = "كل ما تريد مشاهدته في مكان واحد",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Surface(
                shape = MaterialTheme.shapes.large,
                color = DzRed400.copy(alpha = 0.14f),
                border = androidx.compose.foundation.BorderStroke(1.dp, DzRed400.copy(alpha = 0.42f))
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(7.dp)
                            .clip(androidx.compose.foundation.shape.CircleShape)
                            .background(DzRed400)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "مباشر",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(if (isCompact) 14.dp else 18.dp))

        if (isTv) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Dimens.CardGap)
            ) {
                commands.forEach { command ->
                    HomeCommandCard(
                        command = command,
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        } else {
            LazyRow(
                contentPadding = PaddingValues(end = Dimens.ScreenPaddingHorizontalMobile),
                horizontalArrangement = Arrangement.spacedBy(Dimens.CardGapMobile)
            ) {
                items(commands, key = { it.label }) { command ->
                    HomeCommandCard(
                        command = command,
                        modifier = Modifier.width(188.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun HomeCommandCard(
    command: HomeCommand,
    modifier: Modifier = Modifier
) {
    var isFocused by remember { mutableStateOf(false) }
    val shape = MaterialTheme.shapes.large
    val container by animateColorAsState(
        targetValue = when {
            isFocused -> command.accent.copy(alpha = 0.19f)
            else -> MaterialTheme.colorScheme.surface.copy(alpha = 0.92f)
        },
        animationSpec = tween(DURATION_FAST, easing = EaseOutQuart),
        label = "commandCardColor"
    )

    Surface(
        color = container,
        shape = shape,
        border = androidx.compose.foundation.BorderStroke(
            if (isFocused) 2.dp else 1.dp,
            if (isFocused) FocusBorder else subtleBorder
        ),
        modifier = modifier
            .height(98.dp)
            .tvFocusVisuals(focused = isFocused, shape = shape, glowColor = command.accent)
            .onFocusChanged { isFocused = it.isFocused }
            .clickable(onClick = command.onClick)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                color = command.accent.copy(alpha = 0.16f),
                shape = MaterialTheme.shapes.medium
            ) {
                Icon(
                    imageVector = command.icon,
                    contentDescription = command.label,
                    tint = command.accent,
                    modifier = Modifier
                        .padding(10.dp)
                        .size(24.dp)
                )
            }
            Spacer(modifier = Modifier.width(11.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = command.label,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.height(3.dp))
                Text(
                    text = command.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}
