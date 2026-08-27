package com.dzhoof.iptv.presentation.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import com.dzhoof.iptv.R
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dzhoof.iptv.presentation.ui.animation.DURATION_FAST
import com.dzhoof.iptv.presentation.ui.animation.DURATION_NORMAL
import com.dzhoof.iptv.presentation.ui.animation.EaseOutQuart
import com.dzhoof.iptv.presentation.ui.components.AppTextField
import com.dzhoof.iptv.presentation.ui.components.ScreenScaffold
import com.dzhoof.iptv.presentation.ui.components.VoiceSearchButton
import com.dzhoof.iptv.presentation.ui.player.isMobileDevice
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.presentation.ui.theme.DzGreen300
import com.dzhoof.iptv.presentation.viewmodel.SearchViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(
    onNavigateBack: () -> Unit,
    onChannelClick: (String) -> Unit,
    onMultiviewClick: (String) -> Unit = {},
    onMovieClick: (String) -> Unit = {},
    onSeriesClick: (String) -> Unit = {},
    onProgramClick: (String) -> Unit = {},
    modifier: Modifier = Modifier,
    viewModel: SearchViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    var searchQuery by rememberSaveable { mutableStateOf("") }
    var voiceStatus by remember { mutableStateOf<String?>(null) }
    val focusRequester = remember { FocusRequester() }
    val firstKeyFocus = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    val isMobile = isMobileDevice(LocalContext.current)
    // Match ScreenHeader's internal compact branch so header and content share
    // the same horizontal inset on landscape phones (width ≥ 600dp).
    val isCompact = LocalConfiguration.current.screenWidthDp < 600

    // Mobile keeps the real field + system keyboard; TV lands on the on-screen
    // keyboard's first key so the D-pad can drive input with no IME.
    LaunchedEffect(Unit) {
        if (isMobile) focusRequester.requestFocus() else firstKeyFocus.requestFocus()
    }

    // Shared input helpers — every path drives the same debounced search.
    val setQuery: (String) -> Unit = { q ->
        searchQuery = q
        viewModel.onQueryChange(q)
    }

    if (isMobile) {
        Column(
            modifier = modifier
                .fillMaxSize()
                .padding(
                    start = if (isCompact) Dimens.ScreenPaddingHorizontalMobile else Dimens.ScreenPaddingHorizontalTv,
                    end = if (isCompact) Dimens.ScreenPaddingHorizontalMobile else Dimens.ScreenPaddingHorizontalTv,
                    top = 16.dp
                )
        ) {
            Client2MobileSearchHeading()
            Spacer(modifier = Modifier.height(16.dp))
            Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Dimens.Space3)
                ) {
                    AppTextField(
                        value = searchQuery,
                        onValueChange = { setQuery(it) },
                        placeholder = stringResource(R.string.search_channels_content),
                        dpadEditToggle = false,
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.Search,
                                contentDescription = stringResource(R.string.search),
                                tint = if (searchQuery.isNotEmpty()) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(Dimens.IconMedium)
                            )
                        },
                        trailingIcon = {
                            AnimatedVisibility(
                                visible = searchQuery.isNotEmpty(),
                                enter = fadeIn(tween(DURATION_NORMAL, easing = EaseOutQuart)),
                                exit = fadeOut(tween(DURATION_FAST, easing = EaseOutQuart))
                            ) {
                                IconButton(onClick = { setQuery("") }) {
                                    Icon(
                                        imageVector = Icons.Default.Clear,
                                        contentDescription = stringResource(R.string.dismiss_error),
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        },
                        modifier = Modifier
                            .weight(1f)
                            .focusRequester(focusRequester)
                            .onFocusChanged { if (it.hasFocus) keyboardController?.show() }
                    )

                    VoiceSearchButton(
                        onResult = { text -> setQuery(text) },
                        onStatusChange = { voiceStatus = it }
                    )
                }

                voiceStatus?.let { status ->
                    Text(
                        text = status,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier.padding(top = Dimens.Space2)
                    )
                }

                Spacer(modifier = Modifier.height(Dimens.Space5))

            SearchResultsArea(
                uiState = uiState,
                searchQuery = searchQuery,
                isMobile = true,
                onChannelClick = onChannelClick,
                onFavoriteClick = { viewModel.toggleFavorite(it) },
                onMultiviewClick = onMultiviewClick,
                onMovieClick = onMovieClick,
                onSeriesClick = onSeriesClick,
                onProgramClick = onProgramClick,
                onRetry = { viewModel.onQueryChange(searchQuery) },
                onRecentSearchClick = { setQuery(it) },
                onClearHistory = { viewModel.clearHistory() },
                keyboardController = keyboardController,
                modifier = Modifier.fillMaxWidth()
            )
        }
    } else {
        Column(
            modifier = modifier
                .fillMaxSize()
                .padding(
                    horizontal = Dimens.ScreenPaddingHorizontalTv,
                    vertical = Dimens.ScreenPaddingVertical
                )
        ) {
            TvSearchContent(
                query = searchQuery,
                uiState = uiState,
                voiceStatus = voiceStatus,
                onKey = { char -> setQuery(searchQuery + char) },
                onBackspace = { if (searchQuery.isNotEmpty()) setQuery(searchQuery.dropLast(1)) },
                onSpace = { setQuery(searchQuery + ' ') },
                onClear = { setQuery("") },
                onVoiceResult = { text -> setQuery(text) },
                onVoiceStatusChange = { voiceStatus = it },
                onChannelClick = onChannelClick,
                onFavoriteClick = { viewModel.toggleFavorite(it) },
                onMultiviewClick = onMultiviewClick,
                onMovieClick = onMovieClick,
                onSeriesClick = onSeriesClick,
                onProgramClick = onProgramClick,
                onRetry = { viewModel.onQueryChange(searchQuery) },
                onRecentSearchClick = { setQuery(it) },
                onClearHistory = { viewModel.clearHistory() },
                firstKeyFocus = firstKeyFocus
            )
        }
    }
}

@Composable
private fun Client2MobileSearchHeading(modifier: Modifier = Modifier) {
    Surface(
        shape = CutCornerShape(topStart = 16.dp, topEnd = 4.dp, bottomEnd = 16.dp, bottomStart = 4.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, DzGreen300.copy(alpha = 0.34f)),
        modifier = modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 13.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .background(DzGreen300)
                )
                Spacer(modifier = Modifier.size(8.dp))
                Text(
                    text = "DZ HOOF / SEARCH",
                    style = MaterialTheme.typography.labelLarge,
                    color = DzGreen300,
                    fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold
                )
            }
            Spacer(modifier = Modifier.height(5.dp))
            Text(
                text = "ابحث في البث والمكتبة",
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold
            )
        }
    }
}
