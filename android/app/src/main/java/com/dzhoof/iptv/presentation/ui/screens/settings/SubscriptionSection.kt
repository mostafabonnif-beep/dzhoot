package com.dzhoof.iptv.presentation.ui.screens.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.hilt.navigation.compose.hiltViewModel
import com.dzhoof.iptv.R
import com.dzhoof.iptv.presentation.ui.components.Status
import com.dzhoof.iptv.presentation.ui.components.StatusText
import com.dzhoof.iptv.presentation.ui.screens.FocusAwareOutlinedButton
import com.dzhoof.iptv.presentation.ui.screens.SettingRowLayout
import com.dzhoof.iptv.presentation.ui.screens.SettingsCard
import com.dzhoof.iptv.presentation.util.normalizeActivationCodeInput
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

    SettingsCard(title = stringResource(R.string.subscription_title), modifier = modifier) {
        val sub = uiState.subscription
        val status = sub?.subscription?.status
        val active = status == "ACTIVE"
        val expired = status == "EXPIRED"

        SettingRowLayout(
            text = {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = stringResource(R.string.subscription_redeem_title),
                        fontWeight = FontWeight.Medium,
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = stringResource(R.string.subscription_redeem_hint),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = code,
                        onValueChange = { code = normalizeActivationCodeInput(it) },
                        singleLine = true,
                        placeholder = { Text(stringResource(R.string.activation_code_placeholder)) },
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Characters,
                            keyboardType = KeyboardType.Ascii,
                        ),
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
                        text = if (uiState.isRedeeming) {
                            stringResource(R.string.subscription_activate_loading)
                        } else {
                            stringResource(R.string.subscription_activate)
                        },
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

        if ((active || expired) && sub != null) {
            Spacer(modifier = Modifier.height(12.dp))
            SettingRowLayout(
                text = {
                    Column {
                        Text(
                            text = stringResource(R.string.subscription_plan_label, sub.plan?.name ?: "—"),
                            fontWeight = FontWeight.Medium,
                        )
                        Text(
                            text = stringResource(
                                if (expired) R.string.subscription_expired_on else R.string.subscription_expires_on,
                                sub.subscription?.expiresAt?.take(10) ?: "—",
                            ),
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Text(
                            text = stringResource(
                                R.string.subscription_devices_usage,
                                sub.devicesUsed,
                                sub.maxDevices,
                            ),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                },
                action = {
                    FocusAwareOutlinedButton(onClick = { viewModel.refresh() }) {
                        Text(
                            text = stringResource(R.string.subscription_refresh),
                            fontWeight = FontWeight.Medium,
                        )
                    }
                },
            )
        } else if (!uiState.isLoading && sub == null) {
            Spacer(modifier = Modifier.height(12.dp))
            StatusText(
                text = stringResource(R.string.subscription_none),
                status = Status.WARNING,
                fontWeight = FontWeight.Medium,
            )
        }

        if (!sub?.devices.isNullOrEmpty()) {
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.subscription_devices_title),
                fontWeight = FontWeight.Medium,
            )
            sub?.devices?.forEach { device ->
                Spacer(modifier = Modifier.height(6.dp))
                SettingRowLayout(
                    text = {
                        Column {
                            Text(
                                text = device.name?.takeIf { it.isNotBlank() }
                                    ?: (device.deviceId ?: stringResource(R.string.subscription_device_fallback)),
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
                            Text(
                                text = stringResource(R.string.subscription_delete_device),
                                fontWeight = FontWeight.Medium,
                            )
                        }
                    },
                )
            }
        }
    }
}
