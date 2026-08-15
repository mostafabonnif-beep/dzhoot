package com.dzhoof.iptv.presentation.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.VpnKey
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.viewmodel.SubscriptionUiState

/**
 * Mandatory subscription gate shown before Home. A valid activation code is
 * required before the client can browse or play content.
 */
@Composable
fun SubscriptionGateScreen(
    uiState: SubscriptionUiState,
    onClaim: (String) -> Unit,
) {
    var code by rememberSaveable { mutableStateOf("") }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            modifier = Modifier.widthIn(max = 560.dp),
            shape = MaterialTheme.shapes.extraLarge,
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.48f),
            tonalElevation = 4.dp,
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 28.dp, vertical = 36.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Surface(
                    modifier = Modifier.size(72.dp),
                    shape = MaterialTheme.shapes.extraLarge,
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.VpnKey,
                            contentDescription = "كود التفعيل",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(38.dp),
                        )
                    }
                }
                Spacer(modifier = Modifier.size(20.dp))
                Text(
                    text = "فعّل اشتراكك",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )
                Spacer(modifier = Modifier.size(10.dp))
                Text(
                    text = "أدخل كود التفعيل للوصول إلى القنوات والمحتوى المتاح ضمن اشتراكك.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Spacer(modifier = Modifier.size(20.dp))
                OutlinedTextField(
                    value = code,
                    onValueChange = { value ->
                        code = value
                            .uppercase()
                            .filter { it.isLetterOrDigit() || it == '-' }
                            .take(24)
                    },
                    label = { Text("كود التفعيل") },
                    placeholder = { Text("XXXX-XXXX-XXXX-XXXX") },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Default.VpnKey,
                            contentDescription = null,
                        )
                    },
                    singleLine = true,
                    enabled = !uiState.isRedeeming,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(modifier = Modifier.size(16.dp))
                Button(
                    onClick = { onClaim(code.trim()) },
                    enabled = code.isNotBlank() && !uiState.isRedeeming,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (uiState.isRedeeming) {
                        CircularProgressIndicator(
                            modifier = Modifier.width(20.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("تفعيل الاشتراك", fontWeight = FontWeight.SemiBold)
                    }
                }
                uiState.error?.takeIf { it.isNotBlank() }?.let { error ->
                    Spacer(modifier = Modifier.size(16.dp))
                    Text(
                        text = error,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                        textAlign = TextAlign.Center,
                    )
                }
                Text(
                    text = "يمكنك إدخال كود جديد بعد انتهاء الاشتراك أو التواصل مع الدعم.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 16.dp),
                )
            }
        }
    }
}
