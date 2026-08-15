package com.dzhoof.iptv.data.model.dto

import com.google.gson.annotations.SerializedName

data class MovieDto(
    @SerializedName("_id") val id: String,
    val title: String,
    val category: String = "Uncategorized",
    val poster: String? = null,
    val backdrop: String? = null,
    val description: String? = null,
    val year: Int? = null,
    val duration: Int? = null,
    val rating: Double? = null,
)

data class SeriesDto(
    @SerializedName("_id") val id: String,
    val title: String,
    val category: String = "Uncategorized",
    val poster: String? = null,
    val backdrop: String? = null,
    val plot: String? = null,
    val cast: String? = null,
    val director: String? = null,
    val genre: String? = null,
    val releaseDate: String? = null,
    val rating: Double? = null,
)

data class SeasonDto(
    @SerializedName("_id") val id: String,
    val seriesId: String,
    val seasonNumber: Int,
    val name: String = "",
    val cover: String? = null,
)

data class EpisodeDto(
    @SerializedName("_id") val id: String,
    val seriesId: String,
    val seasonId: String,
    val episodeNumber: Int = 0,
    val title: String,
    val description: String? = null,
    val thumbnail: String? = null,
    val duration: Int? = null,
)

data class MoviePageResponse(
    val success: Boolean = false,
    val data: List<MovieDto> = emptyList(),
    val totalCount: Int = 0,
    val page: Int = 1,
    val limit: Int = 30,
    val error: String? = null,
)

data class SeriesPageResponse(
    val success: Boolean = false,
    val data: List<SeriesDto> = emptyList(),
    val totalCount: Int = 0,
    val page: Int = 1,
    val limit: Int = 30,
    val error: String? = null,
)

data class MovieDetailResponse(
    val success: Boolean = false,
    val data: MovieDto? = null,
    val error: String? = null,
)

data class SeriesDetailResponse(
    val success: Boolean = false,
    val data: SeriesDto? = null,
    val error: String? = null,
)

data class SeasonsResponse(
    val success: Boolean = false,
    val data: List<SeasonDto> = emptyList(),
    val error: String? = null,
)

data class EpisodesResponse(
    val success: Boolean = false,
    val data: List<EpisodeDto> = emptyList(),
    val error: String? = null,
)

data class PlaybackAuthorizationRequest(
    val contentType: String,
    val contentId: String,
)

data class PlaybackAuthorizationResponse(
    val success: Boolean = false,
    val data: PlaybackAuthorizationData? = null,
    val error: String? = null,
    val code: String? = null,
)

data class PlaybackAuthorizationData(
    val contentType: String,
    val contentId: String,
    val url: String,
    val expiresAt: Long,
    val authorized: Boolean = false,
    val subscriptionRequired: Boolean = false,
)

data class UnifiedSearchResponse(
    val success: Boolean = false,
    val data: UnifiedSearchData = UnifiedSearchData(),
    val error: String? = null,
)

data class UnifiedSearchData(
    val channels: List<ChannelSearchResult> = emptyList(),
    val movies: List<ContentSearchResult> = emptyList(),
    val series: List<ContentSearchResult> = emptyList(),
    val programs: List<ProgramSearchResult> = emptyList(),
)

data class ChannelSearchResult(
    @SerializedName("_id") val id: String,
    val type: String = "LIVE",
    val name: String,
    val logo: String? = null,
    val group: String? = null,
)

data class ContentSearchResult(
    @SerializedName("_id") val id: String,
    val type: String,
    val name: String,
    val poster: String? = null,
    val category: String? = null,
)

data class ProgramSearchResult(
    @SerializedName("_id") val id: String,
    val type: String = "PROGRAM",
    val name: String,
    val description: String? = null,
    val category: String? = null,
    val channelEpgId: String? = null,
    val startTime: String? = null,
    val endTime: String? = null,
    val icon: String? = null,
    val language: String? = null,
    val catchupAvailable: Boolean = false,
)
