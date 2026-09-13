package com.dzhoof.iptv.data.ads

import android.app.Activity
import android.content.Context
import android.util.Log
import com.dzhoof.iptv.BuildConfig
import com.dzhoof.iptv.data.model.dto.AdsConfigDto
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * AdMob (Android) — free tier only.
 *
 * The server is the single authority on whether this account may see ads
 * (`ads.show`, from `/api/v1/me/subscription`): paying subscribers always get
 * `false`, so this class renders nothing for them even if the SDK is present.
 *
 * Everything here is defensive by design:
 *  - The SDK is initialized lazily, once, and only when Google Play services is
 *    actually available. DZ HOOF also ships to Fire TV / Amazon Appstore where
 *    Play services is absent — ads must degrade to a no-op, never crash the app.
 *  - Load failures (no fill, no network, unit id mismatch) call the fallback so
 *    playback is never blocked by an ad.
 *  - Unit ids come from the server config; the banner unit ships as a build
 *    default so a fresh install has something to request.
 */
@Singleton
class AdsManager @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    @Volatile
    private var config: AdsConfigDto? = null

    @Volatile
    private var initialized = false

    private val frequency = AdFrequencyPolicy()

    private var interstitial: InterstitialAd? = null

    /** Latest server config; the only way ads become eligible. */
    fun updateConfig(ads: AdsConfigDto?) {
        config = ads
        if (ads?.show == true) ensureInitialized()
    }

    /** True when this account may see ads AND this device can serve them. */
    val adsEligible: Boolean
        get() = config?.show == true && hasPlayServices()

    val bannerUnitId: String?
        get() = config?.android?.bannerUnitId?.takeIf { it.isNotBlank() }

    val interstitialUnitId: String?
        get() = config?.android?.interstitialUnitId?.takeIf { it.isNotBlank() }

    fun hasPlayServices(): Boolean = AdsAvailability.hasPlayServices(context)

    fun ensureInitialized() {
        if (initialized || !hasPlayServices()) return
        initialized = true
        try {
            MobileAds.initialize(context) { }
        } catch (e: Throwable) {
            // Never let an ad-SDK problem surface to the viewer.
            Log.w(TAG, "MobileAds init failed: ${e.message}")
        }
    }

    /**
     * Show an interstitial before playback when the policy allows it, then run
     * [onContinue] — which is also the fallback path for every failure.
     */
    fun maybeShowInterstitial(activity: Activity?, onContinue: () -> Unit) {
        val unitId = interstitialUnitId
        val every = config?.interstitialEveryMinutes ?: 0
        val cap = config?.frequencyCapPerSession ?: 0
        if (activity == null || !adsEligible || unitId == null || !frequency.canShow(every, cap)) {
            onContinue()
            return
        }
        ensureInitialized()
        try {
            InterstitialAd.load(
                context,
                unitId,
                AdRequest.Builder().build(),
                object : InterstitialAdLoadCallback() {
                    override fun onAdLoaded(ad: InterstitialAd) {
                        interstitial = ad
                        var resumed = false
                        val resumeOnce = {
                            if (!resumed) {
                                resumed = true
                                onContinue()
                            }
                        }
                        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                            override fun onAdDismissedFullScreenContent() {
                                interstitial = null
                                resumeOnce()
                            }

                            override fun onAdFailedToShowFullScreenContent(error: AdError) {
                                interstitial = null
                                resumeOnce()
                            }
                        }
                        frequency.recordShown()
                        ad.show(activity)
                    }

                    override fun onAdFailedToLoad(error: LoadAdError) {
                        Log.w(TAG, "interstitial failed to load: ${error.message}")
                        onContinue()
                    }
                },
            )
        } catch (e: Throwable) {
            Log.w(TAG, "interstitial threw: ${e.message}")
            onContinue()
        }
    }

    /** Build default used when the server has no unit configured yet. */
    fun defaultBannerUnitId(): String = BuildConfig.ADMOB_BANNER_UNIT_ID

    companion object {
        private const val TAG = "DzhoofAds"
    }
}
