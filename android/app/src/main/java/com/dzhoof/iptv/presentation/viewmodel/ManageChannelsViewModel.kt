package com.dzhoof.iptv.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dzhoof.iptv.data.source.local.dao.ChannelDao
import com.dzhoof.iptv.domain.repository.ChannelPrefsRepository
import com.dzhoof.iptv.presentation.model.ManageChannelRow
import com.dzhoof.iptv.presentation.model.ManageChannelsUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Backs the channel management screen ("إدارة القنوات"): browse the full
 * channel list (active channels, supplier ordering) with per-row hidden/locked
 * flags, and toggle either flag locally. The PIN gate for [setLocked] lives in
 * the UI layer (ParentalPinDialog + AppPreferences), mirroring ParentalSection.
 */
@HiltViewModel
class ManageChannelsViewModel @Inject constructor(
    private val channelDao: ChannelDao,
    private val channelPrefsRepository: ChannelPrefsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ManageChannelsUiState())
    val uiState: StateFlow<ManageChannelsUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            combine(
                channelDao.getAllChannels(),
                channelPrefsRepository.observePrefs()
            ) { channels, prefs ->
                channels.map { entity ->
                    val pref = prefs[entity.id]
                    ManageChannelRow(
                        channelId = entity.id,
                        name = entity.name,
                        logoUrl = entity.logoUrl,
                        category = entity.categoryId,
                        hidden = pref?.hidden ?: false,
                        locked = pref?.locked ?: false
                    )
                }
            }.collect { rows ->
                _uiState.update { it.copy(rows = rows, isLoading = false) }
            }
        }
    }

    /** Toggle the hidden flag (no PIN gate — hiding is not a protected action). */
    fun setHidden(channelId: String, hidden: Boolean) {
        viewModelScope.launch {
            runCatching { channelPrefsRepository.setHidden(channelId, hidden) }
        }
    }

    /** Toggle the locked flag (UI verifies the parental PIN before calling). */
    fun setLocked(channelId: String, locked: Boolean) {
        viewModelScope.launch {
            runCatching { channelPrefsRepository.setLocked(channelId, locked) }
        }
    }
}
