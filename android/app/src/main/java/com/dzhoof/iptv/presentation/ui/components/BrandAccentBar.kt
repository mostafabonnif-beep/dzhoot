package com.dzhoof.iptv.presentation.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.presentation.ui.theme.DzGold400

/**
 * The single brand accent bar that sits before a title — screen headers and
 * section headers share this exact component and size, so the "accent bar"
 * role has one implementation and one look (it used to be two: a 3dp solid
 * bar for screens and a 5dp gradient pill for sections).
 *
 * Bar size/gap come from [Dimens]; the fill is the brand green-to-gold
 * vertical gradient built from the caller's accent colour.
 */
@Composable
fun BrandAccentBar(
    modifier: Modifier = Modifier,
    accentColor: Color = MaterialTheme.colorScheme.primary
) {
    Box(
        modifier = modifier
            .width(Dimens.HeaderAccentBarWidth)
            .height(Dimens.HeaderAccentBarHeight)
            .clip(MaterialTheme.shapes.extraSmall)
            .background(Brush.verticalGradient(listOf(accentColor, DzGold400)))
    )
}
