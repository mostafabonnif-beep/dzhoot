package com.dzhoof.iptv.update

/**
 * How this installation receives updates.
 *
 * The app must know — and report internally as a non-sensitive value — which path is in
 * play (operations brief §2). [wireName] is the exact value to log/report; never include
 * anything else about the device with it.
 */
enum class UpdateDistribution(val wireName: String) {
    /** Installed from Google Play: updates go through Play In-App Updates. */
    PLAY("play"),

    /** Ordinary sideloaded APK: verified download + the system installer and user consent. */
    EXTERNAL_APK("external_apk"),

    /** Proven Device Owner / affiliated profile owner: the managed-fleet path. */
    MANAGED_DEVICE("managed_device"),
}

/**
 * The facts the decision is made from. Kept as plain values so the rules are unit tested
 * without an Android device.
 */
data class UpdatePathEvidence(
    /** The installer of record is Google Play (`com.android.vending`). */
    val installedFromPlayStore: Boolean,
    /** This app is the device owner (`DevicePolicyManager.isDeviceOwnerApp`). */
    val isDeviceOwner: Boolean,
    /**
     * This app is the profile owner of a managed profile. A profile owner on a managed
     * profile is the organisation's DPC — the affiliated/enterprise case.
     */
    val isProfileOwner: Boolean,
)

/**
 * Chooses the distribution path.
 *
 * Deliberately conservative: the managed path is only chosen when the device policy state
 * *proves* it. Anything else falls back to the external-APK flow, which always requires the
 * user's explicit consent through the system installer — silent install is never inferred.
 *
 * Play takes precedence when the install came from the store, because Play's own update
 * policy governs that installation.
 */
object UpdatePathResolver {

    fun resolve(evidence: UpdatePathEvidence): UpdateDistribution {
        if (evidence.installedFromPlayStore) return UpdateDistribution.PLAY
        if (evidence.isDeviceOwner || evidence.isProfileOwner) {
            return UpdateDistribution.MANAGED_DEVICE
        }
        return UpdateDistribution.EXTERNAL_APK
    }
}
