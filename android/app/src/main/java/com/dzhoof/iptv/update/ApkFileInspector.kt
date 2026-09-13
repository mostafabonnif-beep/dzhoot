package com.dzhoof.iptv.update

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Reads the raw facts the verifier needs from a downloaded APK and from the installed
 * app. Android-specific by nature, and deliberately free of policy: every decision
 * lives in [UpdateVerifier], which is unit-tested on the JVM.
 *
 * Everything returns `null` instead of throwing — an unreadable file must block the
 * install, never crash the update flow.
 */
@Singleton
class ApkFileInspector @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    /** Lowercase hex SHA-256 of [file], or null when it cannot be read. */
    fun sha256Of(file: File): String? = try {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { stream ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = stream.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        digest.digest().joinToString(separator = "") { byte -> "%02x".format(byte) }
    } catch (e: Exception) {
        Log.e(TAG, "Could not compute APK checksum", e)
        null
    }

    fun archivePackageName(file: File): String? = archiveInfo(file)?.packageName

    fun archiveVersionCode(file: File): Int? = archiveInfo(file)?.let { info -> versionCodeOf(info) }

    /** Version code of the installed application, or null when it cannot be read. */
    fun installedVersionCode(): Int? = try {
        versionCodeOf(context.packageManager.getPackageInfo(context.packageName, 0))
    } catch (e: Exception) {
        Log.e(TAG, "Could not read the installed versionCode", e)
        null
    }

    /**
     * True only when the downloaded APK is signed with exactly the certificate of the
     * installed application. Null means "could not be determined" — the caller treats
     * that as a failure.
     */
    @Suppress("DEPRECATION")
    fun signatureMatches(file: File): Boolean? {
        return try {
            val currentSigs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                context.packageManager.getPackageInfo(
                    context.packageName,
                    PackageManager.GET_SIGNING_CERTIFICATES
                ).signingInfo?.apkContentsSigners
            } else {
                context.packageManager.getPackageInfo(
                    context.packageName,
                    PackageManager.GET_SIGNATURES
                ).signatures
            }
            val apkSigs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                context.packageManager.getPackageArchiveInfo(
                    file.absolutePath,
                    PackageManager.GET_SIGNING_CERTIFICATES
                )?.signingInfo?.apkContentsSigners
            } else {
                context.packageManager.getPackageArchiveInfo(
                    file.absolutePath,
                    PackageManager.GET_SIGNATURES
                )?.signatures
            }
            if (currentSigs.isNullOrEmpty() || apkSigs.isNullOrEmpty()) {
                Log.e(TAG, "Could not retrieve signatures for verification")
                null
            } else {
                currentSigs[0].toByteArray().contentEquals(apkSigs[0].toByteArray())
            }
        } catch (e: Exception) {
            Log.e(TAG, "Signature verification error", e)
            null
        }
    }

    @Suppress("DEPRECATION")
    private fun versionCodeOf(info: PackageInfo): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode.toInt()
        } else {
            info.versionCode
        }

    private fun archiveInfo(file: File): PackageInfo? = try {
        context.packageManager.getPackageArchiveInfo(file.absolutePath, 0)
    } catch (e: Exception) {
        Log.e(TAG, "Could not read APK archive info", e)
        null
    }

    private companion object {
        const val TAG = "ApkFileInspector"
    }
}
