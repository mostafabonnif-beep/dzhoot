package com.dzhoof.iptv.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dzhoof.iptv.presentation.model.ReportProblemUiState
import com.dzhoof.iptv.update.diagnostics.ProblemReportPayload
import com.dzhoof.iptv.update.diagnostics.ProblemReporter
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Drives «إبلاغ عن مشكلة»: holds the draft, submits it through [ProblemReporter] and exposes
 * the result (including the report id the customer quotes to support).
 *
 * The only validation here is "there is something to send"; the payload rules live in
 * [ProblemReportPayload], where they are unit-tested.
 */
@HiltViewModel
internal class ReportProblemViewModel @Inject constructor(
    private val reporter: ProblemReporter,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ReportProblemUiState())
    val uiState: StateFlow<ReportProblemUiState> = _uiState.asStateFlow()

    fun selectCategory(category: ProblemReportPayload.Category) {
        // Changing the category after a send clears the previous outcome: the result belongs
        // to the report that was sent, not to the draft now on screen.
        _uiState.update { it.copy(category = category, result = null) }
    }

    fun updateMessage(message: String) {
        _uiState.update {
            it.copy(
                message = message.take(ProblemReportPayload.MESSAGE_MAX),
                result = null,
            )
        }
    }

    fun submit() {
        val state = _uiState.value
        if (!state.canSubmit) return

        viewModelScope.launch {
            _uiState.update { it.copy(sending = true) }
            val result = try {
                reporter.submit(message = state.message, category = state.category)
            } catch (e: Exception) {
                // submit() is defensive already; this keeps the button from sticking on if a
                // future change throws before the call.
                ProblemReporter.Result.Failed
            }
            _uiState.update { it.copy(sending = false, result = result) }
        }
    }
}
