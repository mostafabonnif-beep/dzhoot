package com.dzhoof.iptv.data.model.dto

import com.google.gson.annotations.SerializedName

data class PlaybackQoeReport(
    @SerializedName("eventType")
    val eventType: String,

    @SerializedName("startupMs")
    val startupMs: Long? = null,

    @SerializedName("rebufferCount")
    val rebufferCount: Int = 0,

    @SerializedName("fallbackUsed")
    val fallbackUsed: Boolean = false,

    @SerializedName("fallbackSucceeded")
    val fallbackSucceeded: Boolean? = null,

    @SerializedName("errorCode")
    val errorCode: String? = null,

    /**
     * Real device class — "android_tv" or "android_mobile".
     *
     * This previously defaulted to the constant "android_tv", so every phone
     * and tablet was mislabelled as a TV in production telemetry and the
     * form-factor could not be analysed. It is now required, so a caller cannot
     * silently fall back to a wrong label again.
     */
    @SerializedName("platform")
    val platform: String,

    /**
     * Reporting app version. Was never populated (null on all production
     * events), which made playback quality impossible to attribute to a build.
     * Required for the same reason as [platform].
     */
    @SerializedName("appVersion")
    val appVersion: String,
)
