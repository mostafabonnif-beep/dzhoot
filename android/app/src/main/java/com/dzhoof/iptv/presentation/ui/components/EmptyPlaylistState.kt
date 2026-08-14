package com.dzhoof.iptv.presentation.ui.components

import android.graphics.Bitmap
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.ui.animation.DURATION_NORMAL
import com.dzhoof.iptv.presentation.ui.animation.EaseOutQuart
import com.dzhoof.iptv.presentation.ui.animation.animateFadeIn
import com.dzhoof.iptv.presentation.ui.theme.FocusBorder
import com.dzhoof.iptv.presentation.ui.theme.ShapeBadge

/**
 * Customer-facing empty state. Technical management links and source details
 * must never be shown to a subscriber.
 */
@Composable
fun EmptyPlaylistState(
    qrCodeBitmap: Bitmap?,
    onRetry: () -> Unit,
    isMobile: Boolean = false,
    channelManagerUrl: String = "",
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .padding(40.dp)
                .animateFadeIn(),
        ) {
            Icon(
                imageVector = Icons.Default.LiveTv,
                contentDescription = "لا يوجد محتوى متاح",
                tint = MaterialTheme.colorScheme.secondary.copy(alpha = 0.65f),
                modifier = Modifier.size(48.dp),
            )
            Text(
                text = "المحتوى غير متاح حاليًا",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )
            Text(
                text = "لم تتم إضافة قنوات متاحة لاشتراكك بعد. يرجى المحاولة لاحقًا أو التواصل مع الدعم.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(modifier = Modifier.height(8.dp))
            var isFocused by remember { mutableStateOf(false) }
            val scale by animateFloatAsState(
                targetValue = if (isFocused) 1.05f else 1f,
                animationSpec = tween(DURATION_NORMAL, easing = EaseOutQuart),
                label = "refreshBtnScale",
            )
            val border = if (isFocused) {
                BorderStroke(2.dp, FocusBorder.copy(alpha = 0.5f))
            } else {
                BorderStroke(1.dp, MaterialTheme.colorScheme.primary)
            }
            OutlinedButton(
                onClick = onRetry,
                border = border,
                shape = ShapeBadge,
                modifier = Modifier
                    .graphicsLayer { scaleX = scale; scaleY = scale }
                    .onFocusChanged { isFocused = it.isFocused },
            ) {
                Text(
                    text = "تحديث المحتوى",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}
