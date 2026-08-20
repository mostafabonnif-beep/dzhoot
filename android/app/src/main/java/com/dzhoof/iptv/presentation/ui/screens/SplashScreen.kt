package com.dzhoof.iptv.presentation.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import com.dzhoof.iptv.R
import com.dzhoof.iptv.presentation.ui.animation.EaseOutQuart
import com.dzhoof.iptv.presentation.ui.animation.SPLASH_FADE_OUT_DURATION
import com.dzhoof.iptv.presentation.ui.animation.SPLASH_MIN_DISPLAY_MS
import com.dzhoof.iptv.presentation.ui.theme.Void950
import kotlinx.coroutines.delay

/**
 * DZ HOOF branded splash screen.
 *
 * The splash uses the same supplied DZ HOOF artwork as the launcher icon so the
 * application has one unmistakable identity across installation, startup and
 * the main experience. It deliberately does not load legacy assets.
 */
@Composable
fun SplashScreen(onSplashFinished: () -> Unit) {
    var fadingOut by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        delay(SPLASH_MIN_DISPLAY_MS)
        fadingOut = true
        delay(SPLASH_FADE_OUT_DURATION.toLong())
        onSplashFinished()
    }

    val alpha by animateFloatAsState(
        targetValue = if (fadingOut) 0f else 1f,
        animationSpec = tween(SPLASH_FADE_OUT_DURATION, easing = EaseOutQuart),
        label = "splashFadeOut"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Void950)
            .graphicsLayer { this.alpha = alpha },
        contentAlignment = Alignment.Center
    ) {
        Image(
            painter = painterResource(R.drawable.dzhoof_logo),
            contentDescription = stringResource(R.string.app_name),
            modifier = Modifier
                .fillMaxWidth(0.74f)
                .aspectRatio(1f)
        )
    }
}
