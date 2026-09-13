package com.dzhoof.iptv.presentation.model

import android.graphics.Bitmap
import com.dzhoof.iptv.domain.repository.PlayerKeyAction

/**
 * UI state for the settings screen.
 *
 * Represents the complete state of the settings screen including
 * all user preferences, server configuration, and pairing info.
 */
data class SettingsUiState(
    val theme: String = "system",
    val gridSize: Int = 3,
    val fontSize: Float = 1.0f,
    val animationSpeed: Float = 1.0f,
    val layoutDensity: String = "comfortable",
    val autoPlay: Boolean = true,
    // Player controls
    val backExitProtection: Boolean = true,
    val keyUpDownAction: String = PlayerKeyAction.ZAP,
    val keyLeftRightAction: String = PlayerKeyAction.ZAP,
    val longOkAction: String = PlayerKeyAction.FAVORITE,
    val sleepTimerDefaultMinutes: Int = 0,
    val alwaysShowProgramBar: Boolean = false,
    val infoBarTimeoutSeconds: Int = 4,
    val isLoading: Boolean = false,
    val error: String? = null,
    // Server configuration
    val serverUrl: String = "",
    val tvCode: String = "",
    val appVersion: String = "1.0.0",
    val qrCodeBitmap: Bitmap? = null,
    val isPaired: Boolean = false,
    val isDefaultMode: Boolean = false,
    // Channel source: "paired" (managed/default server), "m3u", or "xtream"
    val sourceType: String = "paired",
    val m3uUrl: String = "",
    val xtreamHost: String = "",
    val settingsSaved: Boolean = false,
    // App update
    val isCheckingForUpdate: Boolean = false,
    val updateInfo: UpdateInfo? = null,
    val updateChecked: Boolean = false,
    val isDownloadingUpdate: Boolean = false,
    val downloadError: String? = null,
    // Cache
    val isClearingCache: Boolean = false,
    val cacheCleared: Boolean = false,
    // Guide data reset
    val isResettingGuide: Boolean = false,
    val guideReset: Boolean = false,
    // Connection test
    val isTestingConnection: Boolean = false,
    val connectionTestResult: String? = null,
    // Bring-your-own playlist (M3U / Xtream)
    val isLoadingPlaylist: Boolean = false,
    val playlistResult: String? = null
)

data class UpdateInfo(
    val versionName: String,
    val releaseNotes: String,
    val fileSize: String,
    val downloadUrl: String,
    val isMandatory: Boolean,
    /** Published versionCode of the offered build, when the server provides it. */
    val versionCode: Int? = null,
    /** Published SHA-256 (64 hex chars) of the APK, when the server provides it. */
    val sha256: String? = null,
    /** Exact APK size in bytes when known — used to detect a truncated download. */
    val sizeBytes: Long? = null,
    /** Below this versionCode the update is mandatory; null when the server omits it. */
    val minimumSupportedVersionCode: Int? = null
)
