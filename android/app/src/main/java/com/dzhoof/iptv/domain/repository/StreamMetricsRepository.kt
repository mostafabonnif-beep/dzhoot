package com.dzhoof.iptv.domain.repository

import com.dzhoof.iptv.data.model.Result

interface StreamMetricsRepository {

    suspend fun reportStreamDead(channelId: String, errorMessage: String?): Result<Unit>

    suspend fun reportStreamAlive(channelId: String): Result<Unit>

    suspend fun reportStreamUnresponsive(channelId: String): Result<Unit>

    suspend fun reportStreamPlay(channelId: String, proxyPlay: Boolean = false, streamUrl: String? = null): Result<Unit>

    suspend fun reportPlaybackQoe(
        channelId: String,
        eventType: String,
        startupMs: Long?,
        rebufferCount: Int,
        fallbackUsed: Boolean,
        fallbackSucceeded: Boolean?,
        errorCode: String?
    ): Result<Unit>

    suspend fun syncHealthResults(results: List<HealthSyncEntry>): Result<Unit>
}

data class HealthSyncEntry(
    val channelId: String,
    val status: String,
    val responseTimeMs: Long?,
    val timestamp: Long
)
