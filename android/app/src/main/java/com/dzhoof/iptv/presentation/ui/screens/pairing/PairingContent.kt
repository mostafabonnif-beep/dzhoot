package com.dzhoof.iptv.presentation.ui.screens.pairing

import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.ui.animation.DURATION_NORMAL
import com.dzhoof.iptv.presentation.ui.animation.EaseOutQuart
import com.dzhoof.iptv.presentation.ui.theme.DzGreen300
import com.dzhoof.iptv.presentation.ui.theme.ScrimHeavy
import com.dzhoof.iptv.presentation.ui.theme.subtleBorder

@Composable
internal fun PairingContent(
    pin: String,
    statusMessage: String,
    statusColor: Color,
    countdownText: String,
    isLoading: Boolean,
    showRetryButton: Boolean,
    showCountdown: Boolean,
    qrCodeBitmap: Bitmap?,
    serverUrl: String,
    isTvDevice: Boolean,
    pairingUrl: String,
    onRetryClick: () -> Unit,
    onUseDefaultClick: () -> Unit,
    onUseAdvancedClick: () -> Unit = {}
) {
    val configuration = LocalConfiguration.current
    val isPortrait = configuration.orientation == Configuration.ORIENTATION_PORTRAIT
    // Size the QR to the available height so the PIN below it always fits (reserve
    // room for the label, the PIN box, and padding).
    val qrSize = (configuration.screenHeightDp - 260).coerceIn(180, 320).dp

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(if (isPortrait) 12.dp else if (isTvDevice) 24.dp else 16.dp)
    ) {
        if (isPortrait) {
            PortraitLayout(
                pin, statusMessage, statusColor, countdownText, showCountdown,
                showRetryButton, qrCodeBitmap, serverUrl, isTvDevice, pairingUrl,
                onRetryClick, onUseDefaultClick, onUseAdvancedClick
            )
        } else {
            Row(
                modifier = Modifier.fillMaxSize(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // LEFT — title, steps, the PIN (below the instructions), then actions
                InfoColumn(
                    isTvDevice = isTvDevice,
                    serverUrl = serverUrl,
                    pin = pin,
                    statusMessage = statusMessage,
                    statusColor = statusColor,
                    countdownText = countdownText,
                    showCountdown = showCountdown,
                    showRetryButton = showRetryButton,
                    onRetryClick = onRetryClick,
                    onUseAdvancedClick = onUseAdvancedClick,
                    onUseDefaultClick = onUseDefaultClick,
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .padding(end = 40.dp)
                )

                // RIGHT — big QR (or browser); PIN now lives beside the steps on the left
                Column(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    if (isTvDevice) {
                        QrSection(
                            qrCodeBitmap = qrCodeBitmap,
                            modifier = Modifier.fillMaxWidth(),
                            qrSize = qrSize
                        )
                    } else {
                        OpenBrowserSection(
                            pairingUrl = pairingUrl,
                            serverUrl = serverUrl,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }
        }

        if (isLoading) {
            Box(
                modifier = Modifier.fillMaxSize().background(ScrimHeavy),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(56.dp),
                    color = DzGreen300,
                    strokeWidth = 4.dp
                )
            }
        }
    }
}

/** Left panel: title, setup steps, the PIN (in context, below the steps), and actions. */
@Composable
private fun InfoColumn(
    isTvDevice: Boolean,
    serverUrl: String,
    pin: String,
    statusMessage: String,
    statusColor: Color,
    countdownText: String,
    showCountdown: Boolean,
    showRetryButton: Boolean,
    onRetryClick: () -> Unit,
    onUseAdvancedClick: () -> Unit,
    onUseDefaultClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.Start
    ) {
        Text(
            text = if (isTvDevice) "وصّل التلفاز" else "وصّل جهازك",
            style = MaterialTheme.typography.displaySmall,
            color = MaterialTheme.colorScheme.onSurface
        )

        Spacer(modifier = Modifier.height(12.dp))

        if (isTvDevice) {
            StepText("١. افتح $serverUrl وسجّل الدخول")
            StepText("٢. أدخل رمز الربط الظاهر أدناه")
            StepText("٣. أضف قنواتك وابدأ المشاهدة")
        } else {
            StepText("١. افتح الربط في المتصفح وسجّل الدخول")
            StepText("٢. سيُربط جهازك تلقائياً")
            StepText("٣. أضف قنواتك وابدأ المشاهدة")
        }

        Spacer(modifier = Modifier.height(16.dp))

        // PIN sits right under the instructions that reference it.
        PinSection(
            pin = pin,
            statusMessage = statusMessage,
            statusColor = statusColor,
            countdownText = countdownText,
            showCountdown = showCountdown,
            showRetryButton = showRetryButton,
            onRetryClick = onRetryClick,
            horizontalAlignment = Alignment.Start
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Secondary paths, de-emphasized: pairing above is the primary flow.
        SecondaryLink(
            text = "استكشف القنوات التجريبية",
            onClick = onUseDefaultClick
        )
        Spacer(modifier = Modifier.height(8.dp))
        SecondaryLink(
            text = "إعداد مصدر مختلف",
            onClick = onUseAdvancedClick
        )
    }
}

/** Portrait: everything stacked (title, steps, QR, PIN, actions). */
@Composable
private fun PortraitLayout(
    pin: String,
    statusMessage: String,
    statusColor: Color,
    countdownText: String,
    showCountdown: Boolean,
    showRetryButton: Boolean,
    qrCodeBitmap: Bitmap?,
    serverUrl: String,
    isTvDevice: Boolean,
    pairingUrl: String,
    onRetryClick: () -> Unit,
    onUseDefaultClick: () -> Unit,
    onUseAdvancedClick: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = if (isTvDevice) "وصّل التلفاز" else "وصّل جهازك",
            style = MaterialTheme.typography.displaySmall,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(modifier = Modifier.height(8.dp))
        StepText("١. افتح $serverUrl وسجّل الدخول", TextAlign.Center)
        StepText("٢. أدخل رمز الربط الظاهر أدناه", TextAlign.Center)
        StepText("٣. أضف قنواتك وابدأ المشاهدة", TextAlign.Center)

        Spacer(modifier = Modifier.height(20.dp))
        if (isTvDevice) {
            QrSection(qrCodeBitmap = qrCodeBitmap, modifier = Modifier.fillMaxWidth())
        } else {
            OpenBrowserSection(pairingUrl = pairingUrl, serverUrl = serverUrl, modifier = Modifier.fillMaxWidth())
        }

        Spacer(modifier = Modifier.height(20.dp))
        PinSection(
            pin = pin,
            statusMessage = statusMessage,
            statusColor = statusColor,
            countdownText = countdownText,
            showCountdown = showCountdown,
            showRetryButton = showRetryButton,
            onRetryClick = onRetryClick,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(20.dp))
        SecondaryLink(text = "استكشف القنوات التجريبية", onClick = onUseDefaultClick)
        Spacer(modifier = Modifier.height(6.dp))
        SecondaryLink(text = "إعداد مصدر مختلف", onClick = onUseAdvancedClick)
    }
}

/**
 * Low-emphasis, D-pad-focusable ghost button for the pairing screen's secondary
 * paths (demo, advanced source). Resting state is a quiet outline — not a filled
 * / highlighted button — so it reads clearly as an action without competing with
 * the primary pairing hero. On focus the outline + label tint amber.
 */
@Composable
private fun SecondaryLink(text: String, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(
        targetValue = if (focused) 1.05f else 1f,
        animationSpec = tween(DURATION_NORMAL, easing = EaseOutQuart),
        label = "linkScale"
    )
    OutlinedButton(
        onClick = onClick,
        shape = CutCornerShape(topStart = 10.dp, topEnd = 3.dp, bottomEnd = 10.dp, bottomStart = 3.dp),
        border = BorderStroke(1.dp, if (focused) DzGreen300.copy(alpha = 0.70f) else subtleBorder),
        colors = ButtonDefaults.outlinedButtonColors(
            contentColor = if (focused) DzGreen300 else MaterialTheme.colorScheme.onSurfaceVariant
        ),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        modifier = Modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .onFocusChanged { focused = it.isFocused }
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium
        )
    }
}

@Composable
private fun StepText(text: String, align: TextAlign = TextAlign.Start) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = align
    )
}
