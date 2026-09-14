package com.dzhoof.iptv.update.diagnostics

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import com.dzhoof.iptv.BuildConfig
import com.dzhoof.iptv.data.AppPreferences
import com.dzhoof.iptv.data.source.remote.DzhoofApiService
import com.dzhoof.iptv.di.IoDispatcher
import com.dzhoof.iptv.update.UpdateCheckStore
import com.dzhoof.iptv.update.UpdateManager
import dagger.hilt.android.qualifiers.ApplicationContext
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext

/**
 * Collects the non-sensitive device/app/server facts behind the diagnostics screen.
 *
 * Every read is defensive: an unreadable package, signing info or backend response
 * degrades to null / "غير متاح" and never throws into the ViewModel — this screen must
 * always render, even when everything else is broken.
 *
 * SECURITY: this class deliberately reads *only* non-sensitive values. It never touches
 * tokens, JWTs, passwords, playlist/Xtream/EPG URLs, usernames, device serials or account
 * codes. The raw base URL is not surfaced either — the backend is identified by its
 * `/health/version` build identity instead.
 */
@Singleton
class AppDiagnosticsProvider @Inject constructor(
    @ApplicationContext private val context: Context,
    private val updateManager: UpdateManager,
    private val checkStore: UpdateCheckStore,
    private val apiService: DzhoofApiService,
    @IoDispatcher private val ioDispatcher: CoroutineDispatcher,
) {

    /** Never throws; missing facts come back as null. */
    suspend fun collect(): DiagnosticsFacts = withContext(ioDispatcher) {
        val packageInfo = packageInfo()
        val server = fetchServerIdentity()
        DiagnosticsFacts(
            appVersionName = packageInfo?.versionName,
            appVersionCode = packageInfo?.longVersionCode,
            releaseChannel = BuildConfig.RELEASE_CHANNEL,
            distributionWireName = runCatching {
                updateManager.distribution.wireName
            }.getOrNull(),
            lastCheckAtMillis = runCatching {
                checkStore.lastCheckAtMillis()
            }.getOrDefault(0L),
            lastCheckResultCode = runCatching {
                AppPreferences.getUpdateLastResult(context)
            }.getOrNull(),
            androidRelease = runCatching { Build.VERSION.RELEASE }.getOrNull(),
            sdkInt = runCatching { Build.VERSION.SDK_INT }.getOrNull(),
            signingCertSha256 = signingCertSha256(),
            serverVersion = server?.version,
            serverCommit = server?.commit,
            serverBuiltAt = server?.builtAt,
            serverEnvironment = server?.environment,
            serverAvailable = server != null,
        )
    }

    @Suppress("DEPRECATION")
    private fun packageInfo(): android.content.pm.PackageInfo? = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0)
    }.getOrNull()

    /**
     * SHA-256 of the app's signing certificate, lowercase hex, or null on any failure.
     * minSdk is 28, so `GET_SIGNING_CERTIFICATES` / `signingInfo` are always available.
     */
    @Suppress("DEPRECATION")
    private fun signingCertSha256(): String? = runCatching {
        val info = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_SIGNING_CERTIFICATES,
        )
        val signingInfo = info.signingInfo ?: return null
        // apkContentsSigners is populated for single- and multi-signer APKs; fall back to
        // the single-signer history only when it is empty.
        val signer = signingInfo.apkContentsSigners?.firstOrNull()
            ?: signingInfo.signingCertificateHistory?.lastOrNull()
            ?: return null
        val digest = MessageDigest.getInstance("SHA-256").digest(signer.toByteArray())
        digest.joinToString(separator = "") { byte -> "%02x".format(byte) }
    }.getOrNull()

    /**
     * Backend build identity. A non-2xx response, an unusable body or any network error all
     * yield null → the screen shows "غير متاح" without blocking anything else.
     */
    private suspend fun fetchServerIdentity(): com.dzhoof.iptv.data.model.dto.HealthVersionDto? =
        try {
            val response = apiService.getHealthVersion()
            if (response.isSuccessful) response.body() else null
        } catch (error: Exception) {
            Log.w(TAG, "Backend version probe failed: ${error.javaClass.simpleName}")
            null
        }

    private companion object {
        const val TAG = "AppDiagnostics"
    }
}
