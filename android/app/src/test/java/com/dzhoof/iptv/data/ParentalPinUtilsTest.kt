package com.dzhoof.iptv.data

import org.junit.Assert.*
import org.junit.Test

class ParentalPinUtilsTest {
    @Test fun `new hashes are salted and verifiable`() {
        val first = ParentalPinUtils.hashPin("1234")
        val second = ParentalPinUtils.hashPin("1234")

        assertNotEquals(first, second)
        assertTrue(ParentalPinUtils.verifyPin("1234", first))
        assertFalse(ParentalPinUtils.verifyPin("1235", first))
    }

    @Test fun `invalid pins are rejected`() {
        assertFalse(ParentalPinUtils.isValidPin("123"))
        assertFalse(ParentalPinUtils.isValidPin("1234567"))
        assertFalse(ParentalPinUtils.isValidPin("12a4"))
    }

    @Test fun `legacy sha256 hashes remain readable`() {
        val legacy = java.security.MessageDigest.getInstance("SHA-256")
            .digest("1234".toByteArray())
            .joinToString("") { "%02x".format(it) }

        assertTrue(ParentalPinUtils.isLegacySha256(legacy))
        assertTrue(ParentalPinUtils.verifyPin("1234", legacy))
        assertFalse(ParentalPinUtils.verifyPin("0000", legacy))
        assertFalse(ParentalPinUtils.isLegacySha256("not-a-hash"))
    }
}
