package com.dzhoof.iptv.data.source.remote

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.model.dto.WatchProgressDto
import com.dzhoof.iptv.data.model.dto.WatchProgressUpsertRequest
import com.dzhoof.iptv.di.IoDispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Remote data source for the cross-device Continue Watching API.
 *
 * Wraps [DzhoofApiService] and converts transport failures into [Result.Error] so
 * the sync layer never has to catch anything: a sync that cannot reach the server
 * must stay invisible to the viewer instead of surfacing as a playback problem.
 *
 * Authentication is unchanged from every other managed call — the network
 * interceptor attaches the paired `X-TV-Code` (see `NetworkModule`), which is
 * exactly why this endpoint had to accept that credential server-side before the
 * client could be written.
 *
 * Requirements: US-004.4 (playback position saved and restored)
 */
@Singleton
class WatchProgressRemoteDataSource @Inject constructor(
    private val apiService: DzhoofApiService,
    @IoDispatcher private val dispatcher: CoroutineDispatcher,
) {

    /**
     * Fetches the account's Continue Watching list, newest first.
     *
     * @param limit server-side ceiling is 50; the request clamps to a sane value.
     */
    suspend fun fetchContinueWatching(limit: Int = DEFAULT_LIMIT): Result<List<WatchProgressDto>> =
        withContext(dispatcher) {
            try {
                val response = apiService.getWatchProgress(limit.coerceIn(1, MAX_LIMIT))
                if (!response.isSuccessful) {
                    return@withContext Result.Error(
                        IllegalStateException("Continue watching request failed: HTTP ${response.code()}")
                    )
                }
                val rows = response.body()?.data ?: emptyList()
                Result.Success(rows)
            } catch (e: Exception) {
                Result.Error(e)
            }
        }

    /**
     * Mirrors one resume position to the server.
     *
     * Seconds on the wire, and the server applies its own thresholds (ignore
     * below 10s, complete at 95%), so no rule is duplicated here.
     */
    suspend fun upsert(
        contentType: String,
        contentId: String,
        positionSec: Double,
        durationSec: Double?,
    ): Result<Unit> = withContext(dispatcher) {
        try {
            val response: Response<*> = apiService.putWatchProgress(
                contentType = contentType,
                contentId = contentId,
                request = WatchProgressUpsertRequest(
                    positionSec = positionSec,
                    durationSec = durationSec?.takeIf { it > 0 },
                ),
            )
            if (response.isSuccessful) {
                Result.Success(Unit)
            } else {
                Result.Error(
                    IllegalStateException("Progress upsert failed: HTTP ${response.code()}")
                )
            }
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /** Removes one resume position from the account (finished, or dismissed). */
    suspend fun remove(contentType: String, contentId: String): Result<Unit> =
        withContext(dispatcher) {
            try {
                val response = apiService.deleteWatchProgress(contentType, contentId)
                if (response.isSuccessful) {
                    Result.Success(Unit)
                } else {
                    Result.Error(
                        IllegalStateException("Progress delete failed: HTTP ${response.code()}")
                    )
                }
            } catch (e: Exception) {
                Result.Error(e)
            }
        }

    companion object {
        /** Matches the server's own default for the Continue Watching list. */
        const val DEFAULT_LIMIT = 20

        /** The server clamps to 50; asking for more only wastes a round trip. */
        const val MAX_LIMIT = 50
    }
}
