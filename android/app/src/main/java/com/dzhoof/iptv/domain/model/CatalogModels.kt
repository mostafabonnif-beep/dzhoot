package com.dzhoof.iptv.domain.model

data class Movie(
    val id: String,
    val title: String,
    val category: String,
    val poster: String?,
    val backdrop: String?,
    val description: String?,
    val year: Int?,
    val durationMinutes: Int?,
    val rating: Double?,
)

data class Series(
    val id: String,
    val title: String,
    val category: String,
    val poster: String?,
    val backdrop: String?,
    val plot: String?,
    val cast: String?,
    val director: String?,
    val genre: String?,
    val releaseDate: String?,
    val rating: Double?,
)

data class Season(
    val id: String,
    val seriesId: String,
    val seasonNumber: Int,
    val name: String,
    val cover: String?,
)

data class Episode(
    val id: String,
    val seriesId: String,
    val seasonId: String,
    val episodeNumber: Int,
    val title: String,
    val description: String?,
    val thumbnail: String?,
    val durationMinutes: Int?,
)

data class CatalogPage<T>(
    val items: List<T>,
    val totalCount: Int,
    val page: Int,
    val limit: Int,
)

data class PlaybackAuthorization(
    val url: String,
    val expiresAt: Long,
    val mimeType: String? = null,
)

data class UnifiedSearchResults(
    val channels: List<UnifiedChannelResult> = emptyList(),
    val movies: List<UnifiedContentResult> = emptyList(),
    val series: List<UnifiedContentResult> = emptyList(),
    val programs: List<UnifiedProgramResult> = emptyList(),
) {
    val totalCount: Int
        get() = channels.size + movies.size + series.size + programs.size
}

data class UnifiedChannelResult(
    val id: String,
    val name: String,
    val logo: String?,
    val group: String?,
)

data class UnifiedContentResult(
    val id: String,
    val type: String,
    val name: String,
    val poster: String?,
    val category: String?,
)

data class UnifiedProgramResult(
    val id: String,
    val name: String,
    val description: String?,
    val category: String?,
    val channelEpgId: String?,
    val startTime: String?,
    val endTime: String?,
    val icon: String?,
    val language: String?,
    val catchupAvailable: Boolean,
)
