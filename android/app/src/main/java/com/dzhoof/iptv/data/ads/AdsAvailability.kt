package com.dzhoof.iptv.data.ads

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability

/**
 * Device-level checks for the ad SDK.
 *
 * DZ HOOF ships to phones and TVs, including Fire TV / Amazon Appstore builds
 * where Google Play services is absent. Requesting an ad there must be a no-op —
 * never a crash and never a stalled playback start.
 */
object AdsAvailability {

    /** True when Google Play services is installed and usable on this device. */
    fun hasPlayServices(context: Context): Boolean = try {
        GoogleApiAvailability.getInstance()
            .isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    } catch (_: Throwable) {
        false
    }

    /** Walks ContextWrapper chains — Compose contexts are often wrapped. */
    fun findActivity(context: Context?): Activity? {
        var current = context
        while (current is ContextWrapper) {
            if (current is Activity) return current
            current = current.baseContext
        }
        return null
    }
}
