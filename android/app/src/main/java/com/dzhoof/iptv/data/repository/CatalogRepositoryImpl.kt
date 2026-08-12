package com.dzhoof.iptv.data.repository

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.source.remote.FireVisionApiService
import com.dzhoof.iptv.di.IoDispatcher
import com.dzhoof.iptv.domain.model.CatalogPage
import com.dzhoof.iptv.domain.model.Episode
import com.dzhoof.iptv.domain.model.Movie
import com.dzhoof.iptv.domain.model.PlaybackAuthorization
import com.dzhoof.iptv.domain.model.Season
import com.dzhoof.iptv.domain.model.Series
import com.dzhoof.iptv.domain.repository.CatalogRepository
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CatalogRepositoryImpl @Inject constructor(
    private val apiService: FireVisionApiService,
    @IoDispatcher private val dispatcher: CoroutineDispatcher,
) : CatalogRepository {

    override suspend fun getMovies(page: Int, limit: Int, search: String?): Result<CatalogPage<Movie>> =
        withContext(dispatcher) {
            try {
                val response = apiService.getMovies(page, limit.coerceIn(1, 100), search)
                val body = response.body()
                if (response.isSuccessful && body?.success == true) {
                    Result.Success(
                        CatalogPage(
                            items = body.data.map { movie ->
                                Movie(
                                    id = movie.id,
                                    title = movie.title,
                                    category = movie.category,
                                    poster = movie.poster,
                                    backdrop = movie.backdrop,
                                    description = movie.description,
                                    year = movie.year,
                                    durationMinutes = movie.duration,
                                    rating = movie.rating,
                                )
                            },
                            totalCount = body.totalCount,
                            page = body.page,
                            limit = body.limit,
                        ),
                    )
                } else {
                    Result.Error(Exception(body?.error ?: response.message().ifBlank { "Unable to load movies" }))
                }
            } catch (error: Exception) {
                Result.Error(error)
            }
        }

    override suspend fun getSeries(page: Int, limit: Int, search: String?): Result<CatalogPage<Series>> =
        withContext(dispatcher) {
            try {
                val response = apiService.getSeries(page, limit.coerceIn(1, 100), search)
                val body = response.body()
                if (response.isSuccessful && body?.success == true) {
                    Result.Success(
                        CatalogPage(
                            items = body.data.map { series ->
                                Series(
                                    id = series.id,
                                    title = series.title,
                                    category = series.category,
                                    poster = series.poster,
                                    backdrop = series.backdrop,
                                    plot = series.plot,
                                    cast = series.cast,
                                    director = series.director,
                                    genre = series.genre,
                                    releaseDate = series.releaseDate,
                                    rating = series.rating,
                                )
                            },
                            totalCount = body.totalCount,
                            page = body.page,
                            limit = body.limit,
                        ),
                    )
                } else {
                    Result.Error(Exception(body?.error ?: response.message().ifBlank { "Unable to load series" }))
                }
            } catch (error: Exception) {
                Result.Error(error)
            }
        }

    override suspend fun getSeasons(seriesId: String): Result<List<Season>> = withContext(dispatcher) {
        try {
            val response = apiService.getSeasons(seriesId)
            val body = response.body()
            if (response.isSuccessful && body?.success == true) {
                Result.Success(body.data.map { season ->
                    Season(season.id, season.seriesId, season.seasonNumber, season.name, season.cover)
                })
            } else {
                Result.Error(Exception(body?.error ?: response.message().ifBlank { "Unable to load seasons" }))
            }
        } catch (error: Exception) {
            Result.Error(error)
        }
    }

    override suspend fun getEpisodes(seasonId: String): Result<List<Episode>> = withContext(dispatcher) {
        try {
            val response = apiService.getEpisodes(seasonId)
            val body = response.body()
            if (response.isSuccessful && body?.success == true) {
                Result.Success(body.data.map { episode ->
                    Episode(
                        id = episode.id,
                        seriesId = episode.seriesId,
                        seasonId = episode.seasonId,
                        episodeNumber = episode.episodeNumber,
                        title = episode.title,
                        description = episode.description,
                        thumbnail = episode.thumbnail,
                        durationMinutes = episode.duration,
                    )
                })
            } else {
                Result.Error(Exception(body?.error ?: response.message().ifBlank { "Unable to load episodes" }))
            }
        } catch (error: Exception) {
            Result.Error(error)
        }
    }

    override suspend fun authorizePlayback(contentType: String, contentId: String): Result<PlaybackAuthorization> =
        withContext(dispatcher) {
            try {
                val response = apiService.authorizePlayback(
                    com.dzhoof.iptv.data.model.dto.PlaybackAuthorizationRequest(contentType, contentId),
                )
                val body = response.body()
                if (response.isSuccessful && body?.success == true && body.data != null) {
                    Result.Success(PlaybackAuthorization(body.data.url, body.data.expiresAt))
                } else {
                    Result.Error(Exception(body?.error ?: response.message().ifBlank { "Playback authorization failed" }))
                }
            } catch (error: Exception) {
                Result.Error(error)
            }
        }
}
