package com.dzhoof.iptv.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.source.local.dao.ChannelHealthDao
import com.dzhoof.iptv.domain.model.SearchFilter
import com.dzhoof.iptv.domain.model.UnifiedSearchResults
import com.dzhoof.iptv.domain.repository.CatalogRepository
import com.dzhoof.iptv.domain.usecase.ClearSearchHistoryUseCase
import com.dzhoof.iptv.domain.usecase.GetRecentSearchesUseCase
import com.dzhoof.iptv.domain.usecase.SaveSearchQueryUseCase
import com.dzhoof.iptv.domain.usecase.SearchChannelsUseCase
import com.dzhoof.iptv.domain.usecase.ToggleFavoriteUseCase
import com.dzhoof.iptv.presentation.mapper.ChannelUiMapper
import com.dzhoof.iptv.presentation.model.SearchUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for the search screen.
 * 
 * Manages search query, results, filters, and recent searches with
 * debouncing to avoid excessive API calls.
 * 
 * Requirements: US-003 (Improved Search Experience)
 */
@OptIn(FlowPreview::class)
@HiltViewModel
class SearchViewModel @Inject constructor(
    private val searchChannelsUseCase: SearchChannelsUseCase,
    private val saveSearchQueryUseCase: SaveSearchQueryUseCase,
    private val getRecentSearchesUseCase: GetRecentSearchesUseCase,
    private val clearSearchHistoryUseCase: ClearSearchHistoryUseCase,
    private val toggleFavoriteUseCase: ToggleFavoriteUseCase,
    private val channelUiMapper: ChannelUiMapper,
    private val channelHealthDao: ChannelHealthDao,
    private val catalogRepository: CatalogRepository,
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(SearchUiState())
    val uiState: StateFlow<SearchUiState> = _uiState.asStateFlow()

    private val _searchQuery = MutableStateFlow("")
    private var searchJob: Job? = null
    
    init {
        loadRecentSearches()
        observeSearchQuery()
    }
    
    /**
     * Observe search query changes with debouncing.
     * 
     * Waits 300ms after the last input before executing the search.
     */
    private fun observeSearchQuery() {
        viewModelScope.launch {
            _searchQuery
                .debounce(300) // Wait 300ms after last input
                .distinctUntilChanged()
                .filter { it.isNotBlank() }
                .collect { query ->
                    performSearch(query)
                }
        }
    }
    
    /**
     * Update the search query.
     * 
     * The actual search will be triggered after debouncing.
     * 
     * @param query The new search query
     */
    fun onQueryChange(query: String) {
        _uiState.update { it.copy(query = query) }
        _searchQuery.value = query
        
        // Clear results and error if query is empty
        if (query.isBlank()) {
            searchJob?.cancel()
            _uiState.update {
                it.copy(
                    results = emptyList(),
                    unifiedResults = UnifiedSearchResults(),
                    isLoading = false,
                    error = null,
                )
            }
        }
    }
    
    /**
     * Perform the actual search operation.
     */
    private fun performSearch(query: String) {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            
            // Save search query to history
            saveSearchQueryUseCase(query)
            
            // Search the server catalog in addition to the local channel index.
            // A catalog failure must not hide locally cached channels.
            when (val unifiedResult = catalogRepository.searchCatalog(query)) {
                is Result.Success -> _uiState.update { it.copy(unifiedResults = unifiedResult.data) }
                is Result.Error -> Unit
            }

            // Perform search with active filters
            val params = SearchChannelsUseCase.Params(
                query = query,
                filters = _uiState.value.activeFilters
            )
            
            searchChannelsUseCase(params)
                .combine(channelHealthDao.getAllHealth()) { result, healthList ->
                    result to healthList
                }
                .collect { (result, healthList) ->
                    when (result) {
                        is Result.Success -> {
                            _uiState.update {
                                it.copy(
                                    results = channelUiMapper.toUiModelsWithHealth(result.data, healthList),
                                    isLoading = false
                                )
                            }
                        }
                        is Result.Error -> {
                            _uiState.update { state ->
                                if (state.unifiedResults.totalCount > 0) {
                                    state.copy(isLoading = false)
                                } else {
                                    state.copy(
                                        isLoading = false,
                                        error = result.exception.message ?: "تعذر تنفيذ البحث",
                                    )
                                }
                            }
                        }
                    }
                }
        }
    }
    
    /**
     * Load recent search queries.
     */
    private fun loadRecentSearches() {
        viewModelScope.launch {
            getRecentSearchesUseCase(10).collect { result ->
                when (result) {
                    is Result.Success -> {
                        _uiState.update { it.copy(recentSearches = result.data) }
                    }
                    is Result.Error -> {
                        // Silently fail for recent searches
                    }
                }
            }
        }
    }
    
    /**
     * Execute a search from recent searches.
     * 
     * @param query The query to search for
     */
    fun searchFromHistory(query: String) {
        _uiState.update { it.copy(query = query) }
        _searchQuery.value = query
        // Bypass debounce — execute search immediately for history clicks
        performSearch(query)
    }
    
    /**
     * Add a filter to the active filters.
     * 
     * @param filter The filter to add
     */
    fun addFilter(filter: SearchFilter) {
        _uiState.update {
            it.copy(activeFilters = it.activeFilters + filter)
        }
        
        // Re-run search with new filter if query exists
        if (_uiState.value.query.isNotBlank()) {
            performSearch(_uiState.value.query)
        }
    }
    
    /**
     * Remove a filter from the active filters.
     * 
     * @param filter The filter to remove
     */
    fun removeFilter(filter: SearchFilter) {
        _uiState.update {
            it.copy(activeFilters = it.activeFilters - filter)
        }
        
        // Re-run search without filter if query exists
        if (_uiState.value.query.isNotBlank()) {
            performSearch(_uiState.value.query)
        }
    }
    
    /**
     * Clear all active filters.
     */
    fun clearFilters() {
        _uiState.update { it.copy(activeFilters = emptyList()) }
        
        // Re-run search without filters if query exists
        if (_uiState.value.query.isNotBlank()) {
            performSearch(_uiState.value.query)
        }
    }
    
    /**
     * Clear search history.
     */
    fun clearHistory() {
        viewModelScope.launch {
            clearSearchHistoryUseCase(Unit)
            _uiState.update { it.copy(recentSearches = emptyList()) }
        }
    }
    
    /**
     * Clear any error message.
     */
    fun toggleFavorite(channelId: String) {
        viewModelScope.launch {
            _uiState.update { state ->
                state.copy(
                    results = state.results.map { channel ->
                        if (channel.id == channelId) channel.copy(isFavorite = !channel.isFavorite)
                        else channel
                    }
                )
            }
            val result = toggleFavoriteUseCase(channelId)
            if (result is Result.Error) {
                _uiState.update { state ->
                    state.copy(
                        results = state.results.map { channel ->
                            if (channel.id == channelId) channel.copy(isFavorite = !channel.isFavorite)
                            else channel
                        }
                    )
                }
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
