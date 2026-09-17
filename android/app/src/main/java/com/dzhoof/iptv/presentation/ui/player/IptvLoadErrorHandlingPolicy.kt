package com.dzhoof.iptv.presentation.ui.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.ParserException
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import java.io.IOException

/**
 * Fast-fail load error policy for live IPTV (defect D6).
 *
 * Media3's default policy retries network/IO errors with a backoff that grows
 * to several seconds, and [androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy]
 * configured with a retry count multiplies that. Because the relay can take
 * ~10s to allocate a cold session, the previous 4-retry policy added ~7.5s of
 * internal backoff *before* [ErrorRecoveryManager] ever saw the error — inflating
 * startup time and hiding the recovery ladder.
 *
 * Rules:
 *  - parsing/container errors are deterministic: the same bytes fail again, so
 *    never retry (0 retries) and surface the error to the app immediately;
 *  - transient network/IO errors get exactly one short internal retry, then
 *    surface so the app's own ladder (opposite container -> next slot -> dead)
 *    can run.
 */
@OptIn(UnstableApi::class)
class IptvLoadErrorHandlingPolicy(
    private val networkRetryDelayMs: Long = NETWORK_RETRY_DELAY_MS,
) : LoadErrorHandlingPolicy {

    override fun getFallbackSelectionFor(
        fallbackOptions: LoadErrorHandlingPolicy.FallbackOptions,
        loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo,
    ): LoadErrorHandlingPolicy.FallbackSelection? = null

    override fun getRetryDelayMsFor(
        loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo,
    ): Long = retryDelayMsFor(loadErrorInfo.exception, loadErrorInfo.errorCount)

    /**
     * Pure decision function, unit-testable without a [LoadErrorHandlingPolicy.LoadErrorInfo].
     *
     * @param exception the load failure.
     * @param errorCount number of errors this load task has seen, including this one.
     * @return delay in ms before retrying, or [C.TIME_UNSET] when the error is fatal.
     */
    internal fun retryDelayMsFor(exception: IOException, errorCount: Int): Long {
        // ParserException covers ERROR_CODE_PARSING_CONTAINER_* / MANIFEST_*
        // (UnrecognizedInputFormatException is a subclass).
        if (exception is ParserException) return C.TIME_UNSET
        // One retry only: errorCount is 1 on the first failure.
        if (errorCount <= 1) return networkRetryDelayMs
        return C.TIME_UNSET
    }

    override fun getMinimumLoadableRetryCount(dataType: Int): Int = 1

    companion object {
        const val NETWORK_RETRY_DELAY_MS = 500L
    }
}
