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
import androidx.compose.ui.graphics.luminance

/**
 * DzHoof signature backdrop — a quiet, premium surface that keeps artwork and
 * content in focus. Dark mode uses restrained emerald and gold radial glows;
 * light mode stays neutral and calm.
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

/** Paints restrained radial glows and a lower-page scrim. */
private fun DrawScope.drawBackdrop(
    size: Size,
    darkTheme: Boolean,
    emeraldGlow: Color,
    goldGlow: Color,
) {
    drawRect(
        brush = Brush.radialGradient(
            colors = listOf(emeraldGlow, Color.Transparent),
            center = Offset(size.width * 0.12f, 0f),
            radius = size.width * 0.9f
        )
    )
    drawRect(
        brush = Brush.radialGradient(
            colors = listOf(goldGlow, Color.Transparent),
            center = Offset(size.width * 0.92f, size.height * 0.28f),
            radius = size.width * 0.85f
        )
    )
    if (darkTheme) {
        drawRect(
            brush = Brush.verticalGradient(
                colors = listOf(Color.Transparent, Ink950.copy(alpha = 0.34f)),
                startY = size.height * 0.42f,
                endY = size.height
            )
        )
    }
}
