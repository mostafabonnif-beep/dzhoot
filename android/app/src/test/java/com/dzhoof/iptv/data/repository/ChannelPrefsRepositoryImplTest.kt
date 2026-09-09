package com.dzhoof.iptv.data.repository

import com.dzhoof.iptv.data.source.local.dao.ChannelPrefsDao
import com.dzhoof.iptv.data.source.local.entity.ChannelPrefsEntity
import com.dzhoof.iptv.domain.model.ChannelPrefs
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChannelPrefsRepositoryImplTest {

    private val dao: ChannelPrefsDao = mockk()
    private val testDispatcher = StandardTestDispatcher()

    private lateinit var repository: ChannelPrefsRepositoryImpl

    @Before
    fun setup() {
        repository = ChannelPrefsRepositoryImpl(dao = dao, dispatcher = testDispatcher)
        // Write paths are asserted with coVerify; strict mockk still needs answers.
        coEvery { dao.upsert(any()) } returns Unit
        coEvery { dao.delete(any()) } returns Unit
    }

    // ── Flow mapping ──────────────────────────────────────────────────

    @Test
    fun `observeHiddenIds maps dao ids to a set`() = runTest(testDispatcher) {
        every { dao.observeHiddenIds() } returns flowOf(listOf("ch1", "ch2", "ch1"))

        val emitted = mutableListOf<Set<String>>()
        val job = launch { repository.observeHiddenIds().collect { emitted.add(it) } }
        advanceUntilIdle()

        assertEquals(listOf(setOf("ch1", "ch2")), emitted)
        job.cancel()
    }

    @Test
    fun `observeHiddenIds dedups consecutive identical sets`() = runTest(testDispatcher) {
        every { dao.observeHiddenIds() } returns flow {
            emit(listOf("ch1"))
            emit(listOf("ch1")) // unchanged set — distinctUntilChanged suppresses
            emit(listOf("ch1", "ch2"))
        }

        val emitted = mutableListOf<Set<String>>()
        val job = launch { repository.observeHiddenIds().collect { emitted.add(it) } }
        advanceUntilIdle()

        assertEquals(listOf(setOf("ch1"), setOf("ch1", "ch2")), emitted)
        job.cancel()
    }

    @Test
    fun `observeLockedIds maps dao ids to a set`() = runTest(testDispatcher) {
        every { dao.observeLockedIds() } returns flowOf(listOf("ch9"))

        val emitted = mutableListOf<Set<String>>()
        val job = launch { repository.observeLockedIds().collect { emitted.add(it) } }
        advanceUntilIdle()

        assertEquals(listOf(setOf("ch9")), emitted)
        job.cancel()
    }

    @Test
    fun `observePrefs maps entities into a channelId map`() = runTest(testDispatcher) {
        every { dao.observeAll() } returns flowOf(
            listOf(
                ChannelPrefsEntity(channelId = "ch1", hidden = true, locked = false),
                ChannelPrefsEntity(channelId = "ch2", hidden = false, locked = true)
            )
        )

        val emitted = mutableListOf<Map<String, ChannelPrefs>>()
        val job = launch { repository.observePrefs().collect { emitted.add(it) } }
        advanceUntilIdle()

        val map = emitted.single()
        assertEquals(setOf("ch1", "ch2"), map.keys)
        assertTrue(map.getValue("ch1").hidden)
        assertFalse(map.getValue("ch1").locked)
        assertFalse(map.getValue("ch2").hidden)
        assertTrue(map.getValue("ch2").locked)
        job.cancel()
    }

    // ── setHidden / setLocked row lifecycle ───────────────────────────

    @Test
    fun `setHidden true without a row upserts a new row`() = runTest(testDispatcher) {
        coEvery { dao.get("ch1") } returns null
        coEvery { dao.upsert(any()) } returns Unit

        repository.setHidden("ch1", true)

        coVerify(exactly = 1) {
            dao.upsert(
                match {
                    it.channelId == "ch1" && it.hidden && !it.locked
                }
            )
        }
        coVerify(exactly = 0) { dao.delete(any()) }
    }

    @Test
    fun `setHidden true preserves an existing locked flag`() = runTest(testDispatcher) {
        coEvery { dao.get("ch1") } returns ChannelPrefsEntity(channelId = "ch1", locked = true)
        coEvery { dao.upsert(any()) } returns Unit

        repository.setHidden("ch1", true)

        coVerify(exactly = 1) {
            dao.upsert(
                match { it.channelId == "ch1" && it.hidden && it.locked }
            )
        }
    }

    @Test
    fun `setHidden false with nothing left set deletes the row`() = runTest(testDispatcher) {
        coEvery { dao.get("ch1") } returns ChannelPrefsEntity(channelId = "ch1", hidden = true, locked = false)
        coEvery { dao.delete("ch1") } returns Unit

        repository.setHidden("ch1", false)

        coVerify(exactly = 1) { dao.delete("ch1") }
        coVerify(exactly = 0) { dao.upsert(any()) }
    }

    @Test
    fun `setHidden false keeps the row when still locked`() = runTest(testDispatcher) {
        coEvery { dao.get("ch1") } returns ChannelPrefsEntity(channelId = "ch1", hidden = true, locked = true)
        coEvery { dao.upsert(any()) } returns Unit

        repository.setHidden("ch1", false)

        coVerify(exactly = 1) {
            dao.upsert(match { it.channelId == "ch1" && !it.hidden && it.locked })
        }
        coVerify(exactly = 0) { dao.delete(any()) }
    }

    @Test
    fun `setLocked true preserves an existing hidden flag`() = runTest(testDispatcher) {
        coEvery { dao.get("ch2") } returns ChannelPrefsEntity(channelId = "ch2", hidden = true)
        coEvery { dao.upsert(any()) } returns Unit

        repository.setLocked("ch2", true)

        coVerify(exactly = 1) {
            dao.upsert(match { it.channelId == "ch2" && it.hidden && it.locked })
        }
    }

    @Test
    fun `setLocked false without a row never upserts and issues a no-op delete`() = runTest(testDispatcher) {
        coEvery { dao.get("ch2") } returns null

        repository.setLocked("ch2", false)

        coVerify(exactly = 0) { dao.upsert(any()) }
        coVerify(exactly = 1) { dao.delete("ch2") }
    }

    // ── Point queries ─────────────────────────────────────────────────

    @Test
    fun `isHidden returns false when no row exists`() = runTest(testDispatcher) {
        coEvery { dao.get("ch1") } returns null

        assertFalse(repository.isHidden("ch1"))
    }

    @Test
    fun `isHidden and isLocked reflect the stored row`() = runTest(testDispatcher) {
        coEvery { dao.get("ch1") } returns ChannelPrefsEntity(channelId = "ch1", hidden = true, locked = false)

        assertTrue(repository.isHidden("ch1"))
        assertFalse(repository.isLocked("ch1"))
    }

    @Test
    fun `isLocked returns true when row is locked`() = runTest(testDispatcher) {
        coEvery { dao.get("ch3") } returns ChannelPrefsEntity(channelId = "ch3", locked = true)

        assertTrue(repository.isLocked("ch3"))
        assertFalse(repository.isHidden("ch3"))
    }
}
