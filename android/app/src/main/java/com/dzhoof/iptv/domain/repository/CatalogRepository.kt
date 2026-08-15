package com.dzhoof.iptv.domain.repository

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.model.CatalogPage
import com.dzhoof.iptv.domain.model.Episode
import com.dzhoof.iptv.domain.model.Movie
import com.dzhoof.iptv.domain.model.PlaybackAuthorization
import com.dzhoof.iptv.domain.model.Season
import com.dzhoof.iptv.domain.model.Series
import com.dzhoof.iptv.domain.model.UnifiedSearchResults

interface CatalogRepository {
    suspend fun searchCatalog(query: String): Result<UnifiedSearchResults>
    suspend fun getMovies(page: Int = 1, limit: Int = 30, search: String? = null): Result<CatalogPage<Movie>>
    suspend fun getMovieById(movieId: String): Result<Movie>
    suspend fun getSeries(page: Int = 1, limit: Int = 30, search: String? = null): Result<CatalogPage<Series>>
    suspend fun getSeriesById(seriesId: String): Result<Series>
    suspend fun getSeasons(seriesId: String): Result<List<Season>>
    suspend fun getEpisodes(seasonId: String): Result<List<Episode>>
    suspend fun authorizePlayback(contentType: String, contentId: String): Result<PlaybackAuthorization>
}
