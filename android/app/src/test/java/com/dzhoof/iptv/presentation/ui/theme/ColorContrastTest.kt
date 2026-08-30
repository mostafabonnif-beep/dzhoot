package com.dzhoof.iptv.presentation.ui.theme

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * WCAG contrast regression guard for the LIGHT theme (handover item:
 * "light theme colors need contrast adjustment").
 *
 * Backgrounds are Sand50 (#F6F9F7). Thresholds:
 *   - normal text: 4.5:1
 *   - UI components / icons: 3:1
 * Disabled text is exempt from WCAG but kept readable (>2.8:1).
 */
class ColorContrastTest {

    private fun luminance(c: Long): Double {
        fun chan(v: Int): Double {
            val s = v / 255.0
            return if (s <= 0.03928) s / 12.92 else Math.pow((s + 0.055) / 1.055, 2.4)
        }
        val r = chan(((c shr 16) and 0xFF).toInt())
        val g = chan(((c shr 8) and 0xFF).toInt())
        val b = chan((c and 0xFF).toInt())
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    private fun contrast(a: Long, b: Long): Double {
        val la = luminance(a)
        val lb = luminance(b)
        val hi = maxOf(la, lb)
        val lo = minOf(la, lb)
        return (hi + 0.05) / (lo + 0.05)
    }

    @Test
    fun lightThemeTextMeetsWcagAA() {
        // Primary text on the light background.
        assertTrue(
            "TextPrimaryLight on Sand50 must be >= 4.5:1",
            contrast(TextPrimaryLight.value.toLong(), Sand50.value.toLong()) >= 4.5,
        )
        // Secondary/dim text (body, captions).
        assertTrue(
            "TextSecondaryLight on Sand50 must be >= 4.5:1",
            contrast(TextSecondaryLight.value.toLong(), Sand50.value.toLong()) >= 4.5,
        )
        assertTrue(
            "TextDimLight on Sand50 must be >= 4.5:1",
            contrast(TextDimLight.value.toLong(), Sand50.value.toLong()) >= 4.5,
        )
    }

    @Test
    fun lightThemeIconsMeet3to1() {
        assertTrue(
            "Sand700 (icons/inactive) on Sand50 must be >= 3:1",
            contrast(Sand700.value.toLong(), Sand50.value.toLong()) >= 3.0,
        )
    }

    @Test
    fun lightThemeDisabledTextStaysReadable() {
        assertTrue(
            "TextDisabledLight on Sand50 must be >= 2.8:1",
            contrast(TextDisabledLight.value.toLong(), Sand50.value.toLong()) >= 2.8,
        )
    }
}
