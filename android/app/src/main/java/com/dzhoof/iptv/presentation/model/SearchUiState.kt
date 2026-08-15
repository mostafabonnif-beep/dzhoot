package com.dzhoof.iptv.presentation.model

import com.dzhoof.iptv.domain.model.SearchFilter
import com.dzhoof.iptv.domain.model.UnifiedSearchResults

/**
 * UI state for the search screen.
 * 
 * Represents the complete state of the search screen including
 * search query, results, recent searches, and active filters.
 */
data class SearchUiState(
    val query: String = "",
    val results: List<ChannelUiModel> = emptyList(),
    val unifiedResults: UnifiedSearchResults = UnifiedSearchResults(),
    val recentSearches: List<String> = emptyList(),
    val activeFilters: List<SearchFilter> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)
