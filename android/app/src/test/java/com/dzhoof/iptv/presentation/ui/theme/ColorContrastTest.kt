package com.dzhoof.iptv.presentation.ui.theme

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * WCAG contrast regression guard for the LIGHT theme (handover item:
 * "light theme colors need contrast adjustment").
 *
 * Background is Sand50 (#F6F9F7). Thresholds:
 *   - normal text: 4.5:1
 *   - UI components / icons: 3:1
 * Disabled text is exempt from WCAG but kept readable (>2.8:1).
 *
 * Values are explicit ARGB constants that MUST stay in sync with Color.kt:
 *   Sand50 0xFFF6F9F7, TextPrimaryLight 0xFF14201A, TextSecondaryLight
 *   0xFF3E5A4C, TextDimLight 0xFF5F7268, Sand700 0xFF72867B,
 *   TextDisabledLight 0xFF87948C.
 * (They are duplicated here on purpose: the packed Color.value format is an
 * implementation detail of androidx.compose.ui.graphics.Color and is not
 * part of this test's contract.)
 */
class ColorContrastTest {

    private fun luminance(argb: Long): Double {
        fun chan(v: Int): Double {
            val s = v / 255.0
            return if (s <= 0.03928) s / 12.92 else Math.pow((s + 0.055) / 1.055, 2.4)
        }
        val r = chan(((argb shr 16) and 0xFF).toInt())
        val g = chan(((argb shr 8) and 0xFF).toInt())
        val b = chan((argb and 0xFF).toInt())
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    private fun contrast(a: Long, b: Long): Double {
        val la = luminance(a)
        val lb = luminance(b)
        val hi = maxOf(la, lb)
        val lo = minOf(la, lb)
        return (hi + 0.05) / (lo + 0.05)
    }

    private fun assertContrast(label: String, fg: Long, bg: Long, min: Double) {
        val c = contrast(fg, bg)
        assertTrue("$label must be >= $min:1 (was ${"%.2f".format(c)}:1)", c >= min)
    }

    @Test
    fun lightThemeTextMeetsWcagAA() {
        val sand50 = 0xFFF6F9F7L
        assertContrast("TextPrimaryLight on Sand50", 0xFF14201AL, sand50, 4.5)
        assertContrast("TextSecondaryLight on Sand50", 0xFF3E5A4CL, sand50, 4.5)
        assertContrast("TextDimLight on Sand50", 0xFF5F7268L, sand50, 4.5)
    }

    @Test
    fun lightThemeIconsMeet3to1() {
        assertContrast("Sand700 (icons/inactive) on Sand50", 0xFF72867BL, 0xFFF6F9F7L, 3.0)
    }

    @Test
    fun lightThemeDisabledTextStaysReadable() {
        assertContrast("TextDisabledLight on Sand50", 0xFF87948CL, 0xFFF6F9F7L, 2.8)
    }
}
