package com.dzhoof.iptv.domain.usecase

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.repository.SearchHistoryRepository
import javax.inject.Inject

/**
 * Use case for saving a search query to history.
 * 
 * Saves the search query so it can be displayed in recent searches.
 * 
 * Requirements: US-003.3 (Recent searches saved locally)
 */
class SaveSearchQueryUseCase @Inject constructor(
    private val searchHistoryRepository: SearchHistoryRepository
) : UseCase<String, Result<Unit>>() {
    
    override suspend fun execute(params: String): Result<Unit> {
        return searchHistoryRepository.saveSearch(params)
    }
}
