package com.dzhoof.iptv.data.repository

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.source.local.dao.PlaybackPositionDao
import com.dzhoof.iptv.data.source.local.entity.PlaybackPositionEntity
import com.dzhoof.iptv.data.source.remote.WatchProgressContentKey
import com.dzhoof.iptv.di.IoDispatcher
import com.dzhoof.iptv.domain.model.EpisodeDetail
import com.dzhoof.iptv.domain.model.VodContinueWatchingItem
import com.dzhoof.iptv.domain.repository.CatalogRepository
import com.dzhoof.iptv.domain.repository.VodContinueWatchingRepository
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Default [VodContinueWatchingRepository].
 *
 * The local table is the source of truth (it is also where cross-device positions
 * land), and every row is resolved against the catalog on demand. Two deliberate
 * choices:
 *
 * 1. **A row that cannot be resolved is skipped, not surfaced as a placeholder.**
 *    A title dropped by the provider, or a device that is offline while the
 *    catalog is cold, must not turn into an empty card — the rest of the row is
 *    still worth showing.
 * 2. **One failed resolution never fails the row.** Only a failure of the local
 *    query itself produces [Result.Error], because that is the only thing the UI
 *    cannot work around.
 */
@Singleton
class VodContinueWatchingRepositoryImpl @Inject constructor(
    private val playbackPositionDao: PlaybackPositionDao,
    private val catalogRepository: CatalogRepository,
    @IoDispatcher private val dispatcher: CoroutineDispatcher,
) : VodContinueWatchingRepository {

    override fun observeItems(limit: Int): Flow<Result<List<VodContinueWatchingItem>>> {
        // The intermediate flow is declared with its full type on purpose: left to
        // infer, `Result.Success(items)` narrows the element type to
        // Result.Success<ArrayList<…>> and the error branch below stops matching.
        val items: Flow<Result<List<VodContinueWatchingItem>>> =
            playbackPositionDao.observeVodProgress(limit)
                .map { rows ->
                    // An explicit loop, not `mapNotNull`: `resolve` is suspend and
                    // `Iterable.mapNotNull` takes a non-suspend lambda.
                    val resolved = ArrayList<VodContinueWatchingItem>(rows.size)
                    for (row in rows) {
                        resolve(row)?.let { resolved.add(it) }
                    }
                    Result.Success(resolved)
                }
        return items
            .catch { throwable ->
                emit(Result.Error(Exception(throwable.message, throwable)))
            }
            .flowOn(dispatcher)
    }

    /** Resolves one local position into a card, or null when it cannot be shown. */
    private suspend fun resolve(row: PlaybackPositionEntity): VodContinueWatchingItem? {
        // The DAO already filters to `vod:`, but the key is validated again here:
        // this is the function that decides what reaches the UI, and a malformed
        // key must not be guessed into a wrong title.
        val (contentType, contentId) = WatchProgressContentKey.serverKey(row.channelId)
            ?: return null

        return when (contentType) {
            "movie" -> when (val result = catalogRepository.getMovieById(contentId)) {
                is Result.Success -> VodContinueWatchingItem(
                    localKey = row.channelId,
                    contentType = contentType,
                    contentId = contentId,
                    title = result.data.title,
                    posterUrl = result.data.poster?.takeIf { it.isNotBlank() },
                    subtitle = result.data.year?.takeIf { it > 0 }?.toString(),
                    positionMs = row.position,
                    durationMs = row.duration,
                    progress = progressOf(row.position, row.duration),
                )
                is Result.Error -> null
            }

            "episode" -> when (val result = catalogRepository.getEpisodeById(contentId)) {
                is Result.Success -> {
                    val episode = result.data
                    VodContinueWatchingItem(
                        localKey = row.channelId,
                        contentType = contentType,
                        contentId = contentId,
                        // The card names the series, not the episode: two episodes of
                        // one series would otherwise be indistinguishable posters.
                        title = episode.seriesTitle.ifBlank { episode.title },
                        posterUrl = (episode.seriesPoster ?: episode.thumbnail)?.takeIf { it.isNotBlank() },
                        subtitle = episodeSubtitle(episode),
                        positionMs = row.position,
                        durationMs = row.duration,
                        progress = progressOf(row.position, row.duration),
                    )
                }
                is Result.Error -> null
            }

            // `series` and `live` have no resolvable card here: a series is played
            // through one of its episodes, and live channels keep their own rail.
            else -> null
        }
    }

    /** "الموسم ٢ · الحلقة ٣" — Arabic-first, like the rest of the UI. */
    private fun episodeSubtitle(episode: EpisodeDetail): String? {
        val season = episode.seasonNumber?.takeIf { it > 0 }?.let { "الموسم $it" }
            ?: episode.seasonName.takeIf { it.isNotBlank() }
        val number = episode.episodeNumber.takeIf { it > 0 }?.let { "الحلقة $it" }
        return listOfNotNull(season, number).takeIf { it.isNotEmpty() }?.joinToString(" · ")
    }

    /**
     * Progress as a 0f..1f fraction. A zero/unknown duration yields 0f rather than
     * a division by zero or a 100% bar, and a position past the duration is
     * clamped instead of overflowing the track.
     */
    private fun progressOf(positionMs: Long, durationMs: Long): Float =
        if (durationMs <= 0L) {
            0f
        } else {
            (positionMs.toDouble() / durationMs.toDouble()).coerceIn(0.0, 1.0).toFloat()
        }
}
