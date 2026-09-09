package com.dzhoof.iptv.presentation.model

/**
 * Row for the channel management screen ("إدارة القنوات"): one channel with its
 * current local-only flags. [hidden] removes it from browse lists; [locked]
 * gates playback behind the parental PIN. Both flags are independent.
 */
data class ManageChannelRow(
    val channelId: String,
    val name: String,
    val logoUrl: String? = null,
    val category: String = "",
    val hidden: Boolean = false,
    val locked: Boolean = false
)

data class ManageChannelsUiState(
    val rows: List<ManageChannelRow> = emptyList(),
    /** True until the first Room emission, so an empty DB isn't flashed as "no channels". */
    val isLoading: Boolean = true
)
