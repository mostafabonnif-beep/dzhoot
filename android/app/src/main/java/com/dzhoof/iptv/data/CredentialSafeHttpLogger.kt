package com.dzhoof.iptv.data

import android.util.Log
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

/**
 * Debug-only request logger that cannot leak a credential.
 *
 * It replaces `HttpLoggingInterceptor` on the shared client, which was running at
 * [okhttp3.logging.HttpLoggingInterceptor.Level.HEADERS] in debug builds: that
 * prints the request line (the whole URL) and every header. It redacted only
 * `X-TV-Code`, so `X-Session-Id` was logged verbatim, and so was the URL —
 * which is where an Xtream account lives
 * (`/live/<user>/<pass>/123.ts`, `player_api.php?username=…&password=…`) and
 * where a managed playback token lives (`/api/v1/tv/playback/<token>`).
 * `AGENTS.md` forbids exactly that.
 *
 * What it logs instead: method, redacted URL (host + path with token-shaped
 * segments masked, query omitted), response code and duration — enough to find a
 * failing endpoint, nothing that authenticates.
 *
 * Headers, bodies and cookies are never logged, at any level.
 */
class CredentialSafeHttpLogger(private val enabled: Boolean) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        if (!enabled) return chain.proceed(chain.request())

        val request = chain.request()
        val label = "${request.method} ${RequestLogRedactor.summarize(request.url)}"
        val startedAt = System.nanoTime()
        return try {
            val response = chain.proceed(request)
            Log.d(TAG, "$label -> ${response.code} (${elapsedMs(startedAt)}ms)")
            response
        } catch (e: IOException) {
            // The failure type is useful; the URL is already redacted.
            Log.d(TAG, "$label -> failed: ${e.javaClass.simpleName} (${elapsedMs(startedAt)}ms)")
            throw e
        }
    }

    private fun elapsedMs(startedAt: Long): Long = (System.nanoTime() - startedAt) / 1_000_000

    private companion object {
        const val TAG = "DzhoofHttp"
    }
}
