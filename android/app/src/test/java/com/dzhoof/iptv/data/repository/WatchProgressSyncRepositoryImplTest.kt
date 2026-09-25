package com.dzhoof.iptv.data.repository

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.model.dto.WatchProgressDto
import com.dzhoof.iptv.data.source.local.PlaybackLocalDataSource
import com.dzhoof.iptv.data.source.local.entity.PlaybackPositionEntity
import com.dzhoof.iptv.data.source.remote.WatchProgressRemoteDataSource
import io.mockk.Runs
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for the cross-device Continue Watching mirror.
 *
 * They pin the three rules that make it safe to run behind the player:
 *   1. a push is fire-and-forget and can never fail the caller;
 *   2. a pull never overwrites a locally-newer position (newest wins);
 *   3. a completed row removes the local one instead of resurrecting it.
 *
 * Requirements: US-004.4 (playback position saved and restored)
 */
class WatchProgressSyncRepositoryImplTest {

    private lateinit var remoteDataSource: WatchProgressRemoteDataSource
    private lateinit var localDataSource: PlaybackLocalDataSource
    private lateinit var repository: WatchProgressSyncRepositoryImpl
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        remoteDataSource = mockk(relaxed = true)
        localDataSource = mockk(relaxed = true)
        repository = WatchProgressSyncRepositoryImpl(
            remoteDataSource = remoteDataSource,
            localDataSource = localDataSource,
            dispatcher = testDispatcher,
        )
    }

    // ---------------------------------------------------------------- pushes

    @Test
    fun `a recorded position is pushed as seconds under the mapped key`() = runTest(testDispatcher) {
        // Given
        coEvery { remoteDataSource.upsert(any(), any(), any(), any()) } returns Result.Success(Unit)

        // When — a 30s position in a 2 minute movie, stored locally as milliseconds.
        repository.enqueueSave("vod:movie:m1", positionMs = 30_000L, durationMs = 120_000L)
        advanceUntilIdle()

        // Then the local key was mapped to the server pair and ms became seconds.
        coVerify(exactly = 1) { remoteDataSource.upsert("movie", "m1", 30.0, 120.0) }
    }

    @Test
    fun `live tv is pushed without a duration`() = runTest(testDispatcher) {
        // Live has no duration; sending 0 would let the server mark it completed
        // (>=95% of duration) and drop the channel out of Continue Watching.
        coEvery { remoteDataSource.upsert(any(), any(), any(), any()) } returns Result.Success(Unit)

        repository.enqueueSave("ch-1", positionMs = 60_000L, durationMs = 0L)
        advanceUntilIdle()

        coVerify(exactly = 1) { remoteDataSource.upsert("live", "ch-1", 60.0, null) }
    }

    @Test
    fun `a push that fails is swallowed`() = runTest(testDispatcher) {
        // Given the network is gone
        coEvery { remoteDataSource.upsert(any(), any(), any(), any()) } throws
            java.io.IOException("offline")

        // When / Then — nothing escapes to the caller that just saved locally.
        repository.enqueueSave("ch-1", positionMs = 60_000L, durationMs = 0L)
        advanceUntilIdle()
    }

    @Test
    fun `an unmappable local key is never pushed`() = runTest(testDispatcher) {
        repository.enqueueSave("vod:audiobook:a1", positionMs = 60_000L, durationMs = 0L)
        repository.enqueueSave("vod:movie", positionMs = 60_000L, durationMs = 0L)
        advanceUntilIdle()

        coVerify(exactly = 0) { remoteDataSource.upsert(any(), any(), any(), any()) }
    }

    @Test
    fun `deleting a position removes it on the account`() = runTest(testDispatcher) {
        coEvery { remoteDataSource.remove(any(), any()) } returns Result.Success(Unit)

        repository.enqueueDelete("vod:episode:e9")
        advanceUntilIdle()

        coVerify(exactly = 1) { remoteDataSource.remove("episode", "e9") }
    }

    // ----------------------------------------------------------------- pulls

    @Test
    fun `a newer remote row is written into the local table`() = runTest(testDispatcher) {
        // Given
        every { localDataSource.getAllPositions() } returns flowOf(emptyList())
        coEvery { localDataSource.savePosition(any()) } just Runs
        coEvery { remoteDataSource.fetchContinueWatching(any()) } returns Result.Success(
            listOf(
                WatchProgressDto(
                    contentId = "m1",
                    contentType = "movie",
                    positionSec = 300.0,
                    durationSec = 600.0,
                    completed = false,
                    updatedAt = "2026-09-25T01:00:00.000Z",
                )
            )
        )
        val saved = slot<PlaybackPositionEntity>()
        coEvery { localDataSource.savePosition(capture(saved)) } just Runs

        // When
        val result = repository.pullIntoLocal()

        // Then
        assertTrue(result is Result.Success)
        assertEquals(1, (result as Result.Success).data)
        assertEquals("vod:movie:m1", saved.captured.channelId)
        assertEquals(300_000L, saved.captured.position)
        assertEquals(600_000L, saved.captured.duration)
        // The server timestamp is kept so the next pull can still order the two sides.
        assertEquals(1_790_298_000_000L, saved.captured.lastPlayed)
    }

    @Test
    fun `a locally newer position is not overwritten`() = runTest(testDispatcher) {
        // Given the viewer watched this on THIS device after the server row was written.
        val localNewer = PlaybackPositionEntity(
            channelId = "vod:movie:m1",
            position = 500_000L,
            duration = 600_000L,
            lastPlayed = 1_790_298_600_000L, // 2026-09-25T01:10:00Z
        )
        every { localDataSource.getAllPositions() } returns flowOf(listOf(localNewer))
        coEvery { remoteDataSource.fetchContinueWatching(any()) } returns Result.Success(
            listOf(
                WatchProgressDto(
                    contentId = "m1",
                    contentType = "movie",
                    positionSec = 300.0,
                    durationSec = 600.0,
                    completed = false,
                    updatedAt = "2026-09-25T01:00:00.000Z",
                )
            )
        )

        // When
        val result = repository.pullIntoLocal()

        // Then nothing was written: the local position is what the viewer last saw.
        assertTrue(result is Result.Success)
        assertEquals(0, (result as Result.Success).data)
        coVerify(exactly = 0) { localDataSource.savePosition(any()) }
    }

    @Test
    fun `a completed remote row removes the local row`() = runTest(testDispatcher) {
        // Given a row the viewer finished elsewhere (>=95% of duration on the server)
        val stale = PlaybackPositionEntity("vod:movie:m1", 300_000L, 600_000L, 1_790_297_000_000L)
        every { localDataSource.getAllPositions() } returns flowOf(listOf(stale))
        coEvery { remoteDataSource.fetchContinueWatching(any()) } returns Result.Success(
            listOf(
                WatchProgressDto(
                    contentId = "m1",
                    contentType = "movie",
                    positionSec = 590.0,
                    durationSec = 600.0,
                    completed = true,
                    updatedAt = "2026-09-25T01:00:00.000Z",
                )
            )
        )

        // When
        val result = repository.pullIntoLocal()

        // Then it leaves Continue Watching instead of resuming at the end.
        assertEquals(1, (result as Result.Success).data)
        coVerify(exactly = 1) { localDataSource.deletePosition("vod:movie:m1") }
        coVerify(exactly = 0) { localDataSource.savePosition(any()) }
    }

    @Test
    fun `unusable remote rows are skipped and the rest still apply`() = runTest(testDispatcher) {
        // Given one good row surrounded by rows the app cannot or should not use.
        every { localDataSource.getAllPositions() } returns flowOf(emptyList())
        coEvery { localDataSource.savePosition(any()) } just Runs
        coEvery { remoteDataSource.fetchContinueWatching(any()) } returns Result.Success(
            listOf(
                WatchProgressDto("a1", "audiobook", 300.0, 600.0, false, "2026-09-25T01:00:00.000Z"),
                WatchProgressDto("m1", "movie", 5.0, 600.0, false, "2026-09-25T01:00:00.000Z"),
                WatchProgressDto(null, "movie", 300.0, 600.0, false, "2026-09-25T01:00:00.000Z"),
                WatchProgressDto("ch-1", "live", 120.0, null, false, "2026-09-25T01:00:00.000Z"),
            )
        )

        // When
        val result = repository.pullIntoLocal()

        // Then only the live row landed: unknown type skipped, sub-10s skipped,
        // missing id skipped.
        assertEquals(1, (result as Result.Success).data)
        coVerify(exactly = 1) { localDataSource.savePosition(any()) }
    }

    @Test
    fun `an unparseable timestamp still applies the row`() = runTest(testDispatcher) {
        // Degrading to "unknown age" is better than dropping a real position.
        every { localDataSource.getAllPositions() } returns flowOf(emptyList())
        coEvery { localDataSource.savePosition(any()) } just Runs
        coEvery { remoteDataSource.fetchContinueWatching(any()) } returns Result.Success(
            listOf(WatchProgressDto("ch-1", "live", 120.0, null, false, "not-a-date"))
        )

        val result = repository.pullIntoLocal()

        assertEquals(1, (result as Result.Success).data)
    }

    @Test
    fun `a failed fetch reports an error and writes nothing`() = runTest(testDispatcher) {
        coEvery { remoteDataSource.fetchContinueWatching(any()) } returns
            Result.Error(java.io.IOException("offline"))

        val result = repository.pullIntoLocal()

        assertTrue(result is Result.Error)
        coVerify(exactly = 0) { localDataSource.savePosition(any()) }
        coVerify(exactly = 0) { localDataSource.deletePosition(any()) }
    }
}
