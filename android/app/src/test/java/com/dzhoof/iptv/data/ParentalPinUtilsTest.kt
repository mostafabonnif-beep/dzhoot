package com.dzhoof.iptv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ParentalPinUtilsTest {

    @Test
    fun `valid pins are 4-6 digits`() {
        assertTrue(ParentalPinUtils.isValidPin("1234"))
        assertTrue(ParentalPinUtils.isValidPin("123456"))
        assertFalse(ParentalPinUtils.isValidPin("123"))
        assertFalse(ParentalPinUtils.isValidPin("1234567"))
        assertFalse(ParentalPinUtils.isValidPin("12a4"))
        assertFalse(ParentalPinUtils.isValidPin(""))
        assertFalse(ParentalPinUtils.isValidPin(" 1234"))
    }

    @Test
    fun `hash is deterministic and not the plaintext`() {
        val a = ParentalPinUtils.hashPin("4821")
        val b = ParentalPinUtils.hashPin("4821")
        assertEquals(a, b)
        assertFalse(a.contains("4821"))
        assertEquals(64, a.length) // SHA-256 hex
    }

    @Test
    fun `verify accepts the right pin and rejects wrong ones`() {
        val hash = ParentalPinUtils.hashPin("4821")
        assertTrue(ParentalPinUtils.verifyPin("4821", hash))
        assertFalse(ParentalPinUtils.verifyPin("4822", hash))
        assertFalse(ParentalPinUtils.verifyPin("4821", null))
        assertFalse(ParentalPinUtils.verifyPin("4821", ""))
    }
}
