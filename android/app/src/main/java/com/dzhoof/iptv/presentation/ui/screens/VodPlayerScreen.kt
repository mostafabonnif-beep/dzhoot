package com.dzhoof.iptv.presentation.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
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
import com.dzhoof.iptv.presentation.ui.screens.player.ASPECT_MODES
import com.dzhoof.iptv.presentation.ui.screens.player.nextSleepTimerStep
import com.dzhoof.iptv.presentation.viewmodel.VodPlayerViewModel
import kotlinx.coroutines.delay

/**
 * Playback speeds offered by the VOD speed chip, in increasing order.
 * Full range 0.5×–2× — half speed is useful for re-watching action scenes
 * and for slow connections when the source only offers one bitrate.
 */
internal val VOD_SPEED_OPTIONS: List<Float> = listOf(0.5f, 0.75f, 1.0f, 1.25f, 1.5f, 2.0f)

/** Cycles to the next speed (wraps around); used by both the chip and unit tests. */
internal fun nextPlaybackSpeed(current: Float, options: List<Float> = VOD_SPEED_OPTIONS): Float {
    val index = options.indexOfFirst { kotlin.math.abs(it - current) < 0.001f }
    if (index < 0) return options.firstOrNull() ?: 1.0f
    return options[(index + 1) % options.size]
}

/** Next aspect/zoom preset index (Fit → Zoom → Fill → Fit …); used by the chip and tests. */
internal fun nextAspectIndex(current: Int, size: Int = ASPECT_MODES.size): Int =
    if (size <= 0) 0 else (current + 1).mod(size)

/** mm:ss countdown label for the armed sleep timer, e.g. 29:59, 0:42. */
internal fun sleepCountdownLabel(remainingSeconds: Int): String {
    val safe = remainingSeconds.coerceAtLeast(0)
    val seconds = (safe % 60).toString().padStart(2, '0')
    return "${safe / 60}:$seconds"
}

/**
 * Small round control chip used by the VOD player (sleep timer, aspect ratio,
 * playback speed). Tap/OK cycles the value; the label shows the current state.
 * Kept visually identical to the pre-existing speed chip.
 */
@Composable
private fun VodControlChip(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(50),
        color = Color.Black.copy(alpha = 0.55f),
        modifier = modifier
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
            color = Color.White,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold
        )
    }
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

    // Playback speed chip — cycles 0.5× → 0.75× → 1× → 1.25× → 1.5× → 2×.
    // Starts at 1× per screen instance; the chosen speed stays on the player
    // for the next episode/movie opened within the same session.
    var playbackSpeed by remember { mutableFloatStateOf(1.0f) }
    LaunchedEffect(playbackSpeed) {
        player.setPlaybackSpeed(playbackSpeed)
    }

    // Sleep timer (Off → 30 → 60 → 90 → 120 → Off — same preset steps as the
    // live player). When the countdown reaches zero, playback pauses and a
    // tap-to-resume grace window starts before the screen closes, matching the
    // live player's sleep-timer semantics.
    var sleepMinutes by remember { mutableStateOf<Int?>(null) }
    var sleepRemainingSeconds by remember { mutableIntStateOf(0) }
    var sleepExpired by remember { mutableStateOf(false) }

    LaunchedEffect(sleepMinutes) {
        if (sleepMinutes == null) {
            sleepRemainingSeconds = 0
        } else {
            sleepRemainingSeconds = sleepMinutes * 60
            while (sleepRemainingSeconds > 0) {
                delay(1_000)
                sleepRemainingSeconds -= 1
            }
            sleepExpired = true
            player.pause()
        }
    }

    // Grace window once the timer fires: leave the screen unless the user
    // taps the chip to resume first.
    LaunchedEffect(sleepExpired) {
        if (sleepExpired) {
            delay(10_000)
            if (sleepExpired) onNavigateBack()
        }
    }

    val cycleSleepTimer: () -> Unit = {
        if (sleepExpired) {
            // Resume instead of leaving: disarm and keep watching.
            player.play()
            sleepExpired = false
            sleepMinutes = null
        } else {
            sleepMinutes = nextSleepTimerStep(sleepMinutes)
        }
    }

    // Aspect/zoom preset (ملاءمة → تكبير → ملء الشاشة), applied to the view.
    var aspectIndex by remember { mutableIntStateOf(0) }

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
            update = { view ->
                view.player = player
                view.resizeMode = ASPECT_MODES[aspectIndex].first
            },
        )

        // Control chips (top corners). Tap/OK cycles the value; the label
        // always shows the current state. Semi-transparent so they never
        // block the picture, small so they never block the controller.
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(12.dp)
        ) {
            val sleepLabel = when {
                sleepExpired -> "انتهى النوم — للمتابعة اضغط"
                sleepMinutes != null -> "نوم ${sleepCountdownLabel(sleepRemainingSeconds)}"
                else -> "نوم: إيقاف"
            }
            VodControlChip(text = sleepLabel, onClick = cycleSleepTimer)
            VodControlChip(
                text = ASPECT_MODES[aspectIndex].second,
                onClick = { aspectIndex = nextAspectIndex(aspectIndex) }
            )
        }
        VodControlChip(
            text = speedLabel(playbackSpeed),
            onClick = { playbackSpeed = nextPlaybackSpeed(playbackSpeed) },
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(12.dp)
        )

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
