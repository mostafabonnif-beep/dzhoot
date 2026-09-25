package com.dzhoof.iptv.data.source.remote

import com.dzhoof.iptv.data.model.dto.AdsDecisionResponse
import com.dzhoof.iptv.data.model.dto.CategoriesResponse
import com.dzhoof.iptv.data.model.dto.ChannelDto
import com.dzhoof.iptv.data.model.dto.ChannelsResponse
import com.dzhoof.iptv.data.model.dto.EpgGuideResponse
import com.dzhoof.iptv.data.model.dto.MatchesTodayResponse
import com.dzhoof.iptv.data.model.dto.FavoritesRequest
import com.dzhoof.iptv.data.model.dto.FavoritesResponse
import com.dzhoof.iptv.data.model.dto.HealthSyncRequest
import com.dzhoof.iptv.data.model.dto.HealthVersionDto
import com.dzhoof.iptv.data.model.dto.StreamPlayReport
import com.dzhoof.iptv.data.model.dto.StreamStatusReport
import com.dzhoof.iptv.data.model.dto.SubscriptionViewResponse
import com.dzhoof.iptv.data.model.dto.RedeemCodeRequest
import com.dzhoof.iptv.data.model.dto.ClientRedeemRequest
import com.dzhoof.iptv.data.model.dto.ClientRedeemResponse
import com.dzhoof.iptv.data.model.dto.RedeemResponseDto
import com.dzhoof.iptv.data.model.dto.DevicesResponse
import com.dzhoof.iptv.data.model.dto.RegisterDeviceRequest
import com.dzhoof.iptv.data.model.dto.PlaybackTokenRequest
import com.dzhoof.iptv.data.model.dto.PlaybackTokenResponse
import com.dzhoof.iptv.data.model.dto.MoviePageResponse
import com.dzhoof.iptv.data.model.dto.MovieDetailResponse
import com.dzhoof.iptv.data.model.dto.SeriesPageResponse
import com.dzhoof.iptv.data.model.dto.SeriesDetailResponse
import com.dzhoof.iptv.data.model.dto.SeasonsResponse
import com.dzhoof.iptv.data.model.dto.EpisodeDetailResponse
import com.dzhoof.iptv.data.model.dto.EpisodesResponse
import com.dzhoof.iptv.data.model.dto.PlaybackAuthorizationRequest
import com.dzhoof.iptv.data.model.dto.PlaybackAuthorizationResponse
import com.dzhoof.iptv.data.model.dto.PlaybackQoeReport
import com.dzhoof.iptv.data.model.dto.UnifiedSearchResponse
import com.dzhoof.iptv.data.model.dto.WatchProgressListResponse
import com.dzhoof.iptv.data.model.dto.WatchProgressRemovedResponse
import com.dzhoof.iptv.data.model.dto.WatchProgressUpsertRequest
import com.dzhoof.iptv.data.model.dto.WatchProgressUpsertResponse
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Headers
import retrofit2.http.Path
import retrofit2.http.Query
import com.dzhoof.iptv.data.model.dto.CatalogCategoriesResponse

/**
 * Retrofit API service interface for DZ HOOF IPTV backend.
 * 
 * This interface defines all API endpoints for the DZ HOOF IPTV application.
 * All methods return Response<T> to enable proper error handling at the repository layer.
 * 
 * Requirements: TR-002 (Update Dependencies - Retrofit 2.11.0)
 */
interface DzhoofApiService {
    
    /**
     * Fetches all channels from the server.
     * 
     * @return Response containing ChannelsResponse with list of channels and metadata
     */
    @GET("api/v1/channels")
    suspend fun getChannels(): Response<ChannelsResponse>

    @GET("api/v1/channels")
    suspend fun getChannelsPage(
        @Query("page") page: Int,
        @Query("pageSize") pageSize: Int
    ): Response<ChannelsResponse>

    @POST("api/v1/tv/playback-token")
    suspend fun issuePlaybackToken(
        @Body request: PlaybackTokenRequest
    ): Response<PlaybackTokenResponse>
    
    /**
     * Fetches a specific channel by its ID.
     * 
     * @param id The unique identifier of the channel
     * @return Response containing the ChannelDto for the requested channel
     */
    @GET("api/v1/channels/{id}")
    suspend fun getChannelById(@Path("id") id: String): Response<ChannelDto>

    @GET("api/v1/catalog/search")
    suspend fun unifiedSearch(@Query("q") query: String): Response<UnifiedSearchResponse>

    @GET("api/v1/catalog/movies")
    suspend fun getMovies(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 30,
        @Query("category") category: String? = null,
        @Query("search") search: String? = null,
    ): Response<MoviePageResponse>

    /** VOD categories with item counts — powers the catalog category rail. */
    @GET("api/v1/catalog/movies/categories")
    suspend fun getMovieCategories(): Response<CatalogCategoriesResponse>

    @GET("api/v1/catalog/series/categories")
    suspend fun getSeriesCategories(): Response<CatalogCategoriesResponse>

    @GET("api/v1/catalog/movies/{movieId}")
    suspend fun getMovieById(@Path("movieId") movieId: String): Response<MovieDetailResponse>

    @GET("api/v1/catalog/series")
    suspend fun getSeries(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 30,
        @Query("category") category: String? = null,
        @Query("search") search: String? = null,
    ): Response<SeriesPageResponse>

    @GET("api/v1/catalog/series/{seriesId}")
    suspend fun getSeriesById(@Path("seriesId") seriesId: String): Response<SeriesDetailResponse>

    @GET("api/v1/catalog/series/{seriesId}/seasons")
    suspend fun getSeasons(@Path("seriesId") seriesId: String): Response<SeasonsResponse>

    @GET("api/v1/catalog/seasons/{seasonId}/episodes")
    suspend fun getEpisodes(@Path("seasonId") seasonId: String): Response<EpisodesResponse>

    /**
     * One episode by its own id, with its parent labels.
     *
     * Every other episode route is keyed by a SEASON id, so an id held on its own —
     * a resume position, a deep link — previously could not be resolved at all.
     */
    @GET("api/v1/catalog/episodes/{episodeId}")
    suspend fun getEpisodeById(@Path("episodeId") episodeId: String): Response<EpisodeDetailResponse>

    @POST("api/v1/streams/authorize")
    suspend fun authorizePlayback(
        @Body request: PlaybackAuthorizationRequest,
    ): Response<PlaybackAuthorizationResponse>
    
    /**
     * Fetches all categories from the server.
     * 
     * @return Response containing CategoriesResponse with list of categories and metadata
     */
    @GET("api/v1/categories")
    suspend fun getCategories(): Response<CategoriesResponse>
    
    /**
     * Syncs user favorites to the server.
     * 
     * This endpoint allows the app to synchronize favorite channels across devices.
     * The server will store the favorites associated with the device ID.
     * 
     * @param favorites FavoritesRequest containing channel IDs and device information
     * @return Response with Unit on success
     */
    @POST("api/v1/favorites")
    suspend fun syncFavorites(@Body favorites: FavoritesRequest): Response<Unit>
    
    /**
     * Redeems an activation code and creates/extend the user's subscription.
     *
     * @param request RedeemCodeRequest with the code (DZHF-XXXX-XXXX-XXXX)
     * @return Response with the new subscription + plan + device usage
     */
    @POST("api/v1/activation/redeem")
    suspend fun redeemCode(@Body request: RedeemCodeRequest): Response<RedeemResponseDto>

    @Headers("Content-Type: application/json")
    @POST("api/v1/activation/client-redeem")
    suspend fun clientRedeem(@Body request: ClientRedeemRequest): Response<ClientRedeemResponse>
    
    /**
     * Fetches the server's ad decision for this account (freemium). Paying
     * subscribers receive `show = false`, so no ad traffic is ever made for them.
     */
    @GET("api/v1/ads/me")
    suspend fun getAdsDecision(): Response<AdsDecisionResponse>

    /**
     * Fetches the current subscription, plan and registered devices.
     */
    @GET("api/v1/me/subscription")
    suspend fun getSubscription(): Response<SubscriptionViewResponse>
    
    /**
     * Lists the devices registered to the current user.
     */
    @GET("api/v1/me/devices")
    suspend fun getDevices(): Response<DevicesResponse>
    
    /**
     * Registers (or touches) a device for the current user.
     */
    @POST("api/v1/me/devices")
    suspend fun registerDevice(@Body request: RegisterDeviceRequest): Response<DevicesResponse>
    
    /**
     * Removes a device (frees a subscription slot).
     */
    @retrofit2.http.DELETE("api/v1/me/devices/{deviceId}")
    suspend fun deleteDevice(@retrofit2.http.Path("deviceId") deviceId: String): Response<Unit>
    
    /**
     * Fetches the M3U playlist from the server.
     * 
     * This endpoint returns the raw M3U playlist file which can be parsed
     * to extract channel information.
     * 
     * @return Response containing ResponseBody with the M3U playlist content
     */
    @GET("api/v1/channels/playlist.m3u")
    suspend fun getPlaylist(): Response<ResponseBody>

    @GET("api/v1/favorites")
    suspend fun getFavorites(): Response<FavoritesResponse>

    @POST("api/v1/channels/{channelId}/report-status")
    suspend fun reportStreamStatus(
        @Path("channelId") channelId: String,
        @Body report: StreamStatusReport
    ): Response<Unit>

    @POST("api/v1/channels/{channelId}/report-playback-event")
    suspend fun reportPlaybackQoe(
        @Path("channelId") channelId: String,
        @Body report: PlaybackQoeReport
    ): Response<Unit>

    @POST("api/v1/channels/{channelId}/report-play")
    suspend fun reportStreamPlay(
        @Path("channelId") channelId: String,
        @Body report: StreamPlayReport
    ): Response<Unit>

    @POST("api/v1/channels/health-sync")
    suspend fun syncHealthResults(
        @Body request: HealthSyncRequest
    ): Response<Unit>

    @GET("api/v1/tv/epg/{channelListCode}/json")
    suspend fun getEpgGuide(
        @Path("channelListCode") channelListCode: String,
        @Query("hours") hours: Int = 6
    ): Response<EpgGuideResponse>

    /**
     * Today's live/upcoming sports matches for the paired channel list
     * (public endpoint — no auth beyond the 6-char channel list code).
     */
    @GET("api/v1/tv/epg/{channelListCode}/matches-today")
    suspend fun getMatchesToday(
        @Path("channelListCode") channelListCode: String
    ): Response<MatchesTodayResponse>

    @GET("api/v1/app/demo-code")
    suspend fun getDemoCode(): Response<Map<String, String>>

    /**
     * Non-sensitive backend build identity for the diagnostics screen.
     *
     * Resolves against the existing base URL (root-relative, like the other
     * health probes) — no new client, no auth. Failure is handled by the caller
     * as "غير متاح".
     */
    @GET("health/version")
    suspend fun getHealthVersion(): Response<HealthVersionDto>

    // ---- Cross-device Continue Watching -------------------------------------
    // The account's resume positions, so a viewer can start on one device and
    // continue on another. The server has carried these endpoints all along; the
    // app had no client for them, so the whole feature stayed device-local. They
    // authenticate like every other managed call (paired X-TV-Code attached by
    // the network interceptor) and the routes accept that credential
    // server-side: `requireTvOrSessionAuth` in `routes/watch-progress.js`.

    /** Continue Watching for the paired account, most recently updated first. */
    @GET("api/v1/watch-progress")
    suspend fun getWatchProgress(
        @Query("limit") limit: Int = 20,
    ): Response<WatchProgressListResponse>

    /**
     * Upserts the resume position for one piece of content.
     *
     * [contentType] is one of `live`, `movie`, `series`, `episode`;
     * [contentId] is the channel id or catalog id. Positions are SECONDS here.
     */
    @PUT("api/v1/watch-progress/{contentType}/{contentId}")
    suspend fun putWatchProgress(
        @Path("contentType") contentType: String,
        @Path("contentId") contentId: String,
        @Body request: WatchProgressUpsertRequest,
    ): Response<WatchProgressUpsertResponse>

    /** Drops one resume position from the account. */
    @DELETE("api/v1/watch-progress/{contentType}/{contentId}")
    suspend fun deleteWatchProgress(
        @Path("contentType") contentType: String,
        @Path("contentId") contentId: String,
    ): Response<WatchProgressRemovedResponse>
}
