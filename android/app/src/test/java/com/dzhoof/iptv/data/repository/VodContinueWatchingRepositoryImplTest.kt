package com.dzhoof.iptv.data.repository

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.source.local.dao.PlaybackPositionDao
import com.dzhoof.iptv.data.source.local.entity.PlaybackPositionEntity
import com.dzhoof.iptv.domain.model.EpisodeDetail
import com.dzhoof.iptv.domain.model.Movie
import com.dzhoof.iptv.domain.repository.CatalogRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for Continue Watching of on-demand titles.
 *
 * The behaviour worth pinning is what happens to a row the catalog cannot resolve:
 * a provider that drops a title, or a device whose catalog call fails, must lose
 * that one card rather than blank the whole rail or throw.
 */
class VodContinueWatchingRepositoryImplTest {

    private lateinit var playbackPositionDao: PlaybackPositionDao
    private lateinit var catalogRepository: CatalogRepository
    private lateinit var repository: VodContinueWatchingRepositoryImpl
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        playbackPositionDao = mockk()
        catalogRepository = mockk()
        repository = VodContinueWatchingRepositoryImpl(
            playbackPositionDao = playbackPositionDao,
            catalogRepository = catalogRepository,
            dispatcher = testDispatcher,
        )
    }

    private fun movieRow(position: Long = 300_000L, duration: Long = 600_000L) =
        PlaybackPositionEntity("vod:movie:m1", position, duration, 1_790_298_000_000L)

    private val movie = Movie(
        id = "m1",
        title = "فيلم الاختبار",
        category = "Action",
        poster = "https://cdn.example/m1.jpg",
        backdrop = null,
        description = null,
        year = 2024,
        durationMinutes = 110,
        rating = null,
    )

    private val episodeDetail = EpisodeDetail(
        id = "e9",
        seriesId = "s3",
        seasonId = "se2",
        episodeNumber = 3,
        title = "الحلقة الثالثة",
        description = null,
        thumbnail = "https://cdn.example/e9.jpg",
        durationMinutes = 45,
        seriesTitle = "مسلسل الاختبار",
        seriesPoster = "https://cdn.example/s3.jpg",
        seasonName = "الموسم الثاني",
        seasonNumber = 2,
    )

    @Test
    fun `a movie row becomes a card with the catalog title and progress`() = runTest(testDispatcher) {
        every { playbackPositionDao.observeVodProgress(any()) } returns flowOf(listOf(movieRow()))
        coEvery { catalogRepository.getMovieById("m1") } returns Result.Success(movie)

        val result = repository.observeItems().first()

        assertTrue(result is Result.Success)
        val item = (result as Result.Success).data.single()
        assertEquals("vod:movie:m1", item.localKey)
        assertEquals("movie", item.contentType)
        assertEquals("فيلم الاختبار", item.title)
        assertEquals("https://cdn.example/m1.jpg", item.posterUrl)
        assertEquals(300_000L, item.positionMs)
        assertEquals(0.5f, item.progress, 0.0001f)
    }

    @Test
    fun `an episode row is titled after its series and subtitled with season and number`() =
        runTest(testDispatcher) {
            val row = PlaybackPositionEntity("vod:episode:e9", 60_000L, 2_700_000L)
            every { playbackPositionDao.observeVodProgress(any()) } returns flowOf(listOf(row))
            coEvery { catalogRepository.getEpisodeById("e9") } returns Result.Success(episodeDetail)

            val item = (repository.observeItems().first() as Result.Success).data.single()

            // Two episodes of one series must not look identical in a row of cards.
            assertEquals("مسلسل الاختبار", item.title)
            assertEquals("https://cdn.example/s3.jpg", item.posterUrl)
            assertEquals("الموسم 2 · الحلقة 3", item.subtitle)
        }

    @Test
    fun `a row the catalog cannot resolve is skipped and the rest survive`() = runTest(testDispatcher) {
        val rows = listOf(
            PlaybackPositionEntity("vod:movie:gone", 100_000L, 600_000L),
            movieRow(),
        )
        every { playbackPositionDao.observeVodProgress(any()) } returns flowOf(rows)
        coEvery { catalogRepository.getMovieById("gone") } returns Result.Error(Exception("404"))
        coEvery { catalogRepository.getMovieById("m1") } returns Result.Success(movie)

        val result = repository.observeItems().first()

        // The rail still renders — that is the whole point of skipping per item.
        assertTrue(result is Result.Success)
        assertEquals(listOf("vod:movie:m1"), (result as Result.Success).data.map { it.localKey })
    }

    @Test
    fun `the most recent row stays first`() = runTest(testDispatcher) {
        val rows = listOf(
            PlaybackPositionEntity("vod:movie:m2", 100_000L, 600_000L),
            movieRow(),
        )
        every { playbackPositionDao.observeVodProgress(any()) } returns flowOf(rows)
        coEvery { catalogRepository.getMovieById(any()) } returns Result.Success(movie)

        val keys = (repository.observeItems().first() as Result.Success).data.map { it.localKey }

        assertEquals(listOf("vod:movie:m2", "vod:movie:m1"), keys)
    }

    @Test
    fun `progress is zero without a duration and clamped at one`() = runTest(testDispatcher) {
        val rows = listOf(
            PlaybackPositionEntity("vod:movie:live-like", 900_000L, 0L),
            PlaybackPositionEntity("vod:movie:past-end", 900_000L, 600_000L),
        )
        every { playbackPositionDao.observeVodProgress(any()) } returns flowOf(rows)
        coEvery { catalogRepository.getMovieById(any()) } returns Result.Success(movie)

        val items = (repository.observeItems().first() as Result.Success).data

        assertEquals(0f, items[0].progress, 0.0001f)
        assertEquals(1f, items[1].progress, 0.0001f)
    }

    @Test
    fun `a key that is not resumable on-demand content never reaches the rail`() =
        runTest(testDispatcher) {
            // The DAO filters to `vod:%`, but a malformed key must not be guessed
            // into a title even if one arrives.
            val rows = listOf(
                PlaybackPositionEntity("vod:movie", 100_000L, 600_000L),
                PlaybackPositionEntity("vod:audiobook:a1", 100_000L, 600_000L),
                PlaybackPositionEntity("vod:live:x", 100_000L, 600_000L),
                PlaybackPositionEntity("channel-1", 100_000L, 600_000L),
            )
            every { playbackPositionDao.observeVodProgress(any()) } returns flowOf(rows)

            val result = repository.observeItems().first()

            assertEquals(emptyList<Any>(), (result as Result.Success).data)
            coVerify(exactly = 0) { catalogRepository.getMovieById(any()) }
            coVerify(exactly = 0) { catalogRepository.getEpisodeById(any()) }
        }

    @Test
    fun `a failing query is reported as an error`() = runTest(testDispatcher) {
        every { playbackPositionDao.observeVodProgress(any()) } returns flow {
            throw IllegalStateException("database closed")
        }

        val result = repository.observeItems().first()

        assertTrue(result is Result.Error)
        assertEquals("database closed", (result as Result.Error).exception.message)
    }

    @Test
    fun `a blank poster is normalised away`() = runTest(testDispatcher) {
        every { playbackPositionDao.observeVodProgress(any()) } returns flowOf(listOf(movieRow()))
        coEvery { catalogRepository.getMovieById("m1") } returns
            Result.Success(movie.copy(poster = "   "))

        val item = (repository.observeItems().first() as Result.Success).data.single()

        // An empty string would make the image loader log a failure per card.
        assertNull(item.posterUrl)
    }
}
