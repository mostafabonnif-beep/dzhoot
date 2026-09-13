package com.dzhoof.iptv.presentation.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.model.ErrorType
import com.dzhoof.iptv.presentation.ui.animation.FOCUS_SCALE_TILE
import com.dzhoof.iptv.presentation.ui.animation.animateFadeIn
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.presentation.ui.theme.FocusBorder

@Composable
fun ErrorState(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    errorType: ErrorType = ErrorType.UNKNOWN,
    onPairDevice: (() -> Unit)? = null
) {
    val icon = when (errorType) {
        ErrorType.AUTH_REQUIRED -> Icons.Default.Link
        ErrorType.NETWORK_ERROR -> Icons.Default.WifiOff
        else -> Icons.Default.Warning
    }

    val title = when (errorType) {
        ErrorType.AUTH_REQUIRED -> "الجهاز غير مربوط"
        ErrorType.NETWORK_ERROR -> "تعذر الوصول إلى الخادم"
        else -> "تعذر تحميل المحتوى"
    }
    val displayMessage = when {
        message.isBlank() -> "حاول مرة أخرى بعد لحظات."
        message.contains("unable to load", ignoreCase = true) ->
            "تعذر تحميل المحتوى الآن. تحقق من الاتصال وحاول مرة أخرى."
        message.contains("timeout", ignoreCase = true) ||
            message.contains("failed to connect", ignoreCase = true) ->
            "تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مرة أخرى."
        else -> message
    }

    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Surface(
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
            tonalElevation = 2.dp,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)),
            modifier = Modifier.padding(Dimens.ScreenPaddingHorizontalMobile)
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Dimens.Space3),
                modifier = Modifier
                    .widthIn(max = Dimens.ErrorCardMaxWidth)
                    .padding(
                        horizontal = Dimens.ErrorCardPaddingHorizontal,
                        vertical = Dimens.ErrorCardPaddingVertical
                    )
                    .animateFadeIn()
            ) {
                Box(
                    modifier = Modifier
                        .size(Dimens.StateMedallionSize)
                        .clip(MaterialTheme.shapes.large)
                        .background(MaterialTheme.colorScheme.error.copy(alpha = 0.12f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(Dimens.IconLarge)
                    )
                }

                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onBackground,
                    textAlign = TextAlign.Center
                )
                Text(
                    text = displayMessage,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(Dimens.Space1))

                if (errorType == ErrorType.AUTH_REQUIRED && onPairDevice != null) {
                    var pairFocused by remember { mutableStateOf(false) }
                    Button(
                        onClick = onPairDevice,
                        shape = MaterialTheme.shapes.medium,
                        modifier = Modifier
                            .tvFocusVisuals(
                                focused = pairFocused,
                                shape = MaterialTheme.shapes.medium,
                                focusedScale = FOCUS_SCALE_TILE
                            )
                            .onFocusChanged { pairFocused = it.isFocused }
                    ) {
                        Text(
                            text = "الربط الآن",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    Spacer(modifier = Modifier.height(Dimens.Space1))
                }

                var retryFocused by remember { mutableStateOf(false) }
                val retryBorder = if (retryFocused) {
                    BorderStroke(2.dp, FocusBorder)
                } else {
                    BorderStroke(1.dp, MaterialTheme.colorScheme.primary)
                }
                OutlinedButton(
                    onClick = onRetry,
                    border = retryBorder,
                    shape = MaterialTheme.shapes.medium,
                    modifier = Modifier
                        .tvFocusVisuals(
                            focused = retryFocused,
                            shape = MaterialTheme.shapes.medium,
                            focusedScale = FOCUS_SCALE_TILE,
                            restingElevation = 0.dp,
                            focusedElevation = 0.dp
                        )
                        .onFocusChanged { retryFocused = it.isFocused }
                ) {
                    Text(
                        text = "إعادة المحاولة",
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
        }
    }
}
