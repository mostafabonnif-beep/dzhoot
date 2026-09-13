package com.dzhoof.iptv.update

import android.app.DownloadManager
import android.app.UiModeManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.dzhoof.iptv.data.AppPreferences
import com.dzhoof.iptv.data.PinnedHttpClient
import com.dzhoof.iptv.presentation.model.UpdateInfo
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.ln
import kotlin.math.pow

/**
 * Single source of truth for the in-app update flow — version check (server API
 * first, GitHub releases fallback) and the APK download + signature-verified
 * install. Shared by the launch-time overlay ([AppUpdateViewModel]) and the
 * Settings "Check for updates" action so the logic exists in exactly one place.
 */
@Singleton
class AppUpdater @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apkFileInspector: ApkFileInspector,
) {
    /** Terminal outcomes of a download+install, delivered on the main thread. */
    sealed interface DownloadState {
        data object Started : DownloadState
        data object InstallLaunched : DownloadState
        data class Failed(
            val message: String,
            /** Non-sensitive taxonomy code for logs/telemetry; null for legacy paths. */
            val code: UpdateErrorCode? = null
        ) : DownloadState
    }

    private var downloadId: Long = -1
    private var downloadReceiver: BroadcastReceiver? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    private fun unregisterDownloadReceiver() {
        downloadReceiver?.let { runCatching { context.unregisterReceiver(it) } }
        downloadReceiver = null
    }

    /** Outcome of a single update check, including *why* nothing was offered. */
    sealed interface CheckResult {
        data class Found(val update: UpdateInfo) : CheckResult
        data object UpToDate : CheckResult
        data class Failed(val code: UpdateErrorCode) : CheckResult
    }

    /** Blocking network check — call from a background dispatcher. */
    fun check(): UpdateInfo? = (checkDetailed() as? CheckResult.Found)?.update

    /**
     * Same check as [check], but distinguishes "the provider could not be reached" from
     * "there is no update", so callers can record a real reason instead of guessing.
     * Server first (it already merges the GitHub release), GitHub only as a fallback.
     */
    fun checkDetailed(): CheckResult {
        val server = checkFromServer()
        if (server is CheckResult.Found) return server

        val github = checkFromGitHub()
        if (github is CheckResult.Found) return github

        if (server is CheckResult.UpToDate) return CheckResult.UpToDate
        if (github is CheckResult.UpToDate) return CheckResult.UpToDate
        return CheckResult.Failed(
            (server as? CheckResult.Failed)?.code ?: UpdateErrorCode.UPDATE_CHECK_NETWORK
        )
    }

    private fun checkFromServer(): CheckResult {
        return try {
            val baseUrl = AppPreferences.getServerUrl(context)
            val tvCode = AppPreferences.getTvCode(context)
            val response = PinnedHttpClient.get(
                "$baseUrl/api/v1/app/version?currentVersionCode=${getVersionCode()}" +
                    "&channel=stable&platform=${platformParam()}",
                mapOf("Accept" to "application/json", "X-Session-ID" to tvCode)
            )
            response.use { resp ->
                if (!resp.isSuccessful) {
                    return CheckResult.Failed(UpdateErrorCode.UPDATE_CHECK_NETWORK)
                }
                val json = org.json.JSONObject(resp.body?.string() ?: "{}")
                if (json.optBoolean("success", false) && json.optBoolean("updateAvailable", false)) {
                    val latest = json.optJSONObject("latestVersion")
                        ?: return CheckResult.Failed(UpdateErrorCode.UPDATE_METADATA_INVALID)
                    val update = UpdateInfo(
                        versionName = latest.optString("versionName", ""),
                        releaseNotes = latest.optString("releaseNotes", "").takeIf { it != "null" } ?: "",
                        fileSize = formatFileSize(latest.optLong("apkFileSize", 0)),
                        downloadUrl = latest.optString("downloadUrl", ""),
                        isMandatory = json.optBoolean("mandatory", json.optBoolean("isMandatory", false)),
                        versionCode = latest.optInt("versionCode", 0).takeIf { it > 0 },
                        sha256 = latest.optString("sha256", "").takeIf { isSha256(it) },
                        sizeBytes = latest.optLong("sizeBytes", 0).takeIf { it > 0 },
                        minimumSupportedVersionCode =
                            latest.optInt("minimumSupportedVersionCode", 0).takeIf { it > 0 }
                    )
                    CheckResult.Found(update)
                } else CheckResult.UpToDate
            }
        } catch (_: Exception) {
            CheckResult.Failed(UpdateErrorCode.UPDATE_CHECK_NETWORK)
        }
    }

    /** `platform` the update API expects: TV/leanback devices get TV-tuned releases. */
    private fun platformParam(): String {
        val uiMode = (context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager)?.currentModeType
        val isTv = context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
            uiMode == Configuration.UI_MODE_TYPE_TELEVISION
        return if (isTv) "android-tv" else "android"
    }

    private fun isSha256(value: String): Boolean =
        value.length == 64 && value.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }

    private fun checkFromGitHub(): CheckResult {

        return try {
            val response = PinnedHttpClient.get(
                GITHUB_RELEASES_API,
                mapOf("Accept" to "application/vnd.github+json")
            )
            response.use { resp ->
                if (!resp.isSuccessful) {
                    return CheckResult.Failed(UpdateErrorCode.UPDATE_CHECK_NETWORK)
                }
                val json = org.json.JSONObject(resp.body?.string() ?: "{}")
                val latestVersion = json.optString("tag_name", "").removePrefix("v")
                val currentVersionName = getAppVersionName()
                if (latestVersion.isNotEmpty() && latestVersion != currentVersionName &&
                    compareVersions(latestVersion, currentVersionName) > 0
                ) {
                    val assets = json.optJSONArray("assets")
                    var downloadUrl = ""
                    var fileSize = 0L
                    if (assets != null) {
                        for (i in 0 until assets.length()) {
                            val asset = assets.getJSONObject(i)
                            if (asset.optString("name", "").endsWith(".apk")) {
                                downloadUrl = asset.optString("browser_download_url", "")
                                fileSize = asset.optLong("size", 0)
                                break
                            }
                        }
                    }
                    val update = UpdateInfo(
                        versionName = latestVersion,
                        releaseNotes = json.optString("body", "").takeIf { it != "null" }?.take(500) ?: "",
                        fileSize = formatFileSize(fileSize),
                        downloadUrl = downloadUrl,
                        isMandatory = false
                    )
                    CheckResult.Found(update)
                } else CheckResult.UpToDate
            }
        } catch (_: Exception) {
            CheckResult.Failed(UpdateErrorCode.UPDATE_CHECK_NETWORK)
        }
    }

    /**
     * Downloads the APK and, once complete + signature-verified, launches the
     * system installer. [onState] is invoked on the main thread with the outcome.
     */
    fun downloadAndInstall(updateInfo: UpdateInfo, onState: (DownloadState) -> Unit) {
        val allowedHosts = ApkUrlPolicy.allowedHosts(AppPreferences.getServerUrl(context))
        if (!ApkUrlPolicy.isAllowed(updateInfo.downloadUrl, allowedHosts)) {
            // Fail closed before a single byte is requested: an off-allowlist or non-HTTPS
            // URL means the release metadata cannot be trusted.
            Log.e(TAG, "Refusing to download the update from a non-allowlisted URL")
            onState(DownloadState.Failed(
                UpdateErrorCode.UPDATE_METADATA_INVALID.userMessage,
                UpdateErrorCode.UPDATE_METADATA_INVALID
            ))
            return
        }
        try {
            unregisterDownloadReceiver()
            downloadId = -1

            val oldFile = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_FILENAME)
            if (oldFile.exists()) oldFile.delete()

            val request = DownloadManager.Request(Uri.parse(updateInfo.downloadUrl)).apply {
                setTitle("تحديث DZ HOOF")
                setDescription("جارٍ تنزيل تحديث DZ HOOF…")
                setMimeType("application/vnd.android.package-archive")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, APK_FILENAME)
                setAllowedOverMetered(true)
                setAllowedOverRoaming(true)
            }

            val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

            // Register before enqueue: a fast/local download can complete before a
            // receiver registered after enqueue is ready, leaving the UI stuck.
            downloadReceiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent) {
                    val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
                    if (id != downloadId) return
                    val cursor = downloadManager.query(DownloadManager.Query().apply { setFilterById(downloadId) })
                    try {
                        if (cursor.moveToFirst()) {
                            val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                                // Archive signature parsing can be slow for a large APK. Keep it
                                // off the broadcast receiver's main-thread path to avoid ANRs.
                                Thread {
                                    val state = installUpdate(updateInfo)
                                    mainHandler.post { onState(state) }
                                }.start()
                            } else {
                                val reason = cursor.getString(
                                    cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
                                )
                                Log.e(TAG, "Download failed, reason=$reason")
                                onState(DownloadState.Failed(
                                    UpdateErrorCode.UPDATE_DOWNLOAD_FAILED.userMessage,
                                    UpdateErrorCode.UPDATE_DOWNLOAD_FAILED
                                ))
                            }
                            // A singleton updater can be used by either the startup screen or
                            // Settings. Remove the receiver only after this matching download is
                            // terminal; an unrelated ViewModel being cleared must not interrupt it.
                            unregisterDownloadReceiver()
                            downloadId = -1
                        }
                    } finally {
                        cursor.close()
                    }
                }
            }

            // Must be exported: ACTION_DOWNLOAD_COMPLETE is sent by the Download
            // Provider app, not the system UID, so a NOT_EXPORTED receiver is never
            // delivered on Android 13+ and the UI hangs at "Downloading...". Safe:
            // the receiver checks the download id, queries DownloadManager for the
            // real status, and the APK signature is verified pre-install.
            ContextCompat.registerReceiver(
                context,
                downloadReceiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                ContextCompat.RECEIVER_EXPORTED
            )
            downloadId = downloadManager.enqueue(request)
            onState(DownloadState.Started)
        } catch (e: Exception) {
            Log.e(TAG, "Error downloading update", e)
            unregisterDownloadReceiver()
            downloadId = -1
            onState(DownloadState.Failed(
                UpdateErrorCode.UPDATE_DOWNLOAD_FAILED.userMessage,
                UpdateErrorCode.UPDATE_DOWNLOAD_FAILED
            ))
        }
    }

    private fun installUpdate(updateInfo: UpdateInfo): DownloadState {
        return try {
            val file = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_FILENAME)
            if (!file.exists()) {
                return DownloadState.Failed(
                    UpdateErrorCode.UPDATE_DOWNLOAD_FAILED.userMessage,
                    UpdateErrorCode.UPDATE_DOWNLOAD_FAILED
                )
            }

            // Everything the verifier needs, observed on the actual downloaded bytes.
            val verification = UpdateVerifier.verify(
                expected = ExpectedArtifact(
                    packageName = context.packageName,
                    versionCode = updateInfo.versionCode,
                    sha256 = updateInfo.sha256,
                    sizeBytes = updateInfo.sizeBytes
                ),
                observed = ObservedArtifact(
                    downloadUrl = updateInfo.downloadUrl,
                    sizeBytes = file.length(),
                    sha256 = apkFileInspector.sha256Of(file),
                    archivePackageName = apkFileInspector.archivePackageName(file),
                    archiveVersionCode = apkFileInspector.archiveVersionCode(file),
                    signatureMatches = apkFileInspector.signatureMatches(file)
                ),
                installedVersionCode = apkFileInspector.installedVersionCode(),
                allowedHosts = ApkUrlPolicy.allowedHosts(AppPreferences.getServerUrl(context))
            )

            if (verification is UpdateVerificationResult.Blocked) {
                // Fail closed and leave no trace of the rejected artifact. The detail is
                // for logs only; the user sees the code's Arabic message.
                Log.e(TAG, "Update blocked (${verification.code}): ${verification.detail}")
                file.delete()
                return DownloadState.Failed(verification.code.userMessage, verification.code)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !context.packageManager.canRequestPackageInstalls()
            ) {
                val settingsIntent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}")
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(settingsIntent)
                return DownloadState.Failed(
                    UpdateErrorCode.UPDATE_USER_ACTION_REQUIRED.userMessage,
                    UpdateErrorCode.UPDATE_USER_ACTION_REQUIRED
                )
            }

            val apkUri = FileProvider.getUriForFile(context, "${context.packageName}.provider", file)
            val installIntent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
                // Intent.setType() clears a previously set data URI. Use the atomic
                // variant so Android's package installer receives the APK FileProvider URI.
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(installIntent)
            DownloadState.InstallLaunched
        } catch (e: Exception) {
            Log.e(TAG, "Error installing update", e)
            DownloadState.Failed(
                UpdateErrorCode.UPDATE_INSTALL_FAILED.userMessage,
                UpdateErrorCode.UPDATE_INSTALL_FAILED
            )
        }
    }

    /**
     * Release an idle receiver. AppUpdater is a singleton shared by the launch overlay
     * and Settings, so a ViewModel being cleared must never cancel another owner's
     * in-flight DownloadManager operation.
     */
    fun cleanup() {
        if (downloadId == -1L) unregisterDownloadReceiver()
    }

    private fun getAppVersionName(): String = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""
    } catch (_: Exception) {
        ""
    }

    @Suppress("DEPRECATION")
    private fun getVersionCode(): Int = try {
        val pkg = context.packageManager.getPackageInfo(context.packageName, 0)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) pkg.longVersionCode.toInt() else pkg.versionCode
    } catch (_: Exception) {
        1
    }

    private fun compareVersions(v1: String, v2: String): Int {
        val parts1 = v1.split(".").map { it.toIntOrNull() ?: 0 }
        val parts2 = v2.split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(parts1.size, parts2.size)) {
            val p1 = parts1.getOrElse(i) { 0 }
            val p2 = parts2.getOrElse(i) { 0 }
            if (p1 != p2) return p1.compareTo(p2)
        }
        return 0
    }

    private fun formatFileSize(bytes: Long): String {
        if (bytes <= 0) return ""
        if (bytes < 1024) return "$bytes B"
        val exp = (ln(bytes.toDouble()) / ln(1024.0)).toInt().coerceIn(1, 6)
        val pre = "KMGTPE"[exp - 1]
        return "%.1f %sB".format(bytes / 1024.0.pow(exp.toDouble()), pre)
    }

    companion object {
        private const val TAG = "AppUpdater"
        private const val APK_FILENAME = "DZHOOF.apk"
        private const val GITHUB_RELEASES_API =
            "https://api.github.com/repos/mostafabonnif-beep/dzhoot/releases/latest"
    }
}
