package com.dzhoof.iptv.presentation.ui.theme

import android.content.res.Configuration
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration

/** Composition local to expose whether DzHoofTheme is in dark mode. */
val LocalIsDarkTheme = compositionLocalOf { true }

/** Theme-aware subtle border color: light white on dark, dark on light. */
val subtleBorder: Color
    @Composable get() = if (LocalIsDarkTheme.current) SubtleBorderDark else SubtleBorderLight

private val DarkColorScheme = darkColorScheme(
    // Primary — DzGreen300 (bright amber, high contrast on void surfaces)
    primary = DzGreen300,
    onPrimary = DzGreen700,
    primaryContainer = DzGreen400,
    onPrimaryContainer = DzGreen50,

    // Secondary — warm accent (DzGreen400, complementary to primary)
    secondary = DzGreen400,
    onSecondary = DzGreen50,
    secondaryContainer = DzGreen500,
    onSecondaryContainer = DzGreen50,

    // Tertiary — DzGreen100 for subtle accent
    tertiary = DzGreen100,
    onTertiary = DzGreen700,
    tertiaryContainer = DzGreen400,
    onTertiaryContainer = DzGreen50,

    // Background — Atlas950
    background = Atlas950,
    onBackground = TextPrimaryDark,

    // Surface — Atlas800
    surface = Atlas800,
    onSurface = TextPrimaryDark,
    surfaceVariant = Atlas700,
    onSurfaceVariant = TextSecondaryDark,

    // Error
    error = ErrorDark,
    onError = Color(0xFF1A0404),
    errorContainer = Color(0xFF5C0A0A),
    onErrorContainer = Color(0xFFFFC4C4),

    // Outline
    outline = Atlas600,
    outlineVariant = Atlas700,

    // Inverse
    inverseSurface = Sand200,
    inverseOnSurface = TextPrimaryLight,
    inversePrimary = DzGreen500,

    // Scrim
    scrim = Atlas950,

    // Surface tint
    surfaceTint = DzGreen300
)

private val LightColorScheme = lightColorScheme(
    // Primary — DzGreen500 (deep amber, sufficient contrast on parchment)
    primary = DzGreen500,
    onPrimary = Sand50,
    primaryContainer = DzGreen100,
    onPrimaryContainer = DzGreen700,

    // Secondary — warm accent (DzGreen700, complementary to primary)
    secondary = DzGreen700,
    onSecondary = Sand50,
    secondaryContainer = DzGreen100,
    onSecondaryContainer = DzGreen700,

    // Tertiary — DzGreen400
    tertiary = DzGreen400,
    onTertiary = Sand50,
    tertiaryContainer = DzGreen50,
    onTertiaryContainer = DzGreen700,

    // Background — Sand50
    background = Sand50,
    onBackground = TextPrimaryLight,

    // Surface — Sand200
    surface = Sand200,
    onSurface = TextPrimaryLight,
    surfaceVariant = Sand300,
    onSurfaceVariant = TextSecondaryLight,

    // Error
    error = ErrorLight,
    onError = Sand50,
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF5C0000),

    // Outline
    outline = Sand500,
    outlineVariant = Sand300,

    // Inverse
    inverseSurface = Atlas800,
    inverseOnSurface = TextPrimaryDark,
    inversePrimary = DzGreen300,

    // Scrim
    scrim = Atlas950,

    // Surface tint
    surfaceTint = DzGreen500
)

@Composable
fun DzHoofTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    // Phone (compact/portrait) surfaces use a scaled-down type ramp; TV
    // (large-screen/landscape) keeps the full-size scale unchanged.
    val configuration = LocalConfiguration.current
    val isCompact = configuration.screenWidthDp < 600
    val isPortrait = configuration.orientation == Configuration.ORIENTATION_PORTRAIT
    val typography = if (isCompact || isPortrait) DzHoofTypographyMobile else DzHoofTypography

    CompositionLocalProvider(LocalIsDarkTheme provides darkTheme) {
        MaterialTheme(
            colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme,
            typography = typography,
            shapes = DzHoofShapes,
            content = content
        )
    }
}
