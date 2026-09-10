package com.dzhoof.iptv.presentation.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.luminance

/**
 * DzHoof signature backdrop — the app's branded surface.
 *
 * Layers (dark mode):
 *  1. deep ink base ([Ink950]) with a green-black cast,
 *  2. emerald glow bleeding in from the top-start corner,
 *  3. a soft gold diagonal "light streak" (the brand's signature band),
 *  4. a scatter of gold sparkles riding the streak.
 *
 * Light mode keeps only a whisper of warmth so content stays calm.
 *
 * Everything is painted in a single [drawBehind] pass — GPU-friendly, no
 * recomposition on frame draws, no extra composables in the tree.
 */
@Composable
fun DiagonalGradientBackground(
    modifier: Modifier = Modifier,
    darkTheme: Boolean = MaterialTheme.colorScheme.background.luminance() < 0.5f,
    content: @Composable BoxScope.() -> Unit
) {
    val baseColor = if (darkTheme) Ink950 else Sand50
    val emeraldGlow = if (darkTheme) ArtworkGlowEmerald else Color(0x0510B981)
    val goldGlow = if (darkTheme) ArtworkGlowGold else Color(0x04C9A44B)

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(baseColor)
            .drawBehind {
                drawBackdrop(size, darkTheme, emeraldGlow, goldGlow)
            },
        content = content
    )
}

/** Paints base glows, the diagonal gold streak and its sparkles. */
private fun DrawScope.drawBackdrop(
    size: Size,
    darkTheme: Boolean,
    emeraldGlow: Color,
    goldGlow: Color,
) {
    // 1 — emerald glow, top-start corner fading toward the centre.
    drawRect(
        brush = Brush.linearGradient(
            colors = listOf(emeraldGlow, Color.Transparent),
            start = Offset.Zero,
            end = Offset(size.width * 0.72f, size.height * 0.72f)
        )
    )

    // 2 — gold warmth pooling in the opposite corner.
    drawRect(
        brush = Brush.linearGradient(
            colors = listOf(Color.Transparent, goldGlow),
            start = Offset(size.width * 0.35f, size.height * 0.35f),
            end = Offset(size.width, size.height)
        )
    )

    // 3 — the signature diagonal gold streak (a soft band of light).
    rotate(degrees = -26f) {
        val bandWidth = size.width * 0.30f
        val bandLeft = size.width * 0.06f
        drawRect(
            brush = Brush.horizontalGradient(
                colors = listOf(
                    Color.Transparent,
                    ArtworkStreakGold,
                    Color.Transparent
                ),
                startX = bandLeft,
                endX = bandLeft + bandWidth
            ),
            topLeft = Offset(bandLeft, -size.height * 0.6f),
            size = Size(bandWidth, size.height * 2.2f)
        )
    }

    // 4 — sparkles riding the streak (deterministic, so no recomposition).
    if (darkTheme) {
        val sparkles = listOf(
            0.18f to 0.72f, 0.26f to 0.60f, 0.34f to 0.48f, 0.42f to 0.36f,
            0.50f to 0.24f, 0.30f to 0.80f, 0.58f to 0.66f, 0.66f to 0.52f
        )
        sparkles.forEachIndexed { index, (fx, fy) ->
            val radius = if (index % 3 == 0) size.minDimension * 0.004f
            else size.minDimension * 0.0022f
            drawCircle(
                color = if (index % 2 == 0) AccentGold.copy(alpha = 0.16f)
                else Color.White.copy(alpha = 0.10f),
                radius = radius,
                center = Offset(size.width * fx, size.height * fy)
            )
        }
    }
}
