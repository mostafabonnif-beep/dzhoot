package com.dzhoof.iptv.presentation.ui.screens.settings

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dzhoof.iptv.presentation.ui.components.AppSpinner
import com.dzhoof.iptv.presentation.ui.components.ScreenScaffold
import com.dzhoof.iptv.presentation.ui.components.SpinnerSize
import com.dzhoof.iptv.presentation.ui.components.Status
import com.dzhoof.iptv.presentation.ui.components.StatusText
import com.dzhoof.iptv.presentation.ui.screens.FocusAwareButton
import com.dzhoof.iptv.presentation.ui.screens.FocusAwareOutlinedButton
import com.dzhoof.iptv.presentation.ui.screens.SettingsCard
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.presentation.ui.theme.subtleBorder
import com.dzhoof.iptv.presentation.viewmodel.DiagnosticsViewModel
import kotlinx.coroutines.delay

/**
 * In-app diagnostics ("تشخيص التطبيق"): which build this is, how it was installed, what the
 * last update check did and which backend it talks to — with a copy action that puts a
 * non-sensitive, support-safe report on the clipboard.
 *
 * Every value shown is pre-screened by `DiagnosticsReport`; this screen never reads or
 * formats a secret itself.
 */
@Composable
internal fun DiagnosticsScreen(
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: DiagnosticsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val isCompact = LocalConfiguration.current.screenWidthDp < 600
    var copied by remember { mutableStateOf(false) }

    // Reset the "copied" confirmation shortly after a copy.
    LaunchedEffect(copied) {
        if (copied) {
            delay(2_500)
            copied = false
        }
    }

    ScreenScaffold(
        title = "تشخيص التطبيق",
        modifier = modifier,
        onBack = onNavigateBack,
        trailing = {
            FocusAwareOutlinedButton(onClick = viewModel::refresh) {
                if (uiState.isLoading) {
                    AppSpinner()
                    Spacer(modifier = Modifier.width(8.dp))
                }
                Text(text = "تحديث", fontWeight = FontWeight.Medium)
            }
        }
    ) {
        if (uiState.isLoading && uiState.sections.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                AppSpinner(size = SpinnerSize.Medium)
            }
            return@ScreenScaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(
                    start = if (isCompact) Dimens.ScreenPaddingHorizontalMobile else Dimens.ScreenPaddingHorizontalTv,
                    end = if (isCompact) Dimens.ScreenPaddingHorizontalMobile else Dimens.ScreenPaddingHorizontalTv,
                    bottom = if (isCompact) Dimens.ScreenPaddingVerticalMobile else Dimens.Space5
                ),
            verticalArrangement = Arrangement.spacedBy(Dimens.Space3)
        ) {
            Text(
                text = "معلومات غير حساسة يمكنك نسخها ومشاركتها مع الدعم.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            uiState.error?.let { message ->
                StatusText(text = message, status = Status.WARNING, fontWeight = FontWeight.Medium)
            }

            uiState.sections.forEach { section ->
                SettingsCard(title = section.title) {
                    section.lines.forEachIndexed { index, line ->
                        if (index > 0) {
                            Spacer(modifier = Modifier.height(Dimens.Space2))
                            HorizontalDivider(color = subtleBorder)
                            Spacer(modifier = Modifier.height(Dimens.Space2))
                        }
                        DiagnosticsRow(label = line.label, value = line.value)
                    }
                }
            }

            FocusAwareButton(
                onClick = {
                    copyToClipboard(context.getSystemService(ClipboardManager::class.java), uiState.reportText)
                    copied = true
                },
                enabled = uiState.reportText.isNotBlank()
            ) {
                Text(
                    text = if (copied) "تم نسخ التقرير" else "نسخ التقرير",
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
    }
}

@Composable
private fun DiagnosticsRow(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}

private fun copyToClipboard(clipboard: ClipboardManager?, report: String) {
    if (clipboard == null || report.isBlank()) return
    clipboard.setPrimaryClip(ClipData.newPlainText("DZHOOF diagnostics", report))
}
