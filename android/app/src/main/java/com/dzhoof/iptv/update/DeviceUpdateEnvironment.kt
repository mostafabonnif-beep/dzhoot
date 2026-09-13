package com.dzhoof.iptv.update

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/** Supplies the current distribution path; a function so tests can fake it. */
fun interface UpdateDistributionProvider {
    fun current(): UpdateDistribution
}

/**
 * Reads the Android-side facts behind the distribution decision.
 *
 * Every read is defensive: an unreadable installer or a missing device-policy service must
 * degrade to the safest path (external APK), never crash the update flow.
 */
@Singleton
class DeviceUpdateEnvironment @Inject constructor(
    @ApplicationContext private val context: Context,
) : UpdateDistributionProvider {

    override fun current(): UpdateDistribution = UpdatePathResolver.resolve(evidence())

    fun evidence(): UpdatePathEvidence {
        val installer = installerPackageName()
        val devicePolicy = try {
            context.getSystemService(Context.DEVICE_POLICY_SERVICE)
                as? android.app.admin.DevicePolicyManager
        } catch (_: Exception) {
            null
        }

        val isDeviceOwner = try {
            devicePolicy?.isDeviceOwnerApp(context.packageName) == true
        } catch (_: Exception) {
            false
        }
        val isProfileOwner = try {
            devicePolicy?.isProfileOwnerApp(context.packageName) == true
        } catch (_: Exception) {
            false
        }

        return UpdatePathEvidence(
            installedFromPlayStore = installer == PLAY_STORE_INSTALLER,
            isDeviceOwner = isDeviceOwner,
            isProfileOwner = isProfileOwner,
        )
    }

    @Suppress("DEPRECATION")
    private fun installerPackageName(): String? = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            context.packageManager
                .getInstallSourceInfo(context.packageName)
                .installingPackageName
        } else {
            context.packageManager.getInstallerPackageName(context.packageName)
        }
    } catch (e: PackageManager.NameNotFoundException) {
        Log.e(TAG, "Could not read the install source", e)
        null
    } catch (e: Exception) {
        Log.e(TAG, "Could not read the install source", e)
        null
    }

    private companion object {
        const val TAG = "DeviceUpdateEnv"

        /** The Play Store installer of record. */
        const val PLAY_STORE_INSTALLER = "com.android.vending"
    }
}
