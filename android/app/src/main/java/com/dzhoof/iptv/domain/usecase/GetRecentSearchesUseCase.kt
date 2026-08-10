package com.dzhoof.iptv.domain.usecase

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.repository.SearchHistoryRepository
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

/**
 * Use case for retrieving recent search queries.
 * 
 * Returns the most recent search queries ordered by timestamp.
 * 
 * Requirements: US-003.3 (Recent searches saved locally)
 */
class GetRecentSearchesUseCase @Inject constructor(
    private val searchHistoryRepository: SearchHistoryRepository
) : FlowUseCase<Int, Result<List<String>>>() {
    
    override fun execute(params: Int): Flow<Result<List<String>>> {
        return searchHistoryRepository.getRecentSearches(params)
    }
}
