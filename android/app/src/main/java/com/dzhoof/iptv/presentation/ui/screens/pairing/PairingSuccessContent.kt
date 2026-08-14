package com.dzhoof.iptv.presentation.ui.screens.pairing

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.ui.screens.FocusAwareButton
import com.dzhoof.iptv.presentation.ui.theme.Amber

/**
 * Legacy success content kept for compatibility with older navigation paths.
 * It intentionally contains no pairing URL, QR code, source name, or admin link.
 */
@Composable
internal fun PairingSuccessContent(
    username: String,
    serverUrl: String,
    isTvDevice: Boolean,
    channelManagerQrBitmap: Bitmap?,
    onContinue: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = "تم تفعيل اشتراكك بنجاح",
                style = MaterialTheme.typography.headlineSmall,
                color = Amber,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "مرحبًا بك${username.takeIf { it.isNotBlank() }?.let { "، $it" } ?: ""}. أصبح المحتوى متاحًا لك.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(modifier = Modifier.height(28.dp))
            FocusAwareButton(
                onClick = onContinue,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Amber,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                modifier = Modifier
                    .fillMaxWidth(0.72f)
                    .height(52.dp),
            ) {
                Text(
                    text = "متابعة إلى المحتوى",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}
