package com.dzhoof.iptv.update.diagnostics

import android.content.Context
import android.provider.Settings
import android.util.Log
import com.dzhoof.iptv.data.AppPreferences
import com.dzhoof.iptv.data.PinnedHttpClient
import com.dzhoof.iptv.di.IoDispatcher
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext

/**
 * Sends a customer problem report to `POST /api/v1/app/report-problem`.
 *
 * The payload is built by [ProblemReportPayload], which owns the allow-list, so this class
 * never assembles a field itself — the only way a new value can reach the network is by
 * being named there on purpose.
 *
 * Failures are reported honestly: the customer is told the report could not be sent (and can
 * retry, or copy the diagnostics manually), never shown a success id that does not exist.
 */
@Singleton
class ProblemReporter @Inject constructor(
    @ApplicationContext private val context: Context,
    private val diagnosticsProvider: AppDiagnosticsProvider,
    @IoDispatcher private val ioDispatcher: CoroutineDispatcher,
) {

    /** Outcome of one submission. */
    sealed interface Result {
        /** Accepted by the server; [reportId] is what the customer quotes to support. */
        data class Sent(val reportId: String, val correlationId: String?) : Result

        /** The payload was rejected — a bug in this client, not a network problem. */
        data object Rejected : Result

        /** Nothing was sent: the backend was unreachable or answered an error. */
        data object Failed : Result
    }

    suspend fun submit(
        message: String,
        category: ProblemReportPayload.Category,
        errorCode: String? = null,
    ): Result = withContext(ioDispatcher) {
        try {
            val facts = runCatching { diagnosticsProvider.collect() }.getOrNull()
            val body = ProblemReportPayload.build(
                message = message,
                category = category,
                facts = facts,
                deviceId = deviceId(),
                platform = ProblemReportPayload.platformOf(context),
                errorCode = errorCode,
            )

            val response = PinnedHttpClient.post(
                "${AppPreferences.getServerUrl(context)}/api/v1/app/report-problem",
                body.toString(),
                mapOf("Accept" to "application/json")
            )
            response.use { resp ->
                val text = resp.body?.string().orEmpty()
                when {
                    resp.code == 201 -> {
                        val json = runCatching { org.json.JSONObject(text) }.getOrNull()
                        val reportId = json?.optString("reportId")?.takeIf { it.isNotBlank() }
                        if (reportId == null) Result.Failed
                        else Result.Sent(reportId, json.optString("correlationId").takeIf { it.isNotBlank() })
                    }
                    resp.code in 400..499 -> {
                        Log.w(TAG, "report rejected with HTTP ${resp.code}")
                        Result.Rejected
                    }
                    else -> {
                        Log.w(TAG, "report failed with HTTP ${resp.code}")
                        Result.Failed
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "report could not be sent: ${e.javaClass.simpleName}")
            Result.Failed
        }
    }

    /**
     * Stable device handle, derived **exactly** as `CrashReporter.deviceId` derives it.
     *
     * The two must agree: a customer who reports "the app crashes when I open movies" and a
     * crash captured a minute earlier are only joinable if both carry the same handle. The
     * value is a truncated `ANDROID_ID` with a `dz-` prefix — no serial, no advertising id,
     * no account id (that is the derivation production already stores).
     */
    private fun deviceId(): String = runCatching {
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
    }.getOrNull().orEmpty().let { androidId ->
        if (androidId.isBlank()) "dzhoof-device" else "dz-${androidId.take(16)}"
    }

    private companion object {
        const val TAG = "ProblemReporter"
    }
}
