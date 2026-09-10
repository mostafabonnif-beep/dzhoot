package com.dzhoof.iptv.presentation.ui.screens

import android.graphics.Bitmap
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.dzhoof.iptv.presentation.model.StatusTone
import com.dzhoof.iptv.presentation.ui.screens.pairing.PairingContent
import com.dzhoof.iptv.presentation.ui.screens.pairing.PairingSuccessContent

@Composable
fun PairingScreen(
    pin: String,
    statusMessage: String,
    statusTone: StatusTone,
    countdownText: String,
    isLoading: Boolean,
    showRetryButton: Boolean,
    showCountdown: Boolean,
    qrCodeBitmap: Bitmap?,
    serverUrl: String,
    isTvDevice: Boolean,
    pairingUrl: String,
    isPaired: Boolean = false,
    pairedUsername: String = "",
    channelManagerQrBitmap: Bitmap? = null,
    onRetryClick: () -> Unit,
    onUseDefaultClick: () -> Unit,
    onUseAdvancedClick: () -> Unit = {},
    onContinue: () -> Unit = {}
) {
    if (isPaired) {
        PairingSuccessContent(
            username = pairedUsername,
            serverUrl = serverUrl,
            isTvDevice = isTvDevice,
            channelManagerQrBitmap = channelManagerQrBitmap,
            onContinue = onContinue
        )
    } else {
        PairingContent(
            pin = pin,
            statusMessage = statusMessage,
            statusColor = when (statusTone) {
                StatusTone.SUCCESS -> MaterialTheme.colorScheme.primary
                StatusTone.ERROR -> MaterialTheme.colorScheme.error
                StatusTone.NEUTRAL -> MaterialTheme.colorScheme.onSurfaceVariant
            },
            countdownText = countdownText,
            isLoading = isLoading,
            showRetryButton = showRetryButton,
            showCountdown = showCountdown,
            qrCodeBitmap = qrCodeBitmap,
            serverUrl = serverUrl,
            isTvDevice = isTvDevice,
            pairingUrl = pairingUrl,
            onRetryClick = onRetryClick,
            onUseDefaultClick = onUseDefaultClick,
            onUseAdvancedClick = onUseAdvancedClick
        )
    }
}
