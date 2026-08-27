package com.dzhoof.iptv.presentation.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dzhoof.iptv.presentation.ui.theme.DzGreen300

/**
 * Phone-first DZ HOOF identity primitives.
 *
 * These values deliberately stay small and flat: the product identity is carried
 * by a single broadcast-cut silhouette, an emerald signal marker, and a strict
 * type hierarchy instead of competing gradients or decorative card treatments.
 */
object DzHoofMobileDesign {
    val PanelShape = CutCornerShape(
        topStart = 18.dp,
        topEnd = 4.dp,
        bottomEnd = 18.dp,
        bottomStart = 4.dp
    )
    val ControlShape = RoundedCornerShape(6.dp)
    val ContentPadding = 20.dp
    val PanelBorderAlpha = 0.32f
    val MutedBorderAlpha = 0.70f
}

/**
 * Consistent masthead for high-frequency phone destinations. Each screen gets
 * one compact DZ mark, a signal-style kicker, one title and one operational
 * subtitle; optional actions sit in the trailing slot without inventing a new
 * header layout.
 */
@Composable
fun DzHoofMobileMasthead(
    kicker: String,
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
    accentColor: Color = DzGreen300,
    markerLabel: String = "DZ",
    trailing: (@Composable RowScope.() -> Unit)? = null
) {
    Surface(
        shape = DzHoofMobileDesign.PanelShape,
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
        border = BorderStroke(
            1.dp,
            accentColor.copy(alpha = DzHoofMobileDesign.PanelBorderAlpha)
        ),
        modifier = modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Surface(
                shape = DzHoofMobileDesign.ControlShape,
                color = accentColor.copy(alpha = 0.14f),
                border = BorderStroke(1.dp, accentColor.copy(alpha = 0.35f)),
                modifier = Modifier.size(46.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = markerLabel,
                        color = accentColor,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.ExtraBold,
                        letterSpacing = 0.3.sp
                    )
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = kicker,
                    style = MaterialTheme.typography.labelMedium,
                    color = accentColor,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 0.45.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.ExtraBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (trailing != null) {
                trailing()
            }
        }
    }
}

/** A title hierarchy shared by mobile shelves, lists and category blocks. */
@Composable
fun DzHoofMobileSectionHeading(
    title: String,
    modifier: Modifier = Modifier,
    kicker: String? = null,
    onSeeAllClick: (() -> Unit)? = null
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Bottom
    ) {
        Column(modifier = Modifier.weight(1f)) {
            kicker?.takeIf { it.isNotBlank() }?.let { label ->
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelMedium,
                    color = DzGreen300,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.25.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.height(2.dp))
            }
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onBackground,
                fontWeight = FontWeight.ExtraBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        if (onSeeAllClick != null) {
            TextButton(onClick = onSeeAllClick) {
                Text(
                    text = "عرض الكل",
                    style = MaterialTheme.typography.labelLarge,
                    color = DzGreen300,
                    fontWeight = FontWeight.Bold
                )
            }
        }
    }
}

/** Compact, accessible filter control shared by catalogue-like phone screens. */
@Composable
fun DzHoofMobileFilterChip(
    label: String,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val accent = DzGreen300
    Surface(
        onClick = onClick,
        shape = DzHoofMobileDesign.ControlShape,
        color = if (active) accent.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            1.dp,
            if (active) accent else MaterialTheme.colorScheme.outlineVariant.copy(
                alpha = DzHoofMobileDesign.MutedBorderAlpha
            )
        ),
        modifier = modifier
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = if (active) accent else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp)
        )
    }
}
