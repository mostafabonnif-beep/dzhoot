package com.dzhoof.iptv.data.model.dto

import com.google.gson.annotations.SerializedName

/**
 * Data Transfer Object for Channel API responses.
 *
 * Matches the actual server response fields from /api/v1/channels.
 */
data class ChannelDto(
    @SerializedName("channelId")
    val id: String,

    @SerializedName("channelName")
    val name: String,

    @SerializedName("channelUrl")
    val url: String,

    @SerializedName("channelImg")
    val channelImg: String?,

    val tvgLogo: String? = null,

    @SerializedName("channelGroup")
    val groupTitle: String?,

    @SerializedName("channelDrmKey")
    val drmKey: String? = null,

    @SerializedName("channelDrmType")
    val drmType: String? = null,

    val tvgLanguage: String? = null,
    val tvgCountry: String? = null,
    val tvgId: String? = null,
    val tvgName: String? = null,
    val isActive: Boolean = true,
    val metadata: ChannelMetadataDto? = null,
    val catchup: ChannelCatchupDto? = null,
    val alternateStreams: List<AlternateStreamDto>? = null,
    val identityKey: String? = null,
    val identityConfidence: Double? = null,
    val identityMatch: String? = null,
    val health: ChannelHealthDto? = null
) {
    /** Resolved logo URL: prefers tvgLogo, falls back to channelImg */
    val logoUrl: String?
        get() = tvgLogo?.takeIf { it.isNotEmpty() } ?: channelImg?.takeIf { it.isNotEmpty() }
}

data class ChannelHealthDto(
    val status: String? = null,
    val score: Int? = null,
    val primaryStatus: String? = null,
    val fallbackCount: Int? = null,
    val successRate: Double? = null,
    val responseTimeMs: Int? = null,
    val lastCheckedAt: String? = null,
    val recommendation: String? = null
)

data class ChannelMetadataDto(
    @SerializedName("language")
    val language: String? = null
)

/**
 * Catch-up (timeshift) capability advertised by the server for this channel.
 * The server never exposes the raw catchup-source template — only type/days.
 */
data class ChannelCatchupDto(
    @SerializedName("type")
    val type: String? = null,
    @SerializedName("days")
    val days: Int? = null
)

data class AlternateStreamDto(
    @SerializedName("streamUrl")
    val streamUrl: String,
    @SerializedName("quality")
    val quality: String? = null
)
