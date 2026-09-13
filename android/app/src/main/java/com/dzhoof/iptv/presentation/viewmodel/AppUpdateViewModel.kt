package com.dzhoof.iptv.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dzhoof.iptv.presentation.model.UpdateInfo
import com.dzhoof.iptv.di.IoDispatcher
import com.dzhoof.iptv.update.AppUpdater
import com.dzhoof.iptv.update.UpdateManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * UI state for the app-root update overlay.
 *
 * [dismissed] is session-only (not persisted) — ignoring the update hides the
 * screen until the next app launch, when the check runs again.
 */
data class AppUpdateUiState(
    val updateInfo: UpdateInfo? = null,
    val isDownloading: Boolean = false,
    val downloadError: String? = null,
    val dismissed: Boolean = false
)

/**
 * Drives the full-screen "Update Available" overlay shown once at launch (after
 * the splash) when a newer app version is published. All version-check and
 * download/install logic lives in the shared [AppUpdater]; this VM only holds
 * the overlay's UI state.
 */
@HiltViewModel
class AppUpdateViewModel @Inject constructor(
    private val appUpdater: AppUpdater,
    private val updateManager: UpdateManager,
    @IoDispatcher private val ioDispatcher: CoroutineDispatcher,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AppUpdateUiState())
    val uiState: StateFlow<AppUpdateUiState> = _uiState.asStateFlow()

    private var checked = false

    /**
     * Checks once per process. Safe to call repeatedly.
     *
     * Routed through [UpdateManager] so the launch check honours the foreground cooldown
     * and records its result; a cooldown-skipped check simply shows no prompt.
     */
    fun checkForUpdate() {
        if (checked) return
        checked = true
        viewModelScope.launch {
            val outcome = withContext(ioDispatcher) {
                updateManager.check(UpdateManager.Trigger.APP_LAUNCH)
            }
            if (outcome is UpdateManager.Outcome.Available) {
                _uiState.update { it.copy(updateInfo = outcome.update) }
            }
        }
    }

    fun dismiss() {
        _uiState.update { it.copy(dismissed = true) }
    }

    fun downloadAndInstallUpdate() {
        val update = _uiState.value.updateInfo ?: return
        if (_uiState.value.isDownloading) return
        _uiState.update { it.copy(isDownloading = true, downloadError = null) }
        appUpdater.downloadAndInstall(update) { state ->
            _uiState.update {
                when (state) {
                    AppUpdater.DownloadState.Started -> it.copy(isDownloading = true)
                    AppUpdater.DownloadState.InstallLaunched -> it.copy(isDownloading = false)
                    is AppUpdater.DownloadState.Failed ->
                        it.copy(isDownloading = false, downloadError = state.message)
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        appUpdater.cleanup()
    }
}
