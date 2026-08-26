package com.dzhoof.iptv.presentation.ui.components

import android.view.KeyEvent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.dzhoof.iptv.presentation.ui.animation.DURATION_NORMAL
import com.dzhoof.iptv.presentation.ui.animation.EaseOutQuart
import com.dzhoof.iptv.presentation.ui.theme.*

/**
 * Shared category card with thumbnail background, gradient, icon, and name.
 * Used by both HomeScreen (horizontal row) and CategoriesScreen (grid).
 */
@Composable
fun CategoryCard(
    name: String,
    channelCount: Int,
    imageUrl: String?,
    isFavorite: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String = "$channelCount " + if (channelCount == 1) "قناة" else "قناة",
    onToggleFavorite: (() -> Unit)? = null
) {
    var isFocused by remember { mutableStateOf(false) }
    var longPressHandled by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(
        targetValue = 1f, // no size change on focus — border is the cue
        animationSpec = tween(durationMillis = DURATION_NORMAL, easing = EaseOutQuart),
        label = "categoryScale"
    )
    val catColor = categoryColor(name)
    val catIcon = categoryIcon(name)

    Card(
        onClick = {
            if (!longPressHandled) onClick()
            longPressHandled = false
        },
        modifier = modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .onFocusChanged { isFocused = it.isFocused }
            .then(
                if (onToggleFavorite != null) {
                    Modifier.onKeyEvent { keyEvent ->
                        if (keyEvent.nativeKeyEvent.action != KeyEvent.ACTION_DOWN) return@onKeyEvent false
                        when (keyEvent.nativeKeyEvent.keyCode) {
                            KeyEvent.KEYCODE_MENU,
                            KeyEvent.KEYCODE_BOOKMARK -> {
                                onToggleFavorite()
                                true
                            }
                            KeyEvent.KEYCODE_DPAD_CENTER,
                            KeyEvent.KEYCODE_ENTER -> {
                                if (keyEvent.nativeKeyEvent.isLongPress) {
                                    longPressHandled = true
                                    onToggleFavorite()
                                    true
                                } else false
                            }
                            else -> false
                        }
                    }
                } else Modifier
            ),
        shape = MaterialTheme.shapes.medium,
        border = when {
            isFocused -> BorderStroke(2.dp, FocusBorder)
            else -> BorderStroke(1.dp, subtleBorder)
        },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
            // Icon tracks the card's height so it reads at the same visual
            // weight on the small home-row cards and the taller grid cards.
            val iconSize = (maxHeight * Dimens.CategoryIconHeightFraction)
                .coerceIn(Dimens.CategoryIconMin, Dimens.CategoryIconMax)
            // Color gradient background
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                catColor.copy(alpha = 0.62f),
                                catColor.copy(alpha = 0.28f)
                            )
                        )
                    )
            )

            // Background image overlay
            if (imageUrl != null) {
                val context = LocalContext.current
                val density = LocalDensity.current
                val (targetWidthPx, targetHeightPx) = remember(density) {
                    with(density) { 240.dp.roundToPx() to 140.dp.roundToPx() }
                }
                AsyncImage(
                    model = remember(imageUrl) {
                        ImageRequest.Builder(context)
                            .data(imageUrl)
                            .size(targetWidthPx, targetHeightPx)
                            .build()
                    },
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    placeholder = remember { ColorPainter(Void800) },
                    modifier = Modifier
                        .fillMaxSize()
                        .alpha(0.24f)
                )
            }

            // Category icon — كبير ومركزي بلون أبيض (ستايل الموك-أب)
            Icon(
                imageVector = catIcon,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.92f),
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = 18.dp)
                    .size(iconSize * 1.35f)
            )

            // Accent line at top
            Box(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .fillMaxWidth()
                    .height(3.dp)
                    .background(Color.White.copy(alpha = 0.35f))
            )

            // Count badge — أعلى اليمين (ستايل الموك-أب)
            Row(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(Dimens.CardContentPadding)
                    .clip(RoundedCornerShape(50))
                    .background(Color.White.copy(alpha = 0.22f))
                    .padding(horizontal = 8.dp, vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "$channelCount قناة",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White,
                    maxLines = 1
                )
            }

            // Favorite badge — bottom-right, matching the channel card
            if (isFavorite) {
                Icon(
                    imageVector = Icons.Filled.Favorite,
                    contentDescription = "Favorite",
                    tint = DzRed400,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(Dimens.CardContentPadding)
                        .padding(bottom = Dimens.CardBadgeBaselineNudge)
                        .size(Dimens.IconSmall)
                )
            }

            // "Hold to favorite" hint when focused
            if (onToggleFavorite != null && isFocused && !isFavorite) {
                Text(
                    text = "اضغط مطولًا لإضافتها للمفضلة",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp)
                )
            }

            // Text content — bottom; end inset keeps the name clear of the heart
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(12.dp)
                    .padding(end = Dimens.Space6),
                verticalArrangement = Arrangement.Bottom
            ) {
                Text(
                    text = name,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White.copy(alpha = 0.85f)
                )
            }
        }
    }
}
