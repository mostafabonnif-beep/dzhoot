package com.dzhoof.iptv.presentation.ui.screens.guide

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dzhoof.iptv.presentation.model.ErrorType
import com.dzhoof.iptv.presentation.ui.components.EmptyState
import com.dzhoof.iptv.presentation.ui.components.ErrorState
import com.dzhoof.iptv.presentation.ui.components.LoadingIndicator
import com.dzhoof.iptv.presentation.viewmodel.GuideViewModel

/**
 * EPG Guide — a channels × time-slot program grid.
 *
 * Thin stateful root: owns the ViewModel and top-level state branching (loading /
 * error / empty / content). The grid, timeline and cells live in same-package
 * `internal` files. Center on a program tunes to that channel via [onChannelClick];
 * Back returns to the previous screen.
 */
@Composable
fun GuideScreen(
    onNavigateBack: () -> Unit,
    onChannelClick: (String) -> Unit,
    onCatchup: (channelId: String, startMillis: Long, durationMinutes: Int) -> Unit =
        { id, _, _ -> onChannelClick(id) },
    onPairDevice: () -> Unit = {},
    modifier: Modifier = Modifier,
    viewModel: GuideViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    BackHandler(enabled = true) { onNavigateBack() }

    Box(modifier = modifier.fillMaxSize()) {
        when {
            uiState.isLoading && uiState.isEmpty ->
                LoadingIndicator(message = "Loading guide…")

            uiState.error != null && uiState.isEmpty ->
                ErrorState(
                    message = uiState.error!!,
                    errorType = uiState.errorType,
                    onRetry = viewModel::retry,
                    onPairDevice = if (uiState.errorType == ErrorType.AUTH_REQUIRED) onPairDevice else null
                )

            uiState.isEmpty ->
                EmptyState(
                    message = "No channels available for the guide",
                    onRetry = viewModel::retry
                )

            else ->
                GuideContent(
                    state = uiState,
                    onProgramSelected = { channelId, program, supportsCatchup ->
                        val ended = program.endTime.isBefore(java.time.Instant.now())
                        // Catch-up is per-channel: only when the server advertises it
                        // (M3U catchup attrs or Xtream timeshift) and the program ended.
                        if (supportsCatchup && ended) {
                            val durationMinutes = java.time.Duration
                                .between(program.startTime, program.endTime)
                                .toMinutes().toInt().coerceAtLeast(1)
                            onCatchup(channelId, program.startTime.toEpochMilli(), durationMinutes)
                        } else {
                            onChannelClick(channelId)
                        }
                    },
                    onChannelSelected = onChannelClick,
                    onSelectFilter = viewModel::selectFilter,
                    onVisibleRangeChanged = viewModel::onVisibleRangeChanged,
                    modifier = Modifier.fillMaxSize()
                )
        }
    }
}
