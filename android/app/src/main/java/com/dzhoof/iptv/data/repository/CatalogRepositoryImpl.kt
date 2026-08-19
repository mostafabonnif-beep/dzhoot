package com.dzhoof.iptv.data.repository

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.model.dto.PlaybackAuthorizationResponse
import com.google.gson.Gson
import com.dzhoof.iptv.data.source.remote.FireVisionApiService
import com.dzhoof.iptv.di.IoDispatcher
import com.dzhoof.iptv.domain.model.CatalogPage
import com.dzhoof.iptv.domain.model.Episode
import com.dzhoof.iptv.domain.model.Movie
import com.dzhoof.iptv.domain.model.PlaybackAuthorization
import com.dzhoof.iptv.domain.model.Season
import com.dzhoof.iptv.domain.model.Series
import com.dzhoof.iptv.domain.model.UnifiedChannelResult
import com.dzhoof.iptv.domain.model.UnifiedContentResult
import com.dzhoof.iptv.domain.model.UnifiedProgramResult
import com.dzhoof.iptv.domain.model.UnifiedSearchResults
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

    private val gson = Gson()

    private fun playbackAuthorizationError(response: retrofit2.Response<PlaybackAuthorizationResponse>): String {
        val payload = response.errorBody()?.charStream()?.use { reader ->
            runCatching { gson.fromJson(reader, PlaybackAuthorizationResponse::class.java) }.getOrNull()
        }
        return when (payload?.code) {
            "CONTENT_NOT_FOUND" -> "هذه القناة غير متاحة ضمن صلاحيات الحساب الحالي"
            "SUBSCRIPTION_EXPIRED" -> "انتهت صلاحية الاشتراك. فعّل رمزاً جديداً للمتابعة"
            "PLAYBACK_DEVICE_REQUIRED" -> "يلزم ربط جهاز مفعّل قبل تشغيل البث"
            "AUTHENTICATION_REQUIRED" -> "انتهت جلسة التطبيق. أعد ربط التطبيق برمز التفعيل"
            else -> payload?.error ?: response.message().ifBlank { "تعذر تفويض تشغيل البث" }
        }
    }

    override suspend fun searchCatalog(query: String): Result<UnifiedSearchResults> = withContext(dispatcher) {
        try {
            val response = apiService.unifiedSearch(query.trim())
            val body = response.body()
            if (response.isSuccessful && body?.success == true) {
                Result.Success(
                    UnifiedSearchResults(
                        channels = body.data.channels.map { channel ->
                            UnifiedChannelResult(channel.id, channel.name, channel.logo, channel.group)
                        },
                        movies = body.data.movies.map { content ->
                            UnifiedContentResult(content.id, content.type, content.name, content.poster, content.category)
                        },
                        series = body.data.series.map { content ->
                            UnifiedContentResult(content.id, content.type, content.name, content.poster, content.category)
                        },
                        programs = body.data.programs.map { program ->
                            UnifiedProgramResult(
                                id = program.id,
                                name = program.name,
                                description = program.description,
                                category = program.category,
                                channelEpgId = program.channelEpgId,
                                startTime = program.startTime,
                                endTime = program.endTime,
                                icon = program.icon,
                                language = program.language,
                                catchupAvailable = program.catchupAvailable,
                            )
                        },
                    ),
                )
            } else {
                Result.Error(Exception(body?.error ?: response.message().ifBlank { "Unable to search catalog" }))
            }
        } catch (error: Exception) {
            Result.Error(error)
        }
    }

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

    override suspend fun getMovieById(movieId: String): Result<Movie> = withContext(dispatcher) {
        try {
            val response = apiService.getMovieById(movieId)
            val body = response.body()
            val movie = body?.data
            if (response.isSuccessful && body?.success == true && movie != null) {
                Result.Success(
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
                )
            } else {
                Result.Error(Exception(body?.error ?: response.message().ifBlank { "تعذر تحميل تفاصيل الفيلم" }))
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

    override suspend fun getSeriesById(seriesId: String): Result<Series> = withContext(dispatcher) {
        try {
            val response = apiService.getSeriesById(seriesId)
            val body = response.body()
            val series = body?.data
            if (response.isSuccessful && body?.success == true && series != null) {
                Result.Success(
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
                )
            } else {
                Result.Error(Exception(body?.error ?: response.message().ifBlank { "Unable to load series details" }))
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
                    Result.Error(Exception(body?.error ?: playbackAuthorizationError(response)))
                }
            } catch (error: Exception) {
                Result.Error(error)
            }
        }
}
