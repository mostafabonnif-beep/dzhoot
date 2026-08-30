package com.dzhoof.iptv.presentation.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.dzhoof.iptv.presentation.ui.animation.DURATION_FAST
import com.dzhoof.iptv.presentation.ui.animation.EaseOutQuart
import com.dzhoof.iptv.presentation.ui.theme.DzGold400
import com.dzhoof.iptv.presentation.ui.theme.FocusBorder
import com.dzhoof.iptv.presentation.ui.theme.Void700
import com.dzhoof.iptv.presentation.ui.theme.Void800
import com.dzhoof.iptv.presentation.ui.theme.subtleBorder

/**
 * Portrait poster card (2:3) for movies/series rows. Uses the same TV focus
 * visuals (scale + brand glow + tonal depth) as channel cards so D-pad
 * navigation feels identical on Android TV.
 */
@Composable
fun CatalogPosterCard(
    title: String,
    subtitle: String,
    imageUrl: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var isFocused by remember { mutableStateOf(false) }
    val cardShape = RoundedCornerShape(14.dp)
    val cardBorder = when {
        isFocused -> BorderStroke(2.dp, FocusBorder)
        else -> BorderStroke(1.dp, subtleBorder)
    }
    val containerColor by animateColorAsState(
        targetValue = if (isFocused) Void700 else Void800,
        animationSpec = tween(DURATION_FAST, easing = EaseOutQuart),
        label = "posterCardContainer",
    )
    val baseModifier = modifier
        .tvFocusVisuals(focused = isFocused, shape = cardShape, glowColor = DzGold400)
        .onFocusChanged { isFocused = it.isFocused }

    Card(
        onClick = onClick,
        modifier = baseModifier,
        shape = cardShape,
        border = cardBorder,
        colors = CardDefaults.cardColors(containerColor = containerColor),
    ) {
        AsyncImage(
            model = imageUrl,
            contentDescription = title,
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(MaterialTheme.shapes.medium),
            contentScale = ContentScale.Crop,
        )
        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            Text(
                text = title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = subtitle,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
