package com.dzhoof.iptv.presentation.viewmodel

import com.dzhoof.iptv.MainDispatcherRule
import com.dzhoof.iptv.presentation.model.UpdateInfo
import com.dzhoof.iptv.update.AppUpdater
import com.dzhoof.iptv.update.UpdateManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AppUpdateViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val appUpdater: AppUpdater = mockk(relaxed = true)
    private val updateManager: UpdateManager = mockk(relaxed = true)
    private val update = UpdateInfo(
        versionName = "2.1.0",
        releaseNotes = "تحسينات Live TV",
        fileSize = "12 MB",
        downloadUrl = "https://example.test/dzhoof.apk",
        isMandatory = false,
    )

    private fun viewModel() =
        AppUpdateViewModel(appUpdater, updateManager, mainDispatcherRule.testDispatcher)

    @Test
    fun `checks for an update only once and publishes available update`() = runTest {
        coEvery { updateManager.check(UpdateManager.Trigger.APP_LAUNCH, any()) } returns
            UpdateManager.Outcome.Available(update)
        val viewModel = viewModel()

        viewModel.checkForUpdate()
        viewModel.checkForUpdate()
        advanceUntilIdle()

        assertEquals(update, viewModel.uiState.value.updateInfo)
        coVerify(exactly = 1) { updateManager.check(UpdateManager.Trigger.APP_LAUNCH, any()) }
    }

    @Test
    fun `a cooldown-skipped check shows no update prompt`() = runTest {
        coEvery { updateManager.check(UpdateManager.Trigger.APP_LAUNCH, any()) } returns
            UpdateManager.Outcome.Skipped
        val viewModel = viewModel()

        viewModel.checkForUpdate()
        advanceUntilIdle()

        assertNull(viewModel.uiState.value.updateInfo)
    }

    @Test
    fun `dismiss marks the update overlay as dismissed`() = runTest {
        val viewModel = viewModel()

        viewModel.dismiss()

        assertTrue(viewModel.uiState.value.dismissed)
    }

    @Test
    fun `download failure clears progress and exposes the localized updater error`() = runTest {
        coEvery { updateManager.check(UpdateManager.Trigger.APP_LAUNCH, any()) } returns
            UpdateManager.Outcome.Available(update)
        every { appUpdater.downloadAndInstall(update, any()) } answers {
            secondArg<(AppUpdater.DownloadState) -> Unit>()(
                AppUpdater.DownloadState.Failed("تعذر تثبيت التحديث"),
            )
        }
        val viewModel = viewModel()
        viewModel.checkForUpdate()
        advanceUntilIdle()

        viewModel.downloadAndInstallUpdate()
        advanceUntilIdle()

        assertEquals(false, viewModel.uiState.value.isDownloading)
        assertEquals("تعذر تثبيت التحديث", viewModel.uiState.value.downloadError)
    }
}
