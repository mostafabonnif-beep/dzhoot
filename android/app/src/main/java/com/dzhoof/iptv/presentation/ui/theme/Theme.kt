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

/** Navigation-chrome background (side rail, drawers): dark Atlas900 / light Sand100. */
val navChromeBackground: Color
    @Composable get() = if (LocalIsDarkTheme.current) Atlas900 else Sand100

/** Theme-aware subtle border color: light white on dark, dark on light. */
val subtleBorder: Color
    @Composable get() = if (LocalIsDarkTheme.current) SubtleBorderDark else SubtleBorderLight

private val DarkColorScheme = darkColorScheme(
    // Primary — warm gold for the 10-foot TV focus language.
    primary = DzGold300,
    onPrimary = Ink950,
    primaryContainer = DzGold500,
    onPrimaryContainer = TextPrimaryDark,

    // Secondary — emerald remains available for health/online states.
    secondary = DzGreen400,
    onSecondary = DzGreen50,
    secondaryContainer = DzGreen500,
    onSecondaryContainer = DzGreen50,

    // Tertiary — gold supports secondary actions without competing with live red.
    tertiary = DzGold400,
    onTertiary = Ink950,
    tertiaryContainer = DzGold500,
    onTertiaryContainer = TextPrimaryDark,

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
    inversePrimary = DzGold500,

    // Scrim
    scrim = Atlas950,

    // Surface tint
    surfaceTint = DzGold300
)

private val LightColorScheme = lightColorScheme(
    // Primary — DzGreen500 (deep emerald, sufficient contrast on sand)
    primary = DzGreen500,
    onPrimary = Sand50,
    primaryContainer = DzGreen100,
    onPrimaryContainer = DzGreen700,

    // Secondary — emerald accent (DzGreen700, supports the primary)
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
