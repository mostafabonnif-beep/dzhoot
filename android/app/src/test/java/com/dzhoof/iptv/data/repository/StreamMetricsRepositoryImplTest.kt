package com.dzhoof.iptv.data.repository

import android.app.Application
import android.content.pm.PackageManager
import com.dzhoof.iptv.BuildConfig
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.model.dto.PlaybackQoeReport
import com.dzhoof.iptv.data.source.local.dao.StreamMetricsDao
import com.dzhoof.iptv.data.source.local.entity.StreamMetricsEntity
import com.dzhoof.iptv.data.source.remote.DzhoofApiService
import com.dzhoof.iptv.domain.repository.HealthSyncEntry
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class StreamMetricsRepositoryImplTest {

    private val streamMetricsDao: StreamMetricsDao = mockk(relaxed = true)
    private val apiService: DzhoofApiService = mockk(relaxed = true)
    private val application: Application = mockk(relaxed = true)
    private val testDispatcher = UnconfinedTestDispatcher()

    private fun createRepo() = StreamMetricsRepositoryImpl(
        streamMetricsDao = streamMetricsDao,
        apiService = apiService,
        application = application,
        dispatcher = testDispatcher
    )

    @Before
    fun setup() {
        // By default, getByChannelId returns null — so upsert will be called
        coEvery { streamMetricsDao.getByChannelId(any()) } returns null
        coEvery { streamMetricsDao.upsert(any()) } returns Unit
        coEvery { streamMetricsDao.incrementDead(any(), any()) } returns Unit
        coEvery { streamMetricsDao.incrementAlive(any(), any()) } returns Unit
        coEvery { streamMetricsDao.incrementUnresponsive(any(), any()) } returns Unit
        coEvery { streamMetricsDao.incrementPlay(any(), any()) } returns Unit
    }

    @Test
    fun `reportStreamDead upserts row and increments dead count`() = runTest {
        val repo = createRepo()

        val result = repo.reportStreamDead("ch1", "Stream unavailable")

        assertTrue(result is Result.Success)
        coVerify { streamMetricsDao.upsert(match { it.channelId == "ch1" }) }
        coVerify { streamMetricsDao.incrementDead("ch1", any()) }
    }

    @Test
    fun `reportStreamDead skips upsert when row already exists`() = runTest {
        coEvery { streamMetricsDao.getByChannelId("ch1") } returns StreamMetricsEntity(channelId = "ch1")

        val repo = createRepo()
        repo.reportStreamDead("ch1", null)

        coVerify(exactly = 0) { streamMetricsDao.upsert(any()) }
        coVerify { streamMetricsDao.incrementDead("ch1", any()) }
    }

    @Test
    fun `reportStreamAlive upserts row and increments alive count`() = runTest {
        val repo = createRepo()

        val result = repo.reportStreamAlive("ch2")

        assertTrue(result is Result.Success)
        coVerify { streamMetricsDao.upsert(match { it.channelId == "ch2" }) }
        coVerify { streamMetricsDao.incrementAlive("ch2", any()) }
    }

    @Test
    fun `reportStreamUnresponsive increments unresponsive count`() = runTest {
        val repo = createRepo()

        val result = repo.reportStreamUnresponsive("ch3")

        assertTrue(result is Result.Success)
        coVerify { streamMetricsDao.incrementUnresponsive("ch3", any()) }
    }

    @Test
    fun `reportStreamPlay increments play count`() = runTest {
        val repo = createRepo()

        val result = repo.reportStreamPlay("ch4", proxyPlay = false, streamUrl = "http://stream.m3u8")

        assertTrue(result is Result.Success)
        coVerify { streamMetricsDao.incrementPlay("ch4", any()) }
    }

    @Test
    fun `reportStreamDead returns Success even when api call fails`() = runTest {
        coEvery { apiService.reportStreamStatus(any(), any()) } throws Exception("Network error")

        val repo = createRepo()
        val result = repo.reportStreamDead("ch1", "error")

        // Local DB succeeded; API failure is fire-and-forget
        assertTrue(result is Result.Success)
        coVerify { streamMetricsDao.incrementDead("ch1", any()) }
    }

    @Test
    fun `syncHealthResults increments correct counters per status`() = runTest {
        val repo = createRepo()

        val entries = listOf(
            HealthSyncEntry(channelId = "ch1", status = "alive", responseTimeMs = 100L, timestamp = 1000L),
            HealthSyncEntry(channelId = "ch2", status = "dead", responseTimeMs = 0L, timestamp = 1000L),
            HealthSyncEntry(channelId = "ch3", status = "unresponsive", responseTimeMs = 0L, timestamp = 1000L),
            HealthSyncEntry(channelId = "ch4", status = "online", responseTimeMs = 50L, timestamp = 1000L)
        )

        val result = repo.syncHealthResults(entries)

        assertTrue(result is Result.Success)
        coVerify { streamMetricsDao.incrementAlive("ch1", 1000L) }
        coVerify { streamMetricsDao.incrementDead("ch2", 1000L) }
        coVerify { streamMetricsDao.incrementUnresponsive("ch3", 1000L) }
        coVerify { streamMetricsDao.incrementAlive("ch4", 1000L) }
    }

    @Test
    fun `syncHealthResults returns Success even when api call fails`() = runTest {
        coEvery { apiService.syncHealthResults(any()) } throws Exception("server error")

        val repo = createRepo()
        val result = repo.syncHealthResults(
            listOf(HealthSyncEntry("ch1", "alive", 100L, 1000L))
        )

        assertTrue(result is Result.Success)
    }

    // ── Playback QoE payload ─────────────────────────────────────
    // Production playback events all carried appVersion = null and a
    // hardcoded platform = "android_tv", so playback quality could never be
    // attributed to a build or a form factor. These tests keep that fixed.

    private fun stubLeanback(isTv: Boolean) {
        val packageManager = mockk<PackageManager>(relaxed = true)
        every { application.packageManager } returns packageManager
        every { packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK) } returns isTv
    }

    @Test
    fun `reportPlaybackQoe labels a leanback device as android_tv`() = runTest {
        stubLeanback(isTv = true)

        val repo = createRepo()
        repo.reportPlaybackQoe(
            channelId = "ch1",
            eventType = "startup_failure",
            startupMs = 1234L,
            rebufferCount = 0,
            fallbackUsed = false,
            fallbackSucceeded = null,
            errorCode = "ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED"
        )

        val report = slot<PlaybackQoeReport>()
        coVerify { apiService.reportPlaybackQoe("ch1", capture(report)) }

        assertEquals("android_tv", report.captured.platform)
        assertEquals(BuildConfig.VERSION_NAME, report.captured.appVersion)
        assertEquals(
            "ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED",
            report.captured.errorCode
        )
    }

    @Test
    fun `reportPlaybackQoe does not label a phone as a tv`() = runTest {
        stubLeanback(isTv = false)

        val repo = createRepo()
        repo.reportPlaybackQoe(
            channelId = "ch1",
            eventType = "startup_success",
            startupMs = 900L,
            rebufferCount = 0,
            fallbackUsed = false,
            fallbackSucceeded = false,
            errorCode = null
        )

        val report = slot<PlaybackQoeReport>()
        coVerify { apiService.reportPlaybackQoe("ch1", capture(report)) }

        assertEquals("android_mobile", report.captured.platform)
        assertEquals(BuildConfig.VERSION_NAME, report.captured.appVersion)
    }
}
