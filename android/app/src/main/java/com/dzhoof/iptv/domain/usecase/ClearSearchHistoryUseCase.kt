package com.dzhoof.iptv.domain.usecase

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.repository.SearchHistoryRepository
import javax.inject.Inject

/**
 * Use case for clearing search history.
 * 
 * Removes all saved search queries from history.
 * 
 * Requirements: US-003.6 (Clear search history option)
 */
class ClearSearchHistoryUseCase @Inject constructor(
    private val searchHistoryRepository: SearchHistoryRepository
) : UseCase<Unit, Result<Unit>>() {
    
    override suspend fun execute(params: Unit): Result<Unit> {
        return searchHistoryRepository.clearHistory()
    }
}
