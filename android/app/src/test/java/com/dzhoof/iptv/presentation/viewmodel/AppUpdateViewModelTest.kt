package com.dzhoof.iptv.presentation.viewmodel

import com.dzhoof.iptv.MainDispatcherRule
import com.dzhoof.iptv.presentation.model.UpdateInfo
import com.dzhoof.iptv.update.AppUpdater
import io.mockk.any
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AppUpdateViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val appUpdater: AppUpdater = mockk(relaxed = true)
    private val update = UpdateInfo(
        versionName = "2.1.0",
        releaseNotes = "تحسينات Live TV",
        fileSize = "12 MB",
        downloadUrl = "https://example.test/dzhoof.apk",
        isMandatory = false,
    )

    @Test
    fun `checks for an update only once and publishes available update`() = runTest {
        every { appUpdater.check() } returns update
        val viewModel = AppUpdateViewModel(appUpdater)

        viewModel.checkForUpdate()
        viewModel.checkForUpdate()
        advanceUntilIdle()

        assertEquals(update, viewModel.uiState.value.updateInfo)
        verify(exactly = 1) { appUpdater.check() }
    }

    @Test
    fun `dismiss marks the update overlay as dismissed`() = runTest {
        val viewModel = AppUpdateViewModel(appUpdater)

        viewModel.dismiss()

        assertTrue(viewModel.uiState.value.dismissed)
    }

    @Test
    fun `download failure clears progress and exposes the localized updater error`() = runTest {
        every { appUpdater.check() } returns update
        every { appUpdater.downloadAndInstall(update, any()) } answers {
            secondArg<(AppUpdater.DownloadState) -> Unit>()(
                AppUpdater.DownloadState.Failed("تعذر تثبيت التحديث"),
            )
        }
        val viewModel = AppUpdateViewModel(appUpdater)
        viewModel.checkForUpdate()
        advanceUntilIdle()

        viewModel.downloadAndInstallUpdate()
        advanceUntilIdle()

        assertEquals(false, viewModel.uiState.value.isDownloading)
        assertEquals("تعذر تثبيت التحديث", viewModel.uiState.value.downloadError)
    }
}
