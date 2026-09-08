package com.dzhoof.iptv.presentation.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.MediaItem
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.compose.ui.viewinterop.AndroidView
import com.dzhoof.iptv.presentation.viewmodel.VodPlayerViewModel

/** Playback speeds offered by the VOD speed chip, in increasing order. */
internal val VOD_SPEED_OPTIONS: List<Float> = listOf(0.75f, 1.0f, 1.25f, 1.5f, 2.0f)

/** Cycles to the next speed (wraps around); used by both the chip and unit tests. */
internal fun nextPlaybackSpeed(current: Float, options: List<Float> = VOD_SPEED_OPTIONS): Float {
    val index = options.indexOfFirst { kotlin.math.abs(it - current) < 0.001f }
    if (index < 0) return options.firstOrNull() ?: 1.0f
    return options[(index + 1) % options.size]
}

/** Compact chip label: "1×", "1.25×", "2×" … */
internal fun speedLabel(speed: Float): String {
    val text = if (speed % 1f == 0f) speed.toInt().toString() else speed.toString()
    return "$text×"
}

@Composable
fun VodPlayerScreen(
    contentType: String,
    contentId: String,
    title: String,
    onNavigateBack: () -> Unit,
    viewModel: VodPlayerViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val player = androidx.compose.runtime.remember { viewModel.createPlayer() }

    BackHandler(onBack = onNavigateBack)

    LaunchedEffect(contentType, contentId) {
        viewModel.start(contentType, contentId)
    }

    LaunchedEffect(state.playbackUrl) {
        state.playbackUrl?.let { url ->
            // The token URL is opaque (no reliable extension for progressive
            // MKV/MP4/AVI VOD) — trust the server-provided container hint so
            // Media3 picks the right extractor instead of inferring HLS from
            // a stale .m3u8 suffix and failing with PARSING_CONTAINER_UNSUPPORTED.
            player.setMediaItem(
                MediaItem.Builder().setUri(url)
                    .apply { state.playbackMimeType?.let { setMimeType(it) } }
                    .build()
            )
            player.prepare()
            if (state.resumePositionMs > 0L) player.seekTo(state.resumePositionMs)
            player.playWhenReady = true
        }
    }

    LaunchedEffect(state.playbackUrl, state.resumePositionMs) {
        if (state.playbackUrl != null && state.resumePositionMs > 0L && player.currentPosition < 1_000L) {
            player.seekTo(state.resumePositionMs)
        }
    }

    DisposableEffect(player) {
        onDispose {
            viewModel.saveCurrentProgress()
            player.release()
        }
    }

    // Playback speed chip — cycles 0.75× → 1× → 1.25× → 1.5× → 2×.
    // Starts at 1× per screen instance; the chosen speed stays on the player
    // for the next episode/movie opened within the same session.
    var playbackSpeed by remember { mutableFloatStateOf(1.0f) }
    LaunchedEffect(playbackSpeed) {
        player.setPlaybackSpeed(playbackSpeed)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = {
                PlayerView(context).apply {
                    this.player = player
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
                    useController = true
                }
            },
            update = { it.player = player },
        )

        // Speed chip (top corner). Tap/OK cycles the speed; the label always
        // shows the currently active value. Semi-transparent so it never
        // blocks the picture, small so it never blocks the controller.
        Surface(
            onClick = { playbackSpeed = nextPlaybackSpeed(playbackSpeed) },
            shape = RoundedCornerShape(50),
            color = Color.Black.copy(alpha = 0.55f),
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(12.dp)
        ) {
            Text(
                text = speedLabel(playbackSpeed),
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                color = Color.White,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold
            )
        }

        if (state.isLoading || state.isRefreshing) {
            CircularProgressIndicator(
                modifier = Modifier.align(Alignment.Center),
                color = MaterialTheme.colorScheme.primary,
            )
        }

        state.error?.let { error ->
            Column(
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(text = title, style = MaterialTheme.typography.titleLarge, color = Color.White)
                Text(text = error, color = Color.White)
                Button(onClick = viewModel::retry) {
                    Text("إعادة المحاولة")
                }
            }
        }
    }
}
