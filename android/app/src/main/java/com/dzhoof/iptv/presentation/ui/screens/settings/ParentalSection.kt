package com.dzhoof.iptv.presentation.ui.screens.settings

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.dzhoof.iptv.data.AppPreferences
import com.dzhoof.iptv.presentation.ui.components.ParentalPinDialog
import com.dzhoof.iptv.presentation.ui.screens.SettingRowLayout
import com.dzhoof.iptv.presentation.ui.screens.SettingsCard

/**
 * Parental controls: enable a PIN lock (channels require the PIN once per app
 * session) and set/change/remove the PIN. Self-contained — reads and writes
 * [AppPreferences] directly, so it needs no ViewModel plumbing.
 */
@Composable
internal fun ParentalSection(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var lockEnabled by remember { mutableStateOf(AppPreferences.isParentalLockEnabled(context)) }
    var hasPin by remember { mutableStateOf(AppPreferences.hasParentalPin(context)) }
    var showPinSetup by remember { mutableStateOf(false) }
    var showDisableConfirm by remember { mutableStateOf(false) }

    SettingsCard(title = "Parental Controls", modifier = modifier) {
        SettingRowLayout(
            text = {
                Text("Parental lock", style = MaterialTheme.typography.bodyLarge)
                Text(
                    text = if (lockEnabled) {
                        "Channels require the PIN once per app session"
                    } else {
                        "Channels play without a PIN"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            },
            action = {
                Switch(
                    checked = lockEnabled,
                    onCheckedChange = { enable ->
                        if (enable) {
                            if (hasPin) {
                                AppPreferences.setParentalLockEnabled(context, true)
                                lockEnabled = true
                            } else {
                                // A PIN must exist before the lock can be enabled.
                                showPinSetup = true
                            }
                        } else {
                            // Disabling requires confirming the current PIN.
                            showDisableConfirm = true
                        }
                    }
                )
            }
        )

        SettingRowLayout(
            text = {
                Text(if (hasPin) "Change PIN" else "Set PIN", style = MaterialTheme.typography.bodyLarge)
                Text(
                    text = "4-6 digits. Stored as a hash, never in plain text.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            },
            action = {
                TextButton(onClick = { showPinSetup = true }) {
                    Text(if (hasPin) "Change" else "Set")
                }
            }
        )
    }

    if (showPinSetup) {
        PinSetupDialog(
            hasExistingPin = hasPin,
            onDone = { newPin ->
                if (AppPreferences.setParentalPin(context, newPin)) {
                    hasPin = true
                    // Enabling the lock right after setting the first PIN is the
                    // expected flow; a successful setup implies the parent is present.
                    if (!lockEnabled) {
                        AppPreferences.setParentalLockEnabled(context, true)
                        lockEnabled = true
                    }
                }
                showPinSetup = false
            },
            onDismiss = { showPinSetup = false }
        )
    }

    if (showDisableConfirm) {
        ParentalPinDialog(
            title = "Enter current PIN to disable",
            verify = { AppPreferences.verifyParentalPin(context, it) },
            onSuccess = {
                AppPreferences.setParentalLockEnabled(context, false)
                lockEnabled = false
                showDisableConfirm = false
            },
            onDismiss = { showDisableConfirm = false }
        )
    }
}

/** Set / change PIN dialog: current PIN (if set) → new PIN → confirm. */
@Composable
private fun PinSetupDialog(
    hasExistingPin: Boolean,
    onDone: (newPin: String) -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    var needCurrent by remember { mutableStateOf(hasExistingPin) }
    var newPin by remember { mutableStateOf<String?>(null) }

    val title = when {
        needCurrent -> "Enter current PIN"
        newPin == null -> "Enter new PIN (4-6 digits)"
        else -> "Confirm new PIN"
    }

    ParentalPinDialog(
        title = title,
        verify = { pin ->
            when {
                needCurrent -> AppPreferences.verifyParentalPin(context, pin)
                newPin == null -> com.dzhoof.iptv.data.ParentalPinUtils.isValidPin(pin)
                else -> pin == newPin
            }
        },
        errorMessage = when {
            needCurrent -> "Incorrect PIN"
            newPin == null -> "PIN must be 4-6 digits"
            else -> "PINs do not match"
        },
        onSuccess = { pin ->
            when {
                needCurrent -> needCurrent = false
                newPin == null -> newPin = pin
                else -> onDone(pin)
            }
        },
        onDismiss = onDismiss
    )
}
