package com.dzhoof.iptv.presentation.ui.screens

import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.dzhoof.iptv.presentation.viewmodel.SubscriptionViewModel
import kotlinx.coroutines.delay

/** Customer-facing first-run gate: one activation code, then the app opens Home. */
@Composable
fun ActivationScreen(
    onActivated: () -> Unit,
    viewModel: SubscriptionViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    var code by remember { mutableStateOf("") }

    LaunchedEffect(uiState.redeemSuccess) {
        if (uiState.redeemSuccess != null) {
            delay(700)
            onActivated()
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 28.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = "مرحبًا بك في DZ HOOF",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            Spacer(modifier = Modifier.width(1.dp))
            Text(
                text = "فعّل جهازك وابدأ مشاهدة القنوات",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp),
            )
            Spacer(modifier = Modifier.width(1.dp))
            Text(
                text = "أدخل كود التفعيل الذي استلمته من البائع. لا تحتاج إلى إدخال رابط الخادم أو رمز PIN.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 18.dp),
            )
            Spacer(modifier = Modifier.width(1.dp))
            OutlinedTextField(
                value = code,
                onValueChange = { code = it.uppercase() },
                label = { Text("كود التفعيل") },
                placeholder = { Text("DZHF-XXXX-XXXX-XXXX") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    keyboardType = KeyboardType.Ascii,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 22.dp)
                    .focusable(),
            )
            Spacer(modifier = Modifier.width(1.dp))
            Button(
                onClick = { viewModel.clientRedeem(code) },
                enabled = code.isNotBlank() && !uiState.isRedeeming,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 18.dp)
                    .focusable(),
            ) {
                if (uiState.isRedeeming) {
                    CircularProgressIndicator(strokeWidth = 2.dp)
                } else {
                    Text("تفعيل الجهاز", fontWeight = FontWeight.SemiBold)
                }
            }
            uiState.error?.let { message ->
                Text(
                    text = message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 14.dp),
                )
            }
            uiState.redeemSuccess?.let { message ->
                Text(
                    text = message,
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 14.dp),
                )
            }
        }
    }
}
