package com.dzhoof.iptv.presentation.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.ui.theme.DzGreen300
import com.dzhoof.iptv.presentation.ui.theme.DzGreen400

private val RecoveryPanelShape = CutCornerShape(
    topStart = 22.dp,
    topEnd = 4.dp,
    bottomEnd = 22.dp,
    bottomStart = 4.dp
)
private val RecoveryActionShape = RoundedCornerShape(5.dp)

/**
 * Minimal no-network recovery surface. It contains no playlist, player, EPG,
 * image loader, or background job, so a crash-looping device always has a
 * usable first frame and a deliberate normal-retry action.
 */
@Composable
internal fun StartupRecoveryScreen(
    lastFailureType: String?,
    onRetryNormally: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Surface(
            shape = RecoveryPanelShape,
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, DzGreen300.copy(alpha = 0.45f)),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 22.dp, vertical = 28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Surface(
                    shape = RecoveryActionShape,
                    color = DzGreen300.copy(alpha = 0.14f),
                    border = BorderStroke(1.dp, DzGreen300.copy(alpha = 0.34f)),
                    modifier = Modifier.size(58.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.Shield,
                            contentDescription = null,
                            tint = DzGreen300,
                            modifier = Modifier.size(30.dp)
                        )
                    }
                }
                Text(
                    text = "DZ HOOF / RECOVERY",
                    style = MaterialTheme.typography.labelLarge,
                    color = DzGreen300,
                    fontWeight = FontWeight.ExtraBold
                )
                Text(
                    text = "تم فتح التطبيق في وضع آمن",
                    style = MaterialTheme.typography.headlineSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.ExtraBold,
                    textAlign = TextAlign.Center
                )
                Text(
                    text = "تم تعليق عمليات الخلفية مؤقتاً لأن التشغيل السابق لم يكتمل. يمكنك الآن إعادة المحاولة بصورة عادية.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )
                lastFailureType?.takeIf { it.isNotBlank() }?.let { type ->
                    Text(
                        text = "رمز التشخيص: $type",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Button(
                    onClick = onRetryNormally,
                    shape = RecoveryActionShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = DzGreen400,
                        contentColor = Color(0xFF052015)
                    )
                ) {
                    Icon(imageVector = Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(19.dp))
                    Spacer(modifier = Modifier.size(7.dp))
                    Text(text = "إعادة المحاولة", fontWeight = FontWeight.ExtraBold)
                }
            }
        }
    }
}
