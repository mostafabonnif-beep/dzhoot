package com.dzhoof.iptv.data.repository

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.source.local.PlaybackLocalDataSource
import com.dzhoof.iptv.data.source.local.entity.PlaybackPositionEntity
import com.dzhoof.iptv.data.source.remote.WatchProgressContentKey
import com.dzhoof.iptv.data.source.remote.WatchProgressRemoteDataSource
import com.dzhoof.iptv.di.IoDispatcher
import com.dzhoof.iptv.domain.repository.WatchProgressSyncRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.OffsetDateTime
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.roundToLong

/**
 * Default [WatchProgressSyncRepository]: local-first, best-effort, newest wins.
 *
 * Three rules make this safe to sit behind the player:
 *
 * 1. **Pushes never touch the local path.** [enqueueSave] / [enqueueDelete] hand
 *    work to a process-lifetime scope, so a slow or dead network cannot add
 *    latency to the periodic position save, and a failed push leaves the local
 *    row untouched.
 * 2. **A pull never overwrites something more recent.** A local row whose
 *    `lastPlayed` is at or after the server's `updatedAt` is left alone — the
 *    viewer watched it later on this device, and that position is already being
 *    pushed up. Only older local rows are replaced.
 * 3. **A completed row leaves Continue Watching everywhere.** The server marks
 *    `completed` at 95% of the duration; a completed remote row deletes the local
 *    row instead of resurrecting it as "resume from the end".
 *
 * Rows that cannot be mapped to a local key are skipped (`WatchProgressContentKey`)
 * rather than guessed.
 */
@Singleton
class WatchProgressSyncRepositoryImpl @Inject constructor(
    private val remoteDataSource: WatchProgressRemoteDataSource,
    private val localDataSource: PlaybackLocalDataSource,
    @IoDispatcher private val dispatcher: CoroutineDispatcher,
) : WatchProgressSyncRepository {

    /**
     * Process-lifetime scope for fire-and-forget pushes. `SupervisorJob` so one
     * failed push cannot cancel the next; the dispatcher is injected so tests can
     * drive it deterministically with a test scheduler.
     */
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)

    override fun enqueueSave(localKey: String, positionMs: Long, durationMs: Long) {
        val serverKey = WatchProgressContentKey.serverKey(localKey) ?: return
        scope.launch {
            try {
                remoteDataSource.upsert(
                    contentType = serverKey.first,
                    contentId = serverKey.second,
                    positionSec = positionMs.toDouble() / 1000.0,
                    durationSec = if (durationMs > 0) durationMs.toDouble() / 1000.0 else null,
                )
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Best-effort mirror: the local row is authoritative and already saved.
            }
        }
    }

    override fun enqueueDelete(localKey: String) {
        val serverKey = WatchProgressContentKey.serverKey(localKey) ?: return
        scope.launch {
            try {
                remoteDataSource.remove(serverKey.first, serverKey.second)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Best-effort mirror: see enqueueSave.
            }
        }
    }

    override suspend fun pullIntoLocal(limit: Int): Result<Int> = withContext(dispatcher) {
        val fetched = remoteDataSource.fetchContinueWatching(limit)
        val rows = when (fetched) {
            is Result.Error -> return@withContext Result.Error(fetched.exception)
            is Result.Success -> fetched.data
        }

        try {
            val localRows = localDataSource.getAllPositions().first().associateBy { it.channelId }
            var applied = 0

            for (row in rows) {
                val localKey = WatchProgressContentKey.localKey(row.contentType, row.contentId)
                    ?: continue

                if (row.completed == true) {
                    if (localRows.containsKey(localKey)) {
                        localDataSource.deletePosition(localKey)
                        applied++
                    }
                    continue
                }

                val positionMs = row.positionSec?.let { secondsToMillis(it) } ?: continue
                // The server drops anything under 10s; mirroring a shorter
                // position would only create a resume point that instantly
                // disappears on the next push.
                if (positionMs < MIN_RESUME_MS) continue

                val remoteUpdatedAt = parseTimestampMillis(row.updatedAt)
                val existing = localRows[localKey]
                if (existing != null && remoteUpdatedAt != null && existing.lastPlayed >= remoteUpdatedAt) {
                    continue
                }

                localDataSource.savePosition(
                    PlaybackPositionEntity(
                        channelId = localKey,
                        position = positionMs,
                        duration = row.durationSec?.let { secondsToMillis(it) } ?: 0L,
                        // Keep the server's timestamp so the next pull can still
                        // tell which side is newer; fall back to now when the
                        // server sent none.
                        lastPlayed = remoteUpdatedAt ?: System.currentTimeMillis(),
                    )
                )
                applied++
            }

            Result.Success(applied)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    private fun secondsToMillis(seconds: Double): Long =
        if (!seconds.isFinite() || seconds < 0) 0L else (seconds * 1000.0).roundToLong()

    /**
     * Parses a Mongo/JSON timestamp. Tolerant on purpose: the server has emitted
     * both `...Z` and `...+00:00`, and an unparseable value must degrade to
     * "unknown age" (the row is then applied) rather than fail the whole pull.
     */
    private fun parseTimestampMillis(raw: String?): Long? {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty()) return null
        return runCatching { Instant.parse(value).toEpochMilli() }
            .recoverCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }
            .getOrNull()
    }

    private companion object {
        /** Matches the server's own floor before it stores a resume point. */
        const val MIN_RESUME_MS = 10_000L
    }
}
