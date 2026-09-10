package com.dzhoof.iptv.presentation.ui.screens.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.R
import com.dzhoof.iptv.presentation.model.UpdateInfo
import com.dzhoof.iptv.presentation.ui.components.AppSpinner
import com.dzhoof.iptv.presentation.ui.components.Status
import com.dzhoof.iptv.presentation.ui.components.StatusText
import com.dzhoof.iptv.presentation.ui.screens.FocusAwareOutlinedButton
import com.dzhoof.iptv.presentation.ui.screens.SettingRowLayout
import com.dzhoof.iptv.presentation.ui.screens.SettingsCard

@Composable
internal fun AboutSection(
    appVersion: String,
    isChecking: Boolean,
    updateInfo: UpdateInfo?,
    updateChecked: Boolean,
    isDownloading: Boolean,
    downloadError: String?,
    onCheckForUpdate: () -> Unit,
    onUpdateNow: () -> Unit,
    modifier: Modifier = Modifier
) {
    val busy = isChecking || isDownloading
    val canInstall = updateInfo != null && updateInfo.downloadUrl.isNotEmpty()

    SettingsCard(title = stringResource(R.string.about), modifier = modifier) {
        SettingRowLayout(
            text = {
                if (updateInfo != null) {
                    UpdateAvailableLabel(appVersion = appVersion, updateInfo = updateInfo)
                } else {
                    VersionLabel(appVersion = appVersion, upToDate = updateChecked && !isChecking)
                }
            },
            action = {
                // One persistent button across all states: replacing the focused
                // node mid-action drops TV focus back to the section rail's first
                // item, snapping the settings pane to Connection.
                FocusAwareOutlinedButton(
                    onClick = {
                        if (!busy) {
                            if (canInstall) onUpdateNow() else onCheckForUpdate()
                        }
                    }
                ) {
                    if (busy) {
                        AppSpinner()
                        Spacer(modifier = Modifier.width(8.dp))
                    }
                    Text(
                        text = when {
                            isChecking -> stringResource(R.string.update_checking)
                            isDownloading -> stringResource(R.string.update_downloading)
                            canInstall -> stringResource(R.string.update_now)
                            else -> stringResource(R.string.update_check_for_updates)
                        },
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        )
        downloadError?.let { error ->
            Spacer(modifier = Modifier.height(6.dp))
            StatusText(text = error, status = Status.WARNING, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun VersionLabel(
    appVersion: String,
    upToDate: Boolean,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier) {
        Text(
            text = stringResource(R.string.version_label),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface
        )
        Spacer(modifier = Modifier.height(2.dp))
        StatusText(
            text = if (upToDate) stringResource(R.string.version_up_to_date, appVersion) else appVersion,
            status = if (upToDate) Status.SUCCESS else Status.NEUTRAL
        )
    }
}

@Composable
private fun UpdateAvailableLabel(
    appVersion: String,
    updateInfo: UpdateInfo,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier) {
        Text(
            text = stringResource(R.string.update_available_version, updateInfo.versionName),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = buildString {
                append(stringResource(R.string.update_current_version, appVersion))
                if (updateInfo.fileSize.isNotEmpty()) append("  ·  ${updateInfo.fileSize}")
                if (updateInfo.isMandatory) append("  ·  " + stringResource(R.string.update_mandatory))
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
