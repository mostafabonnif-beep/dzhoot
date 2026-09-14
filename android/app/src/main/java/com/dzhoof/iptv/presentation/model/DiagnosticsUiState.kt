package com.dzhoof.iptv.presentation.model

import com.dzhoof.iptv.update.diagnostics.DiagnosticsSection

/**
 * UI state for the in-app diagnostics screen.
 *
 * [sections] are pre-screened, non-sensitive rows (see `update/diagnostics/DiagnosticsReport`);
 * [reportText] is the same data as plain text, ready to copy for support.
 */
data class DiagnosticsUiState(
    val sections: List<DiagnosticsSection> = emptyList(),
    val reportText: String = "",
    val isLoading: Boolean = true,
    val error: String? = null,
)
