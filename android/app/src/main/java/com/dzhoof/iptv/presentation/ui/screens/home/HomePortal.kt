package com.dzhoof.iptv.presentation.ui.screens.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.ui.components.tvFocusVisuals
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.presentation.ui.theme.FocusBorder
import com.dzhoof.iptv.presentation.ui.theme.subtleBorder

/**
 * One branded entry point on the home portal.
 *
 * @param key stable id used by the click handler to route the navigation.
 * @param label Arabic tile title.
 * @param subtitle short supporting line (kept to one line by design).
 * @param icon large glyph shown at the tile's end.
 * @param accent per-tile wash colour (brand palette only).
 */
data class PortalTile(
    val key: String,
    val label: String,
    val subtitle: String?,
    val icon: ImageVector,
    val accent: Color
)

/**
 * The home "portal": a single row of large, branded tiles that give the
 * screen an immediate, couch-readable identity — the five things a viewer
 * actually wants (live, movies, series, favourites, guide) instead of a wall
 * of rows. Tiles reuse the app-wide focus language ([tvFocusVisuals] + the
 * gold [FocusBorder] ring) so the portal never introduces a new cue.
 */
@Composable
fun HomePortalRow(
    tiles: List<PortalTile>,
    onTileClick: (String) -> Unit,
    horizontalPadding: Dp,
    isCompact: Boolean,
    modifier: Modifier = Modifier
) {
    if (tiles.isEmpty()) return
    val width = if (isCompact) Dimens.PortalTileWidthMobile else Dimens.PortalTileWidthTv
    val height = if (isCompact) Dimens.PortalTileHeightMobile else Dimens.PortalTileHeightTv
    val iconSize = if (isCompact) Dimens.PortalIconSizeMobile else Dimens.PortalIconSizeTv

    LazyRow(
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = horizontalPadding),
        horizontalArrangement = Arrangement.spacedBy(Dimens.PortalTileGap)
    ) {
        items(items = tiles, key = { it.key }) { tile ->
            PortalTileCard(
                tile = tile,
                width = width,
                height = height,
                iconSize = iconSize,
                onClick = { onTileClick(tile.key) }
            )
        }
    }
}

@Composable
private fun PortalTileCard(
    tile: PortalTile,
    width: Dp,
    height: Dp,
    iconSize: Dp,
    onClick: () -> Unit
) {
    var isFocused by remember { mutableStateOf(false) }

    Card(
        onClick = onClick,
        modifier = Modifier
            .width(width)
            .height(height)
            .tvFocusVisuals(focused = isFocused, shape = MaterialTheme.shapes.large)
            .onFocusChanged { isFocused = it.isFocused },
        shape = MaterialTheme.shapes.large,
        border = if (isFocused) BorderStroke(2.dp, FocusBorder) else BorderStroke(1.dp, subtleBorder),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            // Accent wash — gives every tile a distinct but on-brand identity.
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.linearGradient(
                            colors = listOf(
                                tile.accent.copy(alpha = 0.55f),
                                tile.accent.copy(alpha = 0.10f)
                            )
                        )
                    )
            )

            Icon(
                imageVector = tile.icon,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.95f),
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = Dimens.Space4)
                    .size(iconSize)
            )

            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(Dimens.Space4)
            ) {
                Text(
                    text = tile.label,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    maxLines = 1
                )
                tile.subtitle?.let { subtitle ->
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.labelMedium,
                        color = Color.White.copy(alpha = 0.78f),
                        maxLines = 1
                    )
                }
            }
        }
    }
}
