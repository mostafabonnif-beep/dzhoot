package com.dzhoof.iptv.data.source.remote

import com.dzhoof.iptv.data.model.dto.CategoriesResponse
import com.dzhoof.iptv.data.model.dto.ChannelDto
import com.dzhoof.iptv.data.model.dto.ChannelsResponse
import com.dzhoof.iptv.data.model.dto.EpgGuideResponse
import com.dzhoof.iptv.data.model.dto.FavoritesRequest
import com.dzhoof.iptv.data.model.dto.FavoritesResponse
import com.dzhoof.iptv.data.model.dto.HealthSyncRequest
import com.dzhoof.iptv.data.model.dto.StreamPlayReport
import com.dzhoof.iptv.data.model.dto.StreamStatusReport
import com.dzhoof.iptv.data.model.dto.SubscriptionViewResponse
import com.dzhoof.iptv.data.model.dto.RedeemCodeRequest
import com.dzhoof.iptv.data.model.dto.RedeemResponseDto
import com.dzhoof.iptv.data.model.dto.DevicesResponse
import com.dzhoof.iptv.data.model.dto.RegisterDeviceRequest
import com.dzhoof.iptv.data.model.dto.PlaybackTokenRequest
import com.dzhoof.iptv.data.model.dto.PlaybackTokenResponse
import com.dzhoof.iptv.data.model.dto.MoviePageResponse
import com.dzhoof.iptv.data.model.dto.SeriesPageResponse
import com.dzhoof.iptv.data.model.dto.SeasonsResponse
import com.dzhoof.iptv.data.model.dto.EpisodesResponse
import com.dzhoof.iptv.data.model.dto.PlaybackAuthorizationRequest
import com.dzhoof.iptv.data.model.dto.PlaybackAuthorizationResponse
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Retrofit API service interface for FireVision IPTV backend.
 * 
 * This interface defines all API endpoints for the FireVision IPTV application.
 * All methods return Response<T> to enable proper error handling at the repository layer.
 * 
 * Requirements: TR-002 (Update Dependencies - Retrofit 2.11.0)
 */
interface FireVisionApiService {
    
    /**
     * Fetches all channels from the server.
     * 
     * @return Response containing ChannelsResponse with list of channels and metadata
     */
    @GET("api/v1/channels")
    suspend fun getChannels(): Response<ChannelsResponse>

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

    @GET("api/v1/catalog/movies")
    suspend fun getMovies(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 30,
        @Query("category") category: String? = null,
        @Query("search") search: String? = null,
    ): Response<MoviePageResponse>

    @GET("api/v1/catalog/series")
    suspend fun getSeries(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 30,
        @Query("category") category: String? = null,
        @Query("search") search: String? = null,
    ): Response<SeriesPageResponse>

    @GET("api/v1/catalog/series/{seriesId}/seasons")
    suspend fun getSeasons(@Path("seriesId") seriesId: String): Response<SeasonsResponse>

    @GET("api/v1/catalog/seasons/{seasonId}/episodes")
    suspend fun getEpisodes(@Path("seasonId") seasonId: String): Response<EpisodesResponse>

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

    /** Claims a sold activation code and returns the customer session. */
    @POST("api/v1/activation/claim")
    suspend fun claimCode(@Body request: RedeemCodeRequest): Response<RedeemResponseDto>
    
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
        @Query("hours") hours: Int = 12
    ): Response<EpgGuideResponse>

    @GET("api/v1/app/demo-code")
    suspend fun getDemoCode(): Response<Map<String, String>>
}
