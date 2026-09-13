package com.dzhoof.iptv.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dzhoof.iptv.di.IoDispatcher
import com.dzhoof.iptv.presentation.model.DiagnosticsUiState
import com.dzhoof.iptv.update.diagnostics.AppDiagnosticsProvider
import com.dzhoof.iptv.update.diagnostics.DiagnosticsReport
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Drives the diagnostics screen: collects the facts through [AppDiagnosticsProvider],
 * renders them through the pure [DiagnosticsReport] and exposes loading/error state.
 *
 * Collection is read-only — it never changes update behaviour or writes anything.
 */
@HiltViewModel
class DiagnosticsViewModel @Inject constructor(
    private val provider: AppDiagnosticsProvider,
    @IoDispatcher private val ioDispatcher: CoroutineDispatcher,
) : ViewModel() {

    private val _uiState = MutableStateFlow(DiagnosticsUiState())
    val uiState: StateFlow<DiagnosticsUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    /** Re-collects every fact. Safe to call repeatedly (the screen's refresh action). */
    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            try {
                val facts = withContext(ioDispatcher) { provider.collect() }
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        sections = DiagnosticsReport.sections(facts),
                        reportText = DiagnosticsReport.reportText(facts),
                    )
                }
            } catch (e: Exception) {
                // collect() is defensive already; this is belt-and-braces so a future
                // change can never leave the screen stuck on the spinner.
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = "تعذر جمع بيانات التشخيص. حاول مرة أخرى.",
                    )
                }
            }
        }
    }
}
