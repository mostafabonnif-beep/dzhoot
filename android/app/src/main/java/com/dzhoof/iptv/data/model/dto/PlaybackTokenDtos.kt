package com.dzhoof.iptv.data.model.dto

import com.google.gson.annotations.SerializedName

data class PlaybackTokenRequest(
    @SerializedName("channelId")
    val channelId: String,
    @SerializedName("slot")
    val slot: Int = 0,
    @SerializedName("catchupStartMs")
    val catchupStartMs: Long = 0L,
    @SerializedName("catchupDurationMin")
    val catchupDurationMin: Int = 0,
)

data class PlaybackTokenResponse(
    @SerializedName("success")
    val success: Boolean = false,
    @SerializedName("data")
    val data: PlaybackTokenData? = null,
    @SerializedName("error")
    val error: String? = null,
)

data class PlaybackTokenData(
    @SerializedName("playbackUrl")
    val playbackUrl: String,
    @SerializedName("expiresAt")
    val expiresAt: Long,
    @SerializedName("slot")
    val slot: Int,
)
