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

    /**
     * URL of the request currently being enqueued, or null.
     *
     * `enqueue()` returns the id only after the DownloadManager has accepted the request, so
     * during that window the broadcast handler cannot identify its own download by id. It
     * confirms ownership from the DownloadManager row instead (see [onDownloadComplete]):
     * the previous code compared against `downloadId == -1` and dropped the broadcast, which
     * left the UI on "Downloading…" forever whenever the download finished quickly.
     */
    private var pendingDownloadUrl: String? = null
    private var downloadReceiver: BroadcastReceiver? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * Whether a completed download belongs to the request this updater just started.
     *
     * Two independent signals, because the enqueue window makes the id temporarily unusable:
     * once `enqueue()` has returned, the id must match exactly; before that, the row's
     * request URI must be the URL we asked for. A completion for an unrelated download is
     * ignored either way.
     */
    private fun isRequestedDownload(id: Long, cursor: android.database.Cursor): Boolean {
        if (downloadId != -1L) return id == downloadId
        val uri = runCatching {
            cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_URI))
        }.getOrNull()
        return uri != null && uri == pendingDownloadUrl
    }

    private fun unregisterDownloadReceiver() {
        downloadReceiver?.let { runCatching { context.unregisterReceiver(it) } }
        downloadReceiver = null
    }

    /** Outcome of a single update check, including *why* nothing was offered. */
    sealed interface CheckResult {
        data class Found(val update: UpdateInfo) : CheckResult
        data object UpToDate : CheckResult

        /**
         * A newer release exists, but its checksum could not be verified so it was not
         * offered (`updateBlockedReason: CHECKSUM_UNAVAILABLE`).
         *
         * Distinct from [UpToDate] on purpose: reporting "up to date" while a newer build
         * is published but withheld tells the user something false, and hides a release
         * problem the operator needs to see.
         */
        data class HeldForVerification(val versionName: String?) : CheckResult

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

        // The server is authoritative about what is published. If it says a release exists
        // but is withheld, do not ask GitHub for a second opinion: GitHub would happily
        // describe the same release without a verified checksum, which is exactly the
        // download the gate exists to prevent.
        if (server is CheckResult.HeldForVerification) return server

        val github = checkFromGitHub()
        if (github is CheckResult.Found) return github

        if (server is CheckResult.UpToDate) return CheckResult.UpToDate
        if (github is CheckResult.UpToDate) return CheckResult.UpToDate
        if (github is CheckResult.HeldForVerification) return github
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
                // The response contract (including `checksumSource` and
                // `updateBlockedReason`) is parsed in UpdateResponseParser, where it is
                // unit-tested; this method only maps the outcome onto the check result.
                when (val outcome = UpdateResponseParser.parse(resp.body?.string())) {
                    is UpdateResponseParser.Outcome.Offered -> CheckResult.Found(outcome.update)
                    UpdateResponseParser.Outcome.Current -> CheckResult.UpToDate
                    is UpdateResponseParser.Outcome.HeldForVerification ->
                        CheckResult.HeldForVerification(outcome.versionName)
                    is UpdateResponseParser.Outcome.Invalid -> CheckResult.Failed(outcome.code)
                }
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
                    var apkName = ""
                    if (assets != null) {
                        for (i in 0 until assets.length()) {
                            val asset = assets.getJSONObject(i)
                            if (asset.optString("name", "").endsWith(".apk")) {
                                apkName = asset.optString("name", "")
                                downloadUrl = asset.optString("browser_download_url", "")
                                fileSize = asset.optLong("size", 0)
                                break
                            }
                        }
                    }

                    // The release publishes `<apk>.sha256` next to the APK (see
                    // android-release.yml). This fallback used to build an UpdateInfo with
                    // no checksum at all, so a server outage silently downgraded the device
                    // to an unverifiable download. Resolve the published digest here, and
                    // hold the release when there is none — the verifier now fails closed.
                    val sha256AssetUrl = if (assets != null && apkName.isNotEmpty()) {
                        (0 until assets.length())
                            .map { assets.getJSONObject(it) }
                            .firstOrNull { it.optString("name", "") == "$apkName.sha256" }
                            ?.optString("browser_download_url", "")
                            ?.takeIf { it.isNotBlank() }
                    } else {
                        null
                    }
                    val sha256 = sha256AssetUrl?.let { fetchPublishedSha256(it) }
                    if (sha256 == null) {
                        Log.w(TAG, "GitHub fallback found no usable checksum for $latestVersion")
                        return CheckResult.HeldForVerification(latestVersion)
                    }

                    val update = UpdateInfo(
                        versionName = latestVersion,
                        releaseNotes = json.optString("body", "").takeIf { it != "null" }?.take(500) ?: "",
                        fileSize = UpdateResponseParser.formatFileSize(fileSize),
                        downloadUrl = downloadUrl,
                        isMandatory = false,
                        sha256 = sha256,
                        sizeBytes = fileSize.takeIf { it > 0 },
                        checksumSource = "sha256-asset"
                    )
                    CheckResult.Found(update)
                } else CheckResult.UpToDate
            }
        } catch (_: Exception) {
            CheckResult.Failed(UpdateErrorCode.UPDATE_CHECK_NETWORK)
        }
    }

    /**
     * Reads the digest from a release's published `<apk>.sha256` asset.
     *
     * The asset holds `<digest>  <filename>`, so the first 64-hex token is taken. Returns
     * null when the asset is unreadable or carries no usable digest, and the caller then
     * withholds the release rather than offering an unverifiable download.
     */
    private fun fetchPublishedSha256(assetUrl: String): String? = try {
        PinnedHttpClient.get(assetUrl, mapOf("Accept" to "text/plain")).use { resp ->
            if (!resp.isSuccessful) {
                null
            } else {
                val token = Regex("[A-Fa-f0-9]{64}").find(resp.body?.string() ?: "")?.value
                token?.lowercase()
            }
        }
    } catch (_: Exception) {
        null
    }

    /**
     * Downloads the APK and, once complete + signature-verified, launches the
     * system installer. [onState] is invoked on the main thread with the outcome.
     */
    fun downloadAndInstall(updateInfo: UpdateInfo, onState: (DownloadState) -> Unit) {
        // Refuse before a single byte is requested: without a published checksum there is
        // nothing to tie the downloaded APK to, and UpdateVerifier would reject it anyway
        // once the download had already been paid for.
        if (!UpdateResponseParser.isSha256(updateInfo.sha256)) {
            Log.e(TAG, "Refusing to download an update that carries no verifiable checksum")
            onState(DownloadState.Failed(
                UpdateErrorCode.UPDATE_CHECKSUM_REQUIRED.userMessage,
                UpdateErrorCode.UPDATE_CHECKSUM_REQUIRED
            ))
            return
        }

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
            pendingDownloadUrl = null

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
                    if (id < 0) return
                    // Query by the id the broadcast carries, not by `downloadId`: while the
                    // request is still being enqueued `downloadId` is -1, and filtering by
                    // -1 matches nothing.
                    val cursor = downloadManager.query(DownloadManager.Query().apply { setFilterById(id) })
                    try {
                        if (cursor.moveToFirst() && isRequestedDownload(id, cursor)) {
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
                            pendingDownloadUrl = null
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
            pendingDownloadUrl = updateInfo.downloadUrl
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
            pendingDownloadUrl = null
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

    companion object {
        private const val TAG = "AppUpdater"
        private const val APK_FILENAME = "DZHOOF.apk"
        private const val GITHUB_RELEASES_API =
            "https://api.github.com/repos/mostafabonnif-beep/dzhoot/releases/latest"
    }
}
