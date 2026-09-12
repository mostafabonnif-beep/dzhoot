package com.dzhoof.iptv.presentation.ui.screens.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.ui.components.tvFocusVisuals
import com.dzhoof.iptv.presentation.ui.theme.Atlas900
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.presentation.ui.theme.DzGold300
import com.dzhoof.iptv.presentation.ui.theme.DzGold500
import com.dzhoof.iptv.presentation.ui.theme.FocusBorder
import com.dzhoof.iptv.presentation.ui.theme.subtleBorder

/**
 * One branded entry point on the home portal.
 *
 * @param key stable id used by the click handler to route the navigation.
 * @param label Arabic tile title.
 * @param subtitle short supporting line (kept to one line by design).
 * @param icon large glyph shown at the tile's center.
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
 * The home "portal", styled after the NEO 4K launcher: a single large
 * hero tile for live TV on the left, a compact 2-column grid of the
 * remaining destinations beside it, all in the same gold-on-black brand
 * wash. Every destination is visible in one glance and reachable within
 * a few D-pad presses.
 */
@Composable
fun HomePortalTiles(
    tiles: List<PortalTile>,
    onTileClick: (String) -> Unit,
    horizontalPadding: Dp,
    isCompact: Boolean,
    modifier: Modifier = Modifier
) {
    if (tiles.isEmpty()) return

    if (isCompact) {
        // Phone: one thumb-scrollable row.
        LazyRow(
            modifier = modifier.fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = horizontalPadding),
            horizontalArrangement = Arrangement.spacedBy(Dimens.PortalTileGap)
        ) {
            items(items = tiles, key = { it.key }) { tile ->
                PortalTileCard(
                    tile = tile,
                    width = Dimens.PortalTileWidthMobile,
                    height = Dimens.PortalTileHeightMobile,
                    iconSize = Dimens.PortalIconSizeMobile,
                    onClick = { onTileClick(tile.key) }
                )
            }
        }
    } else {
        // TV: NEO 4K hero layout — the first tile (live TV) spans the full
        // portal height on the left, the remaining tiles sit in a two-column
        // grid on the right with identical widths so the row closes flush.
        BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
            val innerWidth = maxWidth - horizontalPadding * 2
            val heroWidth = ((innerWidth - Dimens.PortalTileGap * 2) / 3f)
                .coerceAtLeast(Dimens.PortalTileWidthMobile)
            val smallHeight = Dimens.PortalTileHeightTv
            val heroHeight = smallHeight * 2 + Dimens.PortalTileGap

            Row(
                horizontalArrangement = Arrangement.spacedBy(Dimens.PortalTileGap),
                modifier = Modifier
                    .padding(horizontal = horizontalPadding)
                    .padding(bottom = Dimens.PortalTileGap)
            ) {
                PortalTileCard(
                    tile = tiles.first(),
                    width = heroWidth,
                    height = heroHeight,
                    iconSize = Dimens.PortalIconSizeTv * 1.6f,
                    isHero = true,
                    onClick = { onTileClick(tiles.first().key) }
                )

                Column(
                    verticalArrangement = Arrangement.spacedBy(Dimens.PortalTileGap)
                ) {
                    tiles.drop(1).chunked(PORTAL_GRID_COLUMNS).forEach { rowTiles ->
                        Row(horizontalArrangement = Arrangement.spacedBy(Dimens.PortalTileGap)) {
                            rowTiles.forEach { tile ->
                                PortalTileCard(
                                    tile = tile,
                                    width = heroWidth,
                                    height = smallHeight,
                                    iconSize = Dimens.PortalIconSizeTv,
                                    onClick = { onTileClick(tile.key) }
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Two tiles per row beside the NEO hero tile. */
private const val PORTAL_GRID_COLUMNS = 2

@Composable
private fun PortalTileCard(
    tile: PortalTile,
    width: Dp,
    height: Dp,
    iconSize: Dp,
    onClick: () -> Unit,
    isHero: Boolean = false
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
        colors = CardDefaults.cardColors(containerColor = Atlas900)
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            // Gold wash — the NEO 4K launcher reads as one uniform gold-on-black
            // surface, so every tile shares the same brand gradient.
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                DzGold500.copy(alpha = if (isHero) 0.34f else 0.26f),
                                DzGold500.copy(alpha = 0.06f)
                            )
                        )
                    )
            )

            Icon(
                imageVector = tile.icon,
                contentDescription = null,
                tint = if (isFocused) DzGold300 else DzGold300.copy(alpha = 0.92f),
                modifier = Modifier
                    .align(Alignment.Center)
                    .offset(y = (-height * 0.10f))
                    .size(iconSize)
            )

            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = Dimens.Space3, start = Dimens.Space2, end = Dimens.Space2),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = tile.label,
                    style = if (isHero) MaterialTheme.typography.titleLarge else MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    textAlign = TextAlign.Center,
                    maxLines = 1
                )
            }
        }
    }
}
