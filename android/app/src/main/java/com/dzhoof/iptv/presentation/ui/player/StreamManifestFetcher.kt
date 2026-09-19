package com.dzhoof.iptv.presentation.ui.player

import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Fetches the first bytes of a stream manifest so [EmptyPlaylistProbe] can tell
 * an empty event playlist apart from a broken stream.
 *
 * Deliberately short-timeout and bounded: it runs only on the terminal failure
 * path, and a slow probe must never delay the error UI.
 */
class StreamManifestFetcher(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(4, TimeUnit.SECONDS)
        .build(),
) {
    /** @return the body, or null when it could not be read (treated as unknown). */
    fun fetch(url: String): String? = try {
        val request = Request.Builder().url(url).get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                null
            } else {
                response.body?.source()?.let { source ->
                    source.request(MAX_BYTES)
                    source.buffer.snapshot().utf8()
                }
            }
        }
    } catch (e: Exception) {
        null
    }

    private companion object {
        const val MAX_BYTES = 64 * 1024L
    }
}
