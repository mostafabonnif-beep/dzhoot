package com.dzhoof.iptv.presentation.viewmodel

import com.dzhoof.iptv.MainDispatcherRule
import com.dzhoof.iptv.data.source.local.dao.ChannelDao
import com.dzhoof.iptv.data.source.local.entity.ChannelEntity
import com.dzhoof.iptv.domain.model.ChannelPrefs
import com.dzhoof.iptv.domain.repository.ChannelPrefsRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ManageChannelsViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val channelDao: ChannelDao = mockk()
    private val channelPrefsRepository: ChannelPrefsRepository = mockk()

    private val channelsFlow = MutableStateFlow(
        listOf(
            entity("ch1", "الجزيرة"),
            entity("ch2", "بي إن سبورت")
        )
    )
    private val prefsFlow = MutableStateFlow<Map<String, ChannelPrefs>>(
        mapOf("ch1" to ChannelPrefs(channelId = "ch1", hidden = true))
    )

    private fun entity(id: String, name: String, category: String = "News") = ChannelEntity(
        id = id,
        name = name,
        streamUrl = "http://test/$id.m3u8",
        logoUrl = null,
        categoryId = category,
        language = null,
        country = null,
        groupTitle = null,
        order = 0,
        tvgId = null,
        tvgName = null,
        catchupType = null,
        catchupDays = null,
        isActive = true,
        lastUpdated = 0L
    )

    @Before
    fun setup() {
        every { channelDao.getAllChannels() } returns channelsFlow
        every { channelPrefsRepository.observePrefs() } returns prefsFlow
        // Setters are verified via coVerify; strict mockk needs answers defined.
        coEvery { channelPrefsRepository.setHidden(any(), any()) } returns Unit
        coEvery { channelPrefsRepository.setLocked(any(), any()) } returns Unit
    }

    private fun createViewModel() = ManageChannelsViewModel(
        channelDao = channelDao,
        channelPrefsRepository = channelPrefsRepository
    )

    @Test
    fun `combines channels with prefs into rows`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.rows.size)
        assertFalse(vm.uiState.value.isLoading)

        val first = vm.uiState.value.rows[0]
        assertEquals("ch1", first.channelId)
        assertEquals("الجزيرة", first.name)
        assertTrue(first.hidden)
        assertFalse(first.locked)

        val second = vm.uiState.value.rows[1]
        assertEquals("ch2", second.channelId)
        assertFalse(second.hidden)
        assertFalse(second.locked)
    }

    @Test
    fun `prefs changes propagate into rows reactively`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.rows[0].hidden)

        // Unhide ch1 via the repository flow (as a write elsewhere would)
        prefsFlow.value = emptyMap()
        runCurrent()

        assertFalse(vm.uiState.value.rows[0].hidden)
    }

    @Test
    fun `rows without prefs default to not hidden and not locked`() = runTest {
        prefsFlow.value = emptyMap()
        val vm = createViewModel()
        advanceUntilIdle()

        vm.uiState.value.rows.forEach { row ->
            assertFalse(row.hidden)
            assertFalse(row.locked)
        }
    }

    @Test
    fun `setHidden delegates to the repository`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.setHidden("ch2", true)
        advanceUntilIdle()

        coVerify(exactly = 1) { channelPrefsRepository.setHidden("ch2", true) }
    }

    @Test
    fun `setLocked delegates to the repository`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.setLocked("ch1", true)
        advanceUntilIdle()

        coVerify(exactly = 1) { channelPrefsRepository.setLocked("ch1", true) }
    }

    @Test
    fun `loading flag flips false after the first emission`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `row order follows the dao channel order`() = runTest {
        val custom = MutableStateFlow(
            listOf(entity("zz", "Zed"), entity("aa", "Alpha"))
        )
        every { channelDao.getAllChannels() } returns custom
        prefsFlow.value = emptyMap()

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals(listOf("zz", "aa"), vm.uiState.value.rows.map { it.channelId })
    }
}
