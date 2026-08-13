package com.dzhoof.iptv.data

import java.security.MessageDigest

/**
 * Pure PIN helpers for parental controls. Kept free of Android framework
 * dependencies so the hashing/validation logic is unit-testable.
 */
object ParentalPinUtils {

    const val MIN_LENGTH = 4
    const val MAX_LENGTH = 6

    /** A valid PIN is 4-6 digits. */
    fun isValidPin(pin: String): Boolean =
        pin.length in MIN_LENGTH..MAX_LENGTH && pin.all { it.isDigit() }

    /** SHA-256 hex digest — the stored form. Never store the raw PIN. */
    fun hashPin(pin: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(pin.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    /** Constant-time comparison to avoid trivial timing side-channels. */
    fun verifyPin(pin: String, storedHash: String?): Boolean {
        if (storedHash.isNullOrBlank() || !isValidPin(pin)) return false
        val candidate = hashPin(pin).toByteArray(Charsets.UTF_8)
        val expected = storedHash.toByteArray(Charsets.UTF_8)
        if (candidate.size != expected.size) return false
        var diff = 0
        for (i in candidate.indices) diff = diff or (candidate[i].toInt() xor expected[i].toInt())
        return diff == 0
    }
}
