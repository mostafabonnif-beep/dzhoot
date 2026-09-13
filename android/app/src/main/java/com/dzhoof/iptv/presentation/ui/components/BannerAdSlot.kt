package com.dzhoof.iptv.presentation.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import com.dzhoof.iptv.BuildConfig
import com.dzhoof.iptv.data.ads.AdsAvailability
import com.dzhoof.iptv.data.model.dto.AdsConfigDto
import com.dzhoof.iptv.presentation.ui.player.isMobileDevice
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView

/**
 * AdMob banner for the free tier.
 *
 * Rendered only when ALL of these hold:
 *  - the server said `ads.show = true` for this account (paid codes never get it),
 *  - the device is a phone/tablet (banners are not supported on Android TV, so
 *    TVs skip straight to interstitials),
 *  - Google Play services is available (Fire TV has none → no-op),
 *  - a banner unit id exists (server config, else the build default).
 *
 * Nothing is requested before those checks, so a paying subscriber's app makes
 * no ad traffic at all.
 */
@Composable
fun BannerAdSlot(
    ads: AdsConfigDto?,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val eligible = remember(ads?.show, context) {
        ads?.show == true &&
            isMobileDevice(context) &&
            AdsAvailability.hasPlayServices(context)
    }
    val unitId = remember(ads?.android?.bannerUnitId) {
        ads?.android?.bannerUnitId?.takeIf { it.isNotBlank() } ?: BuildConfig.ADMOB_BANNER_UNIT_ID
    }

    if (!eligible || unitId.isBlank()) return

    AndroidView(
        modifier = modifier.fillMaxWidth(),
        factory = { ctx ->
            AdView(ctx).apply {
                adUnitId = unitId
                setAdSize(AdSize.BANNER)
                loadAd(AdRequest.Builder().build())
            }
        },
    )
}
