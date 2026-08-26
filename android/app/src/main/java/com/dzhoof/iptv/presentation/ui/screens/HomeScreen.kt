package com.dzhoof.iptv.presentation.ui.screens

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dzhoof.iptv.data.AppPreferences
import com.dzhoof.iptv.presentation.ui.animation.DURATION_NORMAL
import com.dzhoof.iptv.presentation.ui.animation.EaseOutQuart
import com.dzhoof.iptv.presentation.ui.components.EmptyPlaylistState
import com.dzhoof.iptv.presentation.ui.components.ErrorState
import com.dzhoof.iptv.presentation.ui.player.isMobileDevice
import com.dzhoof.iptv.presentation.ui.screens.home.HomeContent
import com.dzhoof.iptv.presentation.ui.screens.home.HomeSkeleton
import com.dzhoof.iptv.presentation.viewmodel.ChannelsViewModel

@Composable
fun HomeScreen(
    onNavigateToChannels: (String) -> Unit,
    onNavigateToSearch: () -> Unit,
    onNavigateToFavorites: () -> Unit,
    onNavigateToGuide: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onChannelClick: (String) -> Unit,
    onPairDevice: () -> Unit = {},
    onMultiviewClick: (String) -> Unit = {},
    modifier: Modifier = Modifier,
    viewModel: ChannelsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val isDemo = remember { AppPreferences.isDemoMode(context) }

    // Refresh on app resume (detect server-side changes)
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                viewModel.onResume()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // Record which channel is opened so focus can be restored on return from the player
    val openChannel = remember(viewModel, onChannelClick) {
        { channelId: String ->
            viewModel.onChannelOpened(channelId)
            onChannelClick(channelId)
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        val contentState = when {
            uiState.isLoading && uiState.channels.isEmpty() -> "loading"
            uiState.error != null && uiState.channels.isEmpty() -> "error"
            uiState.channels.isEmpty() && !uiState.isInitialLoadComplete -> "loading"
            uiState.channels.isEmpty() -> "empty"
            else -> "content"
        }

        Crossfade(
            targetState = contentState,
            animationSpec = tween(DURATION_NORMAL, easing = EaseOutQuart),
            label = "homeState"
        ) { state ->
            when (state) {
                "loading" -> HomeSkeleton()
                "error" -> ErrorState(
                    message = uiState.error ?: "حدث خطأ غير متوقع",
                    onRetry = { viewModel.refresh() },
                    errorType = uiState.errorType,
                    onPairDevice = onPairDevice
                )
                "empty" -> {
                    val ctx = LocalContext.current
                    EmptyPlaylistState(
                        qrCodeBitmap = uiState.guideQrBitmap,
                        onRetry = { viewModel.refresh() },
                        isMobile = isMobileDevice(ctx),
                        channelManagerUrl = AppPreferences.getServerUrl(ctx) + "/user/channels"
                    )
                }
                else -> HomeContent(
                    channels = uiState.channels,
                    featuredChannels = uiState.featuredChannels,
                    recentlyWatched = uiState.recentlyWatched,
                    forYou = uiState.forYou,
                    popularCategories = uiState.popularCategories,
                    lastPlayedChannelId = uiState.lastPlayedChannelId,
                    onChannelClick = openChannel,
                    onNavigateToChannels = onNavigateToChannels,
                    onNavigateToSearch = onNavigateToSearch,
                    onNavigateToGuide = onNavigateToGuide,
                    onNavigateToFavorites = onNavigateToFavorites,
                    onToggleFavorite = viewModel::toggleFavorite,
                    onMultiviewClick = onMultiviewClick,
                    isDemo = isDemo
                )
            }
        }
    }
}
