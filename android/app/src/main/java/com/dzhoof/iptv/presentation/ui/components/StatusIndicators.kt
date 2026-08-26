package com.dzhoof.iptv.presentation.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.ui.theme.DzRed500
import com.dzhoof.iptv.presentation.ui.theme.LabelBadge
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Icon
import com.dzhoof.iptv.presentation.ui.theme.DzGold400
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import com.dzhoof.iptv.presentation.ui.theme.Success
import com.dzhoof.iptv.presentation.ui.theme.Warning

/** Small filled dot used to flag a banner/state's status. */
@Composable
fun StatusDot(color: Color, modifier: Modifier = Modifier) {
    androidx.compose.foundation.layout.Box(
        modifier = modifier
            .size(8.dp)
            .clip(CircleShape)
            .background(color)
    )
}

/** Semantic state for [StatusText] — maps to the app's shared feedback colors. */
enum class Status { SUCCESS, WARNING, NEUTRAL }

/**
 * Color-coded feedback text — "Saved", "Connected", "Up to date", error strings.
 * Centralises the Success/Warning/neutral color choice that was repeated inline
 * across settings and source screens.
 */
@Composable
fun StatusText(
    text: String,
    status: Status,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodySmall,
    fontWeight: FontWeight = FontWeight.Normal
) {
    Text(
        text = text,
        modifier = modifier,
        color = when (status) {
            Status.SUCCESS -> Success
            Status.WARNING -> Warning
            Status.NEUTRAL -> MaterialTheme.colorScheme.onSurfaceVariant
        },
        style = style,
        fontWeight = fontWeight
    )
}

/** Live "مباشر" badge — red pill (أحمر العلم) with a pulsing white dot. */
@Composable
fun LiveBadge(modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition()
    val dotAlpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = 0.35f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 700),
            repeatMode = RepeatMode.Reverse
        )
    )
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(DzRed500.copy(alpha = 0.92f))
            .padding(horizontal = 7.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp)
    ) {
        Box(
            modifier = Modifier
                .size(6.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = dotAlpha))
        )
        Text(
            text = "مباشر",
            color = Color.White,
            style = LabelBadge,
            fontWeight = FontWeight.Bold,
            maxLines = 1
        )
    }
}

/** وضع الديمو — شريط رفيع يظهر أعلى الرئيسية في وضع التصفح التجريبي. */
@Composable
fun DemoModeBanner(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(DzGold400.copy(alpha = 0.14f))
            .border(1.dp, DzGold400.copy(alpha = 0.45f), RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Icon(
            imageVector = Icons.Filled.Info,
            contentDescription = null,
            tint = DzGold400,
            modifier = Modifier.size(18.dp)
        )
        Text(
            text = "وضع الديمو — قنوات تجريبية. اربط جهازك بكود تفعيل للوصول الكامل.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 2
        )
    }
}
