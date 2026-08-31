package com.dzhoof.iptv.domain.usecase

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.repository.HealthSyncEntry
import com.dzhoof.iptv.domain.repository.StreamMetricsRepository
import javax.inject.Inject

class SyncHealthResultsUseCase @Inject constructor(
    private val repository: StreamMetricsRepository
) : UseCase<List<HealthSyncEntry>, Result<Unit>>() {

    override suspend fun execute(params: List<HealthSyncEntry>): Result<Unit> {
        return repository.syncHealthResults(params)
    }
}
