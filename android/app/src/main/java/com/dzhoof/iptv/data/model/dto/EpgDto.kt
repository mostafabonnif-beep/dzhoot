package com.dzhoof.iptv.data.model.dto

import com.google.gson.annotations.SerializedName

data class EpgProgramDto(
    @SerializedName("title") val title: String,
    @SerializedName("description") val description: String?,
    @SerializedName("start") val start: String,
    @SerializedName("end") val end: String,
    @SerializedName("icon") val icon: String?
)

data class EpgChannelDto(
    @SerializedName("channelId") val channelId: String,
    @SerializedName("channelName") val channelName: String?,
    @SerializedName("tvgLogo") val tvgLogo: String?,
    @SerializedName("programs") val programs: List<EpgProgramDto>?
)

data class EpgGuideResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("channels") val channels: List<EpgChannelDto>?
)

// ── "Matches today" (sports) ────────────────────────────────────────────────
// Mirrors GET /api/v1/tv/epg/:code/matches-today — today's live/upcoming sports
// programs for the paired channel list, used by the Home "مباريات اليوم" row.
// All fields are nullable on purpose: the server may omit optional fields and a
// single malformed match must not break the whole row.

data class MatchesTodayResponse(
    @SerializedName("success") val success: Boolean = false,
    @SerializedName("date") val date: String? = null,
    @SerializedName("count") val count: Int = 0,
    @SerializedName("matches") val matches: List<SportsMatchDto>? = null
)

data class SportsMatchDto(
    @SerializedName("startTime") val startTime: String? = null,
    @SerializedName("endTime") val endTime: String? = null,
    /** "live" | "upcoming" — ended matches are dropped server-side. */
    @SerializedName("status") val status: String? = null,
    @SerializedName("title") val title: String? = null,
    @SerializedName("description") val description: String? = null,
    @SerializedName("category") val category: List<String>? = null,
    @SerializedName("language") val language: String? = null,
    @SerializedName("channel") val channel: SportsMatchChannelDto? = null
)

data class SportsMatchChannelDto(
    @SerializedName("epgId") val epgId: String? = null,
    @SerializedName("channelId") val channelId: String? = null,
    @SerializedName("name") val name: String? = null,
    @SerializedName("icon") val icon: String? = null
)
