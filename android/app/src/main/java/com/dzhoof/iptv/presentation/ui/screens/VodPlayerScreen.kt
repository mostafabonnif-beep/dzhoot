package com.dzhoof.iptv.presentation.ui.screens

import androidx.activity.compose.BackHandler
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.compose.ui.viewinterop.AndroidView
import com.dzhoof.iptv.presentation.viewmodel.VodPlayerViewModel

@OptIn(UnstableApi::class)
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
