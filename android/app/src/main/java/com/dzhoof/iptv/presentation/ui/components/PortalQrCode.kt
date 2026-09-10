package com.dzhoof.iptv.presentation.ui.components

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.BuildConfig
import com.dzhoof.iptv.R
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * QR to the public subscriber portal — the "scan to manage" affordance an IPTV
 * box puts where the viewer can reach it: the end of the settings device card
 * and the foot of the home portal.
 *
 * The bitmap is built off the main thread (zxing walks a 512px matrix) and only
 * once per URL; if encoding fails the caller's layout simply renders without it.
 */
@Composable
fun PortalQrCode(
    modifier: Modifier = Modifier,
    size: Dp = Dimens.PortalQrSize,
    showHint: Boolean = true,
) {
    val portalUrl = remember { BuildConfig.API_BASE_URL.trimEnd('/') }
    var bitmap by remember(portalUrl) { mutableStateOf<Bitmap?>(null) }

    LaunchedEffect(portalUrl) {
        bitmap = withContext(Dispatchers.Default) { qrCodeBitmap(portalUrl) }
    }

    val qr = bitmap ?: return
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        ThemeAwareQrCode(
            bitmap = qr,
            contentDescription = stringResource(R.string.device_portal_qr_cd),
            size = size,
        )
        if (showHint) {
            Spacer(modifier = Modifier.height(Dimens.Space2))
            Text(
                text = stringResource(R.string.device_portal_qr_hint),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}
