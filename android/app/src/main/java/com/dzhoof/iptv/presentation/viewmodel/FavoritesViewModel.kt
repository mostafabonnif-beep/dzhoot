package com.dzhoof.iptv.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.source.local.dao.ChannelDao
import com.dzhoof.iptv.data.source.local.dao.ChannelHealthDao
import com.dzhoof.iptv.data.source.local.dao.FavoriteCategoryDao
import com.dzhoof.iptv.domain.usecase.GetFavoriteChannelsUseCase
import com.dzhoof.iptv.domain.usecase.ReorderFavoritesUseCase
import com.dzhoof.iptv.domain.usecase.ToggleFavoriteUseCase
import com.dzhoof.iptv.presentation.mapper.ChannelUiMapper
import com.dzhoof.iptv.presentation.model.FavoritesUiState
import com.dzhoof.iptv.presentation.model.PopularCategoryUiModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject

@HiltViewModel
class FavoritesViewModel @Inject constructor(
    private val getFavoriteChannelsUseCase: GetFavoriteChannelsUseCase,
    private val toggleFavoriteUseCase: ToggleFavoriteUseCase,
    private val reorderFavoritesUseCase: ReorderFavoritesUseCase,
    private val channelUiMapper: ChannelUiMapper,
    private val channelHealthDao: ChannelHealthDao,
    private val channelDao: ChannelDao,
    private val favoriteCategoryDao: FavoriteCategoryDao
) : ViewModel() {

    private val _uiState = MutableStateFlow(FavoritesUiState())
    val uiState: StateFlow<FavoritesUiState> = _uiState.asStateFlow()

    private val reorderMutex = Mutex()
    private var loadJob: Job? = null
    private var categoriesJob: Job? = null

    init {
        loadFavorites()
        loadFavoriteCategories()
    }

    fun retryLoadFavorites() {
        loadFavorites()
        loadFavoriteCategories()
    }

    private fun loadFavoriteCategories() {
        categoriesJob?.cancel()
        categoriesJob = viewModelScope.launch {
            combine(
                favoriteCategoryDao.getAllFavoriteCategories(),
                channelDao.getAllChannels(),
                channelHealthDao.getAllHealth()
            ) { favCategories, allChannels, healthList ->
                val channelsByCategory = allChannels.groupBy { it.categoryId }
                val healthMap = healthList.associateBy { it.channelId }
                favCategories.mapNotNull { favCat ->
                    val catChannels = channelsByCategory[favCat.categoryName] ?: return@mapNotNull null
                    PopularCategoryUiModel(
                        name = favCat.categoryName,
                        channelCount = catChannels.size,
                        imageUrl = catChannels.firstNotNullOfOrNull { ch ->
                            healthMap[ch.id]?.thumbnailPath
                        } ?: catChannels.firstNotNullOfOrNull { it.logoUrl },
                        isFavorite = true
                    )
                }
            }.collect { categories ->
                _uiState.update { it.copy(favoriteCategories = categories) }
            }
        }
    }

    fun removeFavoriteCategory(categoryName: String) {
        viewModelScope.launch {
            _uiState.update { state ->
                state.copy(
                    favoriteCategories = state.favoriteCategories.filter { it.name != categoryName }
                )
            }
            favoriteCategoryDao.removeFavorite(categoryName)
        }
    }

    private fun loadFavorites() {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            getFavoriteChannelsUseCase(Unit)
                .combine(channelHealthDao.getAllHealth()) { result, healthList ->
                    result to healthList
                }
                .collect { (result, healthList) ->
                    when (result) {
                        is Result.Success -> {
                            _uiState.update {
                                it.copy(
                                    favorites = channelUiMapper.toUiModelsWithHealth(result.data, healthList),
                                    isLoading = false
                                )
                            }
                        }
                        is Result.Error -> {
                            _uiState.update {
                                it.copy(
                                    isLoading = false,
                                    error = result.exception.message ?: "تعذر تحميل المفضلة"
                                )
                            }
                        }
                    }
                }
        }
    }

    fun removeFavorite(channelId: String) {
        viewModelScope.launch {
            _uiState.update { state ->
                state.copy(
                    favorites = state.favorites.filter { it.id != channelId }
                )
            }

            val result = toggleFavoriteUseCase(channelId)

            if (result is Result.Error) {
                _uiState.update {
                    it.copy(
                        error = result.exception.message ?: "تعذر حذف القناة من المفضلة"
                    )
                }
                loadFavorites()
            }
        }
    }

    fun reorderFavorite(channelId: String, newPosition: Int) {
        viewModelScope.launch {
            reorderMutex.withLock {
                performReorder(channelId, newPosition)
            }
        }
    }

    private suspend fun performReorder(channelId: String, newPosition: Int) {
        val currentFavorites = _uiState.value.favorites
        val currentIndex = currentFavorites.indexOfFirst { it.id == channelId }

        if (currentIndex != -1 && newPosition in currentFavorites.indices) {
            val mutableList = currentFavorites.toMutableList()
            val item = mutableList.removeAt(currentIndex)
            mutableList.add(newPosition, item)

            _uiState.update { it.copy(favorites = mutableList) }

            val params = ReorderFavoritesUseCase.Params(
                channelId = channelId,
                newOrder = newPosition
            )

            val result = reorderFavoritesUseCase(params)

            if (result is Result.Error) {
                _uiState.update {
                    it.copy(
                        error = result.exception.message ?: "تعذر إعادة ترتيب المفضلة"
                    )
                }
                loadFavorites()
            }
        }
    }

    fun moveFavoriteUp(channelId: String) {
        viewModelScope.launch {
            reorderMutex.withLock {
                val currentIndex = _uiState.value.favorites.indexOfFirst { it.id == channelId }
                if (currentIndex > 0) {
                    performReorder(channelId, currentIndex - 1)
                }
            }
        }
    }

    fun moveFavoriteDown(channelId: String) {
        viewModelScope.launch {
            reorderMutex.withLock {
                val favorites = _uiState.value.favorites
                val currentIndex = favorites.indexOfFirst { it.id == channelId }
                if (currentIndex != -1 && currentIndex < favorites.size - 1) {
                    performReorder(channelId, currentIndex + 1)
                }
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
