package com.dzhoof.iptv.presentation.ui.screens.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.dzhoof.iptv.presentation.ui.components.Status
import com.dzhoof.iptv.presentation.ui.components.StatusText
import com.dzhoof.iptv.presentation.ui.screens.FocusAwareOutlinedButton
import com.dzhoof.iptv.presentation.ui.screens.SettingRowLayout
import com.dzhoof.iptv.presentation.ui.screens.SettingsCard
import com.dzhoof.iptv.presentation.viewmodel.SubscriptionViewModel

/**
 * Settings section for the subscription & activation system:
 * redeem an activation code, see the current plan/expiry, and manage devices.
 */
@Composable
internal fun SubscriptionSection(
    modifier: Modifier = Modifier,
    viewModel: SubscriptionViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    var code by remember { mutableStateOf("") }

    SettingsCard(title = "Subscription", modifier = modifier) {
        val sub = uiState.subscription
        val active = sub?.subscription?.status == "ACTIVE"

        // Redeem input
        SettingRowLayout(
            text = {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Activate Code",
                        fontWeight = FontWeight.Medium,
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = "Enter a DZHF-XXXX-XXXX-XXXX code. The duration starts when the code is activated.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = code,
                        onValueChange = { code = it },
                        singleLine = true,
                        placeholder = { Text("DZHF-XXXX-XXXX-XXXX") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            action = {
                FocusAwareOutlinedButton(
                    onClick = {
                        if (code.isNotBlank() && !uiState.isRedeeming) {
                            viewModel.redeem(code.trim())
                        }
                    },
                ) {
                    Text(
                        text = if (uiState.isRedeeming) "Activating..." else "Activate",
                        fontWeight = FontWeight.Medium,
                    )
                }
            },
        )

        uiState.redeemSuccess?.let { message ->
            Spacer(modifier = Modifier.height(6.dp))
            StatusText(text = message, status = Status.SUCCESS, fontWeight = FontWeight.Medium)
        }
        uiState.error?.let { error ->
            Spacer(modifier = Modifier.height(6.dp))
            StatusText(text = error, status = Status.WARNING, fontWeight = FontWeight.Medium)
        }

        // Subscription status
        if (active && sub != null) {
            Spacer(modifier = Modifier.height(12.dp))
            SettingRowLayout(
                text = {
                    Column {
                        Text("Plan: ${sub.plan?.name ?: "—"}", fontWeight = FontWeight.Medium)
                        Text(
                            "Expires: ${sub.subscription?.expiresAt?.take(10) ?: "—"}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Text(
                            "Devices: ${sub.devicesUsed} / ${sub.maxDevices}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                },
                action = {
                    FocusAwareOutlinedButton(onClick = { viewModel.refresh() }) {
                        Text("Refresh", fontWeight = FontWeight.Medium)
                    }
                },
            )
        } else if (!uiState.isLoading && sub == null) {
            Spacer(modifier = Modifier.height(12.dp))
            StatusText(
                text = "No active subscription. Enter a code above to get started.",
                status = Status.WARNING,
                fontWeight = FontWeight.Medium,
            )
        }

        // Devices
        if (!sub?.devices.isNullOrEmpty()) {
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "Registered Devices",
                fontWeight = FontWeight.Medium,
            )
            sub?.devices?.forEach { device ->
                Spacer(modifier = Modifier.height(6.dp))
                SettingRowLayout(
                    text = {
                        Column {
                            Text(
                                text = device.name?.takeIf { it.isNotBlank() } ?: (device.deviceId ?: "Device"),
                                fontWeight = FontWeight.Medium,
                            )
                            Text(
                                text = device.deviceId ?: "",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    },
                    action = {
                        FocusAwareOutlinedButton(
                            onClick = { viewModel.removeDevice(device) },
                        ) {
                            Text("Remove", fontWeight = FontWeight.Medium)
                        }
                    },
                )
            }
        }
    }
}
