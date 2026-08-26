package com.dzhoof.iptv.presentation.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

// ── Corner token scale — modern rounded (الهوية الجزائرية) ────────────
val ShapeSmall  = RoundedCornerShape(8.dp)     // chips, badges, small buttons
val ShapeMedium = RoundedCornerShape(14.dp)    // cards, panels
val ShapeBadge  = RoundedCornerShape(16.dp)    // QR frames, image tiles, badges
val ShapeLarge  = RoundedCornerShape(20.dp)    // toasts, dialogs
val ShapePill   = RoundedCornerShape(32.dp)    // fully-rounded action pills / hero chips

// ── Material 3 shape mapping ─────────────────────────────────────────
val DzHoofShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = ShapeSmall,
    medium = ShapeMedium,
    large = ShapeLarge,
    extraLarge = RoundedCornerShape(28.dp)
)
