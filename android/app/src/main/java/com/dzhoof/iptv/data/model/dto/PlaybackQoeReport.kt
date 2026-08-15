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

    @SerializedName("platform")
    val platform: String = "android_tv",

    @SerializedName("appVersion")
    val appVersion: String? = null,
)
