package com.dzhoof.iptv.data

import java.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * PIN helpers for parental controls.
 *
 * PINs have very low entropy, so an unsalted SHA-256 hash is not sufficient:
 * an attacker with the local preferences could brute-force every 4-6 digit PIN.
 * We use PBKDF2-HMAC-SHA256 with a per-PIN random salt and a versioned format.
 */
object ParentalPinUtils {
    const val MIN_LENGTH = 4
    const val MAX_LENGTH = 6

    private const val VERSION = "pbkdf2-sha256-v1"
    private const val SALT_BYTES = 16
    private const val HASH_BYTES = 32
    private const val ITERATIONS = 210_000
    private val secureRandom = SecureRandom()

    fun isValidPin(pin: String): Boolean =
        pin.length in MIN_LENGTH..MAX_LENGTH && pin.all { it in '0'..'9' }

    fun hashPin(pin: String): String {
        require(isValidPin(pin)) { "PIN must contain 4-6 digits" }
        val salt = ByteArray(SALT_BYTES).also(secureRandom::nextBytes)
        val hash = derive(pin, salt)
        return "$VERSION:${Base64.getEncoder().withoutPadding().encodeToString(salt)}:${Base64.getEncoder().withoutPadding().encodeToString(hash)}"
    }

    fun isLegacySha256(storedHash: String): Boolean =
        storedHash.length == 64 && storedHash.all { it in '0'..'9' || it.lowercaseChar() in 'a'..'f' }

    fun verifyPin(pin: String, storedHash: String?): Boolean {
        if (storedHash.isNullOrBlank() || !isValidPin(pin)) return false
        return when {
            storedHash.startsWith("$VERSION:") -> verifyPbkdf2(pin, storedHash)
            // Backward compatibility for hashes created by older releases.
            isLegacySha256(storedHash) -> verifyLegacySha256(pin, storedHash)
            else -> false
        }
    }

    private fun verifyPbkdf2(pin: String, storedHash: String): Boolean {
        val parts = storedHash.split(':')
        if (parts.size != 3) return false
        return runCatching {
            val salt = Base64.getDecoder().decode(parts[1])
            val expected = Base64.getDecoder().decode(parts[2])
            if (salt.size != SALT_BYTES || expected.size != HASH_BYTES) return false
            val candidate = derive(pin, salt)
            MessageDigest.isEqual(candidate, expected)
        }.getOrDefault(false)
    }

    private fun verifyLegacySha256(pin: String, storedHash: String): Boolean {
        val candidate = MessageDigest.getInstance("SHA-256")
            .digest(pin.toByteArray(Charsets.UTF_8))
        val expected = storedHash.lowercase().chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        return MessageDigest.isEqual(candidate, expected)
    }

    private fun derive(pin: String, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(pin.toCharArray(), salt, ITERATIONS, HASH_BYTES * 8)
        return try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }
}
