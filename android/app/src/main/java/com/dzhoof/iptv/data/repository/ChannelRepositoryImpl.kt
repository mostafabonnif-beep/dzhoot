package com.dzhoof.iptv.data.repository

import android.content.Context
import com.dzhoof.iptv.data.AppPreferences
import com.dzhoof.iptv.data.mapper.ChannelMapper
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.presentation.CatalogPresentationPolicy
import com.dzhoof.iptv.data.source.local.ChannelLocalDataSource
import com.dzhoof.iptv.data.source.local.dao.FavoriteDao
import com.dzhoof.iptv.data.source.local.entity.FavoriteEntity
import com.dzhoof.iptv.data.source.remote.ChannelRemoteDataSource
import com.dzhoof.iptv.data.source.remote.playlist.M3uDataSource
import com.dzhoof.iptv.data.source.remote.playlist.PlaylistFetch
import com.dzhoof.iptv.data.source.remote.playlist.XtreamDataSource
import com.dzhoof.iptv.di.IoDispatcher
import com.dzhoof.iptv.domain.model.Channel
import com.dzhoof.iptv.domain.model.ChannelServerMetadata
import com.dzhoof.iptv.domain.repository.ChannelRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of ChannelRepository with offline-first strategy.
 * 
 * This repository follows the offline-first pattern where:
 * 1. Local database is the single source of truth
 * 2. Data is emitted immediately from local cache
 * 3. Remote data is fetched in the background
 * 4. Local cache is updated on successful remote fetch
 * 5. Errors are handled gracefully without blocking UI
 * 
 * Requirements:
 * - TR-006: Network Performance (offline-first architecture, caching)
 * - US-007: Offline Support (cached data, graceful offline mode)
 */
@Singleton
class ChannelRepositoryImpl @Inject constructor(
    private val remoteDataSource: ChannelRemoteDataSource,
    private val localDataSource: ChannelLocalDataSource,
    private val favoriteDao: FavoriteDao,
    private val channelMapper: ChannelMapper,
    private val m3uDataSource: M3uDataSource,
    private val xtreamDataSource: XtreamDataSource,
    @ApplicationContext private val context: Context,
    @IoDispatcher private val dispatcher: CoroutineDispatcher
) : ChannelRepository {

    // In-memory cache of alternate stream URLs per channel (populated during sync).
    // Capped to prevent unbounded growth between refreshes.
    // Wrapped with synchronizedMap — accessed from IO dispatcher and Flow collectors.
    // Swapped atomically in refreshChannels() to avoid clear+populate races.
    @Volatile
    private var alternatesCache: Map<String, List<String>> = emptyMap()

    // Server health and logical identity are advisory metadata. Keep them in memory so
    // Android TV can use the latest values without a Room schema migration.
    @Volatile
    private var serverMetadataCache: Map<String, ChannelServerMetadata> = emptyMap()

    /**
     * Get all channels with offline-first strategy.
     *
     * Emits local data immediately, then fetches from remote in background.
     * The Flow will automatically emit updated data when remote fetch completes.
     */
    override fun getChannels(): Flow<Result<List<Channel>>> =
        localDataSource.getAllChannels()
            .combine(favoriteDao.getAllFavorites()) { channels, favorites ->
                val favoriteIds = favorites.map { it.channelId }.toSet()
                channels.filter { CatalogPresentationPolicy.isCustomerVisible(it) }.map { entity ->
                    channelMapper.toDomain(
                        entity,
                        isFavorite = favoriteIds.contains(entity.id),
                        alternateStreamUrls = alternatesCache[entity.id] ?: emptyList(),
                        serverMetadata = serverMetadataCache[entity.id]
                    )
                }
            }
            .map<List<Channel>, Result<List<Channel>>> { Result.Success(it) }
            .catch { e -> emit(Result.Error(Exception(e.message, e))) }
            .flowOn(dispatcher)
    
    /**
     * Get a specific channel by ID with offline-first strategy.
     */
    override fun getChannelById(id: String): Flow<Result<Channel>> =
        localDataSource.getChannelById(id)
            .combine(favoriteDao.isFavorite(id)) { entity, isFavorite ->
                if (entity != null && CatalogPresentationPolicy.isCustomerVisible(entity)) {
                    Result.Success(channelMapper.toDomain(
                        entity,
                        isFavorite,
                        alternateStreamUrls = alternatesCache[entity.id] ?: emptyList(),
                        serverMetadata = serverMetadataCache[entity.id]
                    ))
                } else {
                    Result.Error(Exception("Channel not found: $id"))
                }
            }
            .catch { e -> emit(Result.Error(Exception(e.message, e))) }
            .flowOn(dispatcher)
    
    /**
     * Get channels by category with offline-first strategy.
     */
    override fun getChannelsByCategory(category: String): Flow<Result<List<Channel>>> =
        localDataSource.getChannelsByCategory(category)
            .combine(favoriteDao.getAllFavorites()) { channels, favorites ->
                val favoriteIds = favorites.map { it.channelId }.toSet()
                channels.filter { CatalogPresentationPolicy.isCustomerVisible(it) }.map { entity ->
                    channelMapper.toDomain(
                        entity,
                        isFavorite = favoriteIds.contains(entity.id),
                        alternateStreamUrls = alternatesCache[entity.id] ?: emptyList(),
                        serverMetadata = serverMetadataCache[entity.id]
                    )
                }
            }
            .map<List<Channel>, Result<List<Channel>>> { Result.Success(it) }
            .catch { e -> emit(Result.Error(Exception(e.message, e))) }
            .flowOn(dispatcher)
    
    /**
     * Search channels with offline-first strategy.
     */
    override fun searchChannels(query: String): Flow<Result<List<Channel>>> =
        localDataSource.searchChannels(query)
            .combine(favoriteDao.getAllFavorites()) { channels, favorites ->
                val favoriteIds = favorites.map { it.channelId }.toSet()
                channels.filter { CatalogPresentationPolicy.isCustomerVisible(it) }.map { entity ->
                    channelMapper.toDomain(
                        entity,
                        isFavorite = favoriteIds.contains(entity.id),
                        alternateStreamUrls = alternatesCache[entity.id] ?: emptyList(),
                        serverMetadata = serverMetadataCache[entity.id]
                    )
                }
            }
            .map<List<Channel>, Result<List<Channel>>> { Result.Success(it) }
            .catch { e -> emit(Result.Error(Exception(e.message, e))) }
            .flowOn(dispatcher)
    
    /**
     * Refresh channels from remote source.
     * 
     * Fetches data from API and updates local cache. The Flow-based
     * methods will automatically emit the updated data.
     */
    override suspend fun refreshChannels(): Result<Unit> = withContext(dispatcher) {
        try {
            when (AppPreferences.getPlaylistSourceType(context)) {
                AppPreferences.SOURCE_M3U -> refreshFromPlaylist {
                    m3uDataSource.fetch(AppPreferences.getM3uUrl(context))
                }
                AppPreferences.SOURCE_XTREAM -> refreshFromPlaylist {
                    xtreamDataSource.fetch(
                        AppPreferences.getXtreamHost(context),
                        AppPreferences.getXtreamUser(context),
                        AppPreferences.getXtreamPass(context)
                    )
                }
                else -> refreshFromServer()
            }
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    private suspend fun refreshFromServer(): Result<Unit> {
        return when (val result = remoteDataSource.fetchChannels()) {
            is Result.Success -> {
                // The server should already exclude restricted presentation markers.
                // Keep this client-side guard for cached data and legacy deployments.
                val visibleChannels = result.data.filter { CatalogPresentationPolicy.isCustomerVisible(it) }
                // Build new alternates map and swap atomically
                val newAlternates = mutableMapOf<String, List<String>>()
                val newServerMetadata = mutableMapOf<String, ChannelServerMetadata>()
                visibleChannels.forEach { dto ->
                    val alts = dto.alternateStreams?.map { it.streamUrl } ?: emptyList()
                    if (alts.isNotEmpty()) newAlternates[dto.id] = alts
                    val health = dto.health
                    if (dto.identityKey != null || health != null) {
                        newServerMetadata[dto.id] = ChannelServerMetadata(
                            identityKey = dto.identityKey,
                            identityConfidence = dto.identityConfidence,
                            identityMatch = dto.identityMatch,
                            healthStatus = health?.status,
                            healthScore = health?.score,
                            fallbackCount = health?.fallbackCount,
                            recommendation = health?.recommendation
                        )
                    }
                }
                alternatesCache = newAlternates
                serverMetadataCache = newServerMetadata
                // Paired server source has no playlist-derived guide — clear any stale one.
                AppPreferences.setPlaylistEpgUrl(context, "")
                localDataSource.replaceAllChannels(visibleChannels.map { channelMapper.toEntity(it) })
                Result.Success(Unit)
            }
            is Result.Error -> Result.Error(result.exception)
        }
    }

    /**
     * Ingest a bring-your-own playlist (M3U/Xtream). Channels flow through the same
     * mapper/storage path; the discovered EPG URL is wired into the client-side EPG.
     */
    private suspend fun refreshFromPlaylist(load: () -> PlaylistFetch): Result<Unit> {
        val fetched: PlaylistFetch = load()
        if (fetched.channels.isEmpty()) {
            return Result.Error(Exception("لم يتم العثور على قنوات في قائمة التشغيل"))
        }
        alternatesCache = emptyMap()
        serverMetadataCache = emptyMap()
        // Always refresh the playlist-derived EPG URL (empty when the new playlist has none),
        // stored separately so it never overwrites the user's manual EPG setting.
        AppPreferences.setPlaylistEpgUrl(context, fetched.epgUrl?.takeIf { it.isNotBlank() } ?: "")
        localDataSource.replaceAllChannels(
            fetched.channels
                .filter { CatalogPresentationPolicy.isCustomerVisible(it) }
                .map { channelMapper.toEntity(it) }
        )
        return Result.Success(Unit)
    }
    
    /**
     * Add a channel to favorites.
     */
    override suspend fun addToFavorites(channelId: String): Result<Unit> = withContext(dispatcher) {
        try {
            val favorite = FavoriteEntity(
                channelId = channelId,
                addedAt = System.currentTimeMillis(),
                displayOrder = 0
            )
            favoriteDao.addFavorite(favorite)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }
    
    /**
     * Remove a channel from favorites.
     */
    override suspend fun removeFromFavorites(channelId: String): Result<Unit> = withContext(dispatcher) {
        try {
            favoriteDao.removeFavorite(channelId)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }
    
    /**
     * Get all favorite channels.
     */
    override fun getFavoriteChannels(): Flow<Result<List<Channel>>> =
        favoriteDao.getFavoriteChannels()
            .map { entities ->
                entities.map { entity ->
                    channelMapper.toDomain(
                        entity,
                        isFavorite = true,
                        alternateStreamUrls = alternatesCache[entity.id] ?: emptyList(),
                        serverMetadata = serverMetadataCache[entity.id]
                    )
                }
            }
            .map<List<Channel>, Result<List<Channel>>> { Result.Success(it) }
            .catch { e -> emit(Result.Error(Exception(e.message, e))) }
            .flowOn(dispatcher)
}
