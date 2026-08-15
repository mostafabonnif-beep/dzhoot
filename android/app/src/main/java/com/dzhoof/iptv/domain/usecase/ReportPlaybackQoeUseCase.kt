package com.dzhoof.iptv.domain.usecase

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.repository.StreamMetricsRepository
import javax.inject.Inject

class ReportPlaybackQoeUseCase @Inject constructor(
    private val repository: StreamMetricsRepository,
) : UseCase<ReportPlaybackQoeUseCase.Params, Result<Unit>>() {
    data class Params(
        val channelId: String,
        val eventType: String,
        val startupMs: Long?,
        val rebufferCount: Int,
        val fallbackUsed: Boolean,
        val fallbackSucceeded: Boolean?,
        val errorCode: String? = null,
    )

    override suspend fun execute(params: Params): Result<Unit> = repository.reportPlaybackQoe(
        channelId = params.channelId,
        eventType = params.eventType,
        startupMs = params.startupMs,
        rebufferCount = params.rebufferCount,
        fallbackUsed = params.fallbackUsed,
        fallbackSucceeded = params.fallbackSucceeded,
        errorCode = params.errorCode,
    )
}
