package com.dzhoof.iptv.presentation.ui.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dzhoof.iptv.presentation.viewmodel.ReportProblemViewModel
import com.dzhoof.iptv.presentation.ui.components.AppSpinner
import com.dzhoof.iptv.presentation.ui.components.ScreenScaffold
import com.dzhoof.iptv.presentation.ui.components.SpinnerSize
import com.dzhoof.iptv.presentation.ui.components.Status
import com.dzhoof.iptv.presentation.ui.components.StatusText
import com.dzhoof.iptv.presentation.ui.screens.FocusAwareButton
import com.dzhoof.iptv.presentation.ui.screens.FocusAwareOutlinedButton
import com.dzhoof.iptv.presentation.ui.screens.SettingsCard
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.update.diagnostics.ProblemReportPayload
import com.dzhoof.iptv.update.diagnostics.ProblemReporter

/**
 * «إبلاغ عن مشكلة» — the customer-facing report form.
 *
 * Deliberately small: pick what you were doing, say what happened, send. What actually
 * travels is built by [ProblemReportPayload] from the same non-sensitive facts the
 * diagnostics screen shows, so the customer can be told the truth — the report carries the
 * app version, the build channel, the device model and whether the backend answered, and
 * never a password, a token, a cookie, a stream link or an account code.
 *
 * The screen works the same on a phone and on Android TV: it is a focusable column with no
 * gestures and no soft-keyboard-only affordance.
 */
@Composable
internal fun ReportProblemScreen(
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ReportProblemViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val isCompact = LocalConfiguration.current.screenWidthDp < 600

    ScreenScaffold(
        title = "إبلاغ عن مشكلة",
        modifier = modifier,
        onBack = onNavigateBack,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(
                    start = if (isCompact) Dimens.ScreenPaddingHorizontalMobile else Dimens.ScreenPaddingHorizontalTv,
                    end = if (isCompact) Dimens.ScreenPaddingHorizontalMobile else Dimens.ScreenPaddingHorizontalTv,
                    bottom = if (isCompact) Dimens.ScreenPaddingVerticalMobile else Dimens.Space5,
                ),
            verticalArrangement = Arrangement.spacedBy(Dimens.Space3),
        ) {
            Text(
                text = "صف ما حدث بإيجاز. يُرسل مع بلاغك إصدار التطبيق ونوع الجهاز وحالة الاتصال — " +
                    "ولا تُرسل كلمات المرور ولا روابط البث.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            when (val result = uiState.result) {
                is ProblemReporter.Result.Sent -> {
                    StatusText(
                        text = "تم الإرسال. رقم بلاغك: ${result.reportId}",
                        status = Status.SUCCESS,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        text = "احتفظ بهذا الرقم عند متابعة المشكلة.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                ProblemReporter.Result.Rejected -> StatusText(
                    text = "لم يقبل الخادم البلاغ. جرّب وصفًا مختلفًا أو أبلغنا لاحقًا.",
                    status = Status.WARNING,
                    fontWeight = FontWeight.Medium,
                )
                ProblemReporter.Result.Failed -> StatusText(
                    text = "تعذر إرسال البلاغ. تحقّق من الاتصال وأعد المحاولة.",
                    status = Status.WARNING,
                    fontWeight = FontWeight.Medium,
                )
                null -> Unit
            }

            SettingsCard(title = "ما الذي لم يعمل؟") {
                ProblemReportPayload.Category.entries.forEach { category ->
                    val selected = uiState.category == category
                    FocusAwareOutlinedButton(
                        onClick = { viewModel.selectCategory(category) },
                        enabled = !uiState.sending,
                    ) {
                        Text(
                            text = if (selected) "◉ ${category.label}" else "○ ${category.label}",
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                        )
                    }
                    Spacer(modifier = Modifier.height(Dimens.Space2))
                }
            }

            SettingsCard(title = "الوصف") {
                OutlinedTextField(
                    value = uiState.message,
                    onValueChange = viewModel::updateMessage,
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("مثال: القناة تتوقف بعد ثانيتين من الفتح") },
                    minLines = 3,
                    maxLines = 6,
                    enabled = !uiState.sending,
                )
                Spacer(modifier = Modifier.height(Dimens.Space2))
                Text(
                    text = "${uiState.message.length} / ${ProblemReportPayload.MESSAGE_MAX}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            FocusAwareButton(
                onClick = { viewModel.submit() },
                enabled = uiState.canSubmit,
            ) {
                if (uiState.sending) {
                    AppSpinner(size = SpinnerSize.Small)
                } else {
                    Text(text = "إرسال البلاغ", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
