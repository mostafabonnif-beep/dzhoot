package com.dzhoof.iptv.update

import com.dzhoof.iptv.presentation.model.UpdateInfo
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateSchedulePolicyTest {

    @Test
    fun `a device that never checked is always due`() {
        assertTrue(UpdateSchedulePolicy.isDue(nowMillis = 1_000L, lastCheckAtMillis = 0L, cooldownMillis = 60_000L))
    }

    @Test
    fun `respects the cooldown boundary`() {
        val cooldown = 60_000L
        assertFalse(UpdateSchedulePolicy.isDue(100_000L, 100_000L, cooldown))
        assertFalse(UpdateSchedulePolicy.isDue(159_999L, 100_000L, cooldown))
        assertTrue(UpdateSchedulePolicy.isDue(160_000L, 100_000L, cooldown))
    }

    @Test
    fun `a clock that moved backwards is treated as due instead of blocking forever`() {
        assertTrue(UpdateSchedulePolicy.isDue(nowMillis = 500L, lastCheckAtMillis = 100_000L, cooldownMillis = 60_000L))
    }

    @Test
    fun `clamps the periodic cadence into the required 6 to 24 hour window`() {
        assertEquals(6, UpdateSchedulePolicy.periodicIntervalHours(1))
        assertEquals(12, UpdateSchedulePolicy.periodicIntervalHours())
        assertEquals(24, UpdateSchedulePolicy.periodicIntervalHours(72))
        assertEquals(18, UpdateSchedulePolicy.periodicIntervalHours(18))
    }

    @Test
    fun `foreground cooldown is shorter than the background cadence`() {
        assertTrue(
            UpdateSchedulePolicy.foregroundCooldownMillis() <
                UpdateSchedulePolicy.periodicCooldownMillis(),
        )
    }
}

class UpdateManagerTest {

    private class FakeRepository(var result: UpdateRepository.Result) : UpdateRepository {
        var calls = 0
        override suspend fun fetchAvailableUpdate(): UpdateRepository.Result {
            calls += 1
            return result
        }
    }

    private class FakeStore(var lastCheckAt: Long = 0L) : UpdateCheckStore {
        val records = mutableListOf<Pair<Long, String>>()
        override fun lastCheckAtMillis(): Long = lastCheckAt
        override fun recordCheck(checkedAtMillis: Long, resultCode: String) {
            records += checkedAtMillis to resultCode
            lastCheckAt = checkedAtMillis
        }
    }

    private val update = UpdateInfo(
        versionName = "1.4.2",
        releaseNotes = "",
        fileSize = "26 MB",
        downloadUrl = "https://github.com/mostafabonnif-beep/dzhoot/releases/download/v1.4.2/app.apk",
        isMandatory = false,
        versionCode = 10402,
    )

    @Test
    fun `an available update is returned and recorded`() = runTest {
        val repository = FakeRepository(UpdateRepository.Result.Found(update))
        val store = FakeStore()
        val manager = UpdateManager(repository, store)

        val outcome = manager.check(UpdateManager.Trigger.APP_LAUNCH, nowMillis = 5_000L)

        assertEquals(UpdateManager.Outcome.Available(update), outcome)
        assertEquals(listOf(5_000L to "available"), store.records)
    }

    @Test
    fun `the foreground cooldown skips a check that is not due`() = runTest {
        val repository = FakeRepository(UpdateRepository.Result.UpToDate)
        val store = FakeStore(lastCheckAt = 1_000L)
        val manager = UpdateManager(repository, store)

        val outcome = manager.check(
            UpdateManager.Trigger.APP_LAUNCH,
            nowMillis = 1_000L + UpdateSchedulePolicy.foregroundCooldownMillis() - 1,
        )

        assertEquals(UpdateManager.Outcome.Skipped, outcome)
        assertEquals(0, repository.calls)
        assertTrue(store.records.isEmpty())
    }

    @Test
    fun `the periodic trigger uses the 6 to 24 hour cadence`() = runTest {
        val repository = FakeRepository(UpdateRepository.Result.UpToDate)
        val store = FakeStore(lastCheckAt = 1_000L)
        val manager = UpdateManager(repository, store)

        // Just past the foreground cooldown, but far from the background interval.
        val tooSoon = manager.check(
            UpdateManager.Trigger.PERIODIC,
            nowMillis = 1_000L + UpdateSchedulePolicy.foregroundCooldownMillis() + 1,
        )
        assertEquals(UpdateManager.Outcome.Skipped, tooSoon)

        val due = manager.check(
            UpdateManager.Trigger.PERIODIC,
            nowMillis = 1_000L + UpdateSchedulePolicy.periodicCooldownMillis(),
        )
        assertEquals(UpdateManager.Outcome.UpToDate, due)
        assertEquals(1, repository.calls)
    }

    @Test
    fun `a manual check ignores the cooldown`() = runTest {
        val repository = FakeRepository(UpdateRepository.Result.UpToDate)
        val store = FakeStore(lastCheckAt = 9_000L)
        val manager = UpdateManager(repository, store)

        val outcome = manager.check(UpdateManager.Trigger.MANUAL, nowMillis = 9_001L)

        assertEquals(UpdateManager.Outcome.UpToDate, outcome)
        assertEquals(1, repository.calls)
    }

    @Test
    fun `a failed check is recorded so it cannot loop`() = runTest {
        val repository = FakeRepository(
            UpdateRepository.Result.Failed(UpdateErrorCode.UPDATE_CHECK_NETWORK),
        )
        val store = FakeStore()
        val manager = UpdateManager(repository, store)

        val outcome = manager.check(UpdateManager.Trigger.PERIODIC, nowMillis = 7_000L)

        assertEquals(UpdateManager.Outcome.Failed(UpdateErrorCode.UPDATE_CHECK_NETWORK), outcome)
        assertEquals(listOf(7_000L to "UPDATE_CHECK_NETWORK"), store.records)

        // The next automatic attempt inside the interval is skipped, so a dead provider is
        // not retried in a tight loop.
        val again = manager.check(UpdateManager.Trigger.PERIODIC, nowMillis = 7_001L)
        assertEquals(UpdateManager.Outcome.Skipped, again)
        assertEquals(1, repository.calls)
    }
}
