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
)
