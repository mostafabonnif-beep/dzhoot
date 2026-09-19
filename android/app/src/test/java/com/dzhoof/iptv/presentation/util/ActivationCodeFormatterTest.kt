package com.dzhoof.iptv.presentation.util

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Guards the activation-code formatter.
 *
 * The field that uses this also has to pin the caret to the end (see
 * ActivationScreen): the formatter rewrites the whole string, so a stale
 * selection offset makes Compose commit the next character *before* the
 * previous one. On Android TV that turned the valid code
 * `DZHF-K4TT-SPC6-KXXG` into the non-existent `DZHF-K4TT-SPC6-XKXG`, and the
 * server correctly rejected it — a valid code reported as invalid.
 */
class ActivationCodeFormatterTest {

    @Test
    fun `keeps a canonical code untouched`() {
        assertEquals("DZHF-K4TT-SPC6-KXXG", normalizeActivationCodeInput("DZHF-K4TT-SPC6-KXXG"))
    }

    @Test
    fun `accepts the compact form the user types and regroups it`() {
        assertEquals("DZHF-K4TT-SPC6-KXXG", normalizeActivationCodeInput("DZHFK4TTSPC6KXXG"))
    }

    @Test
    fun `never transposes the final group`() {
        // The exact production incident: the compact code must round-trip to the
        // canonical grouping with the last group intact.
        assertEquals("DZHF-K4TT-SPC6-KXXG", normalizeActivationCodeInput("DZHFK4TTSPC6KXXG"))
    }

    @Test
    fun `lowercases are upper-cased`() {
        assertEquals("ABCD-1234", normalizeActivationCodeInput("abcd1234"))
    }

    @Test
    fun `separators and stray characters are dropped`() {
        assertEquals("ABCD-1234", normalizeActivationCodeInput(" A B-C_D 1234 "))
    }

    @Test
    fun `groups of four with a trailing partial group`() {
        assertEquals("ABCD-1", normalizeActivationCodeInput("ABCD1"))
        assertEquals("ABCD-12", normalizeActivationCodeInput("ABCD12"))
        assertEquals("ABCD-123", normalizeActivationCodeInput("ABCD123"))
        assertEquals("ABCD-1234", normalizeActivationCodeInput("ABCD1234"))
        assertEquals("ABCD-1234-5", normalizeActivationCodeInput("ABCD12345"))
    }

    @Test
    fun `caps at 16 significant characters`() {
        assertEquals("ABCD-1234-5678-9ABC", normalizeActivationCodeInput("ABCD123456789ABCXXXX"))
    }

    @Test
    fun `empty input stays empty`() {
        assertEquals("", normalizeActivationCodeInput(""))
        assertEquals("", normalizeActivationCodeInput("----"))
    }

    @Test
    fun `is idempotent so re-formatting a formatted value is safe`() {
        val once = normalizeActivationCodeInput("DZHFK4TTSPC6KXXG")
        assertEquals(once, normalizeActivationCodeInput(once))
    }
}
