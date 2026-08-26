package com.dzhoof.iptv

import android.app.PictureInPictureParams
import android.content.SharedPreferences
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.animation.Crossfade
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.clickable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.dzhoof.iptv.data.AppPreferences
import com.dzhoof.iptv.domain.repository.UserPreferencesRepository
import com.dzhoof.iptv.drm.AmazonDrmManager
import com.dzhoof.iptv.domain.service.ChannelHealthScanner
import com.dzhoof.iptv.presentation.navigation.DzhoofNavGraph
import com.dzhoof.iptv.presentation.navigation.Screen
import com.dzhoof.iptv.presentation.ui.LocalPerfProfile
import com.dzhoof.iptv.presentation.ui.animation.DURATION_ENTRANCE
import com.dzhoof.iptv.presentation.ui.animation.EaseOutQuart
import com.dzhoof.iptv.presentation.ui.detectPerfProfile
import com.dzhoof.iptv.presentation.ui.components.OverlayToast
import com.dzhoof.iptv.presentation.ui.components.SideNavRail
import com.dzhoof.iptv.presentation.ui.player.isMobileDevice
import com.dzhoof.iptv.presentation.ui.player.isTvDevice
import com.dzhoof.iptv.presentation.ui.screens.SplashScreen
import com.dzhoof.iptv.presentation.ui.screens.UpdateAvailableScreen
import com.dzhoof.iptv.presentation.viewmodel.AppUpdateViewModel
import com.dzhoof.iptv.presentation.ui.theme.DiagonalGradientBackground
import com.dzhoof.iptv.presentation.ui.theme.DzHoofTheme
import com.google.firebase.FirebaseApp
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.delay
import javax.inject.Inject

private const val EXIT_CONFIRM_WINDOW_MS = 2000L

/**
 * Main entry point for the DZ HOOF IPTV app.
 *
 * Hosts the Compose navigation graph with orientation-adaptive navigation:
 * landscape uses a left rail sidebar, portrait uses a bottom navigation bar.
 * On first launch (no TV code), the Pairing screen is shown instead.
 */
@AndroidEntryPoint
class ComposeMainActivity : ComponentActivity() {

    @Inject
    lateinit var channelHealthScanner: ChannelHealthScanner

    @Inject
    lateinit var userPreferencesRepository: UserPreferencesRepository

    companion object {
        private const val PREFS_NAME = AppPreferences.PREFS_NAME
        @Volatile
        var isPlayerActive = false
        @Volatile
        var isPlayerPlaying = false

        /** Observable from Compose: the player renders video-only while in PiP. */
        val isInPipMode = mutableStateOf(false)
    }

    /** PiP params + RemoteAction wiring; PlayerScreen attaches while composed. */
    val pipController: PipController by lazy { PipController(this) }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        isInPipMode.value = isInPictureInPictureMode
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (isMobileDevice(this)) {
            enableEdgeToEdge()
        }
        if (BuildConfig.FIREBASE_ENABLED) {
            runCatching { FirebaseApp.initializeApp(this) }
        }

        // Non-blocking DRM check — log result for Amazon Appstore compliance
        AmazonDrmManager(this).verifyLicense { licensed ->
            if (!licensed) {
                android.util.Log.w("DzHoof", "DRM: App not licensed (non-blocking)")
            }
        }

        val needsPairing = !isTvCodeConfigured()
        if (isFirstLaunch()) {
            markFirstLaunchComplete()
        }

        // Start background channel health scanning
        if (!needsPairing) {
            channelHealthScanner.startAutoScan()
        }

        // Parse deep link channel ID if present
        val deepLinkChannelId = intent?.data?.let { uri ->
            if (uri.host == "play" && uri.pathSegments.size >= 2 && uri.pathSegments[0] in listOf("movie", "channel")) {
                val rawId = uri.pathSegments[1]
                // Validate channelId: alphanumeric, hyphens, underscores only, max 64 chars
                if (rawId.length <= 64 && rawId.matches(Regex("^[a-zA-Z0-9_-]+$"))) rawId else null
            } else null
        }

        val targetChannelId = deepLinkChannelId
        val showSplashOnStart = savedInstanceState == null

        setContent {
            val themeStr by userPreferencesRepository.getTheme().collectAsState(initial = "system")
            // TV is dark-first: 10-foot UI reads better dark and matches the solid-dark nav rail
            val darkTheme = when (themeStr) {
                "light" -> false
                "system" -> if (remember { isTvDevice(this) }) true else isSystemInDarkTheme()
                else -> true
            }
            val perfProfile = remember { detectPerfProfile(this) }
            CompositionLocalProvider(LocalPerfProfile provides perfProfile) {
                DzHoofTheme(darkTheme = darkTheme) {
                    var showSplash by rememberSaveable { mutableStateOf(showSplashOnStart) }
                    val navController = rememberNavController()
                    val startDestination = if (needsPairing) Screen.Pairing.route else Screen.Home.route

                    // Confirm-exit guard at the app root (TiviMate-style): with the
                    // setting on, the first BACK on Home arms a toast; a second press
                    // within the window falls through to the default and exits.
                    val confirmAppExit by userPreferencesRepository.getBackExitProtection()
                        .collectAsState(initial = true)
                    val currentBackStackEntry by navController.currentBackStackEntryAsState()
                    var exitArmed by remember { mutableStateOf(false) }
                    BackHandler(
                        enabled = confirmAppExit && !exitArmed &&
                            currentBackStackEntry?.destination?.route == Screen.Home.route
                    ) { exitArmed = true }
                    LaunchedEffect(exitArmed) {
                        if (exitArmed) {
                            delay(EXIT_CONFIRM_WINDOW_MS)
                            exitArmed = false
                        }
                    }

                    Box(modifier = Modifier.fillMaxSize()) {
                        DzhoofAppShell(
                            navController = navController,
                            startDestination = startDestination
                        )

                        if (exitArmed) {
                            OverlayToast(
                                text = "اضغط رجوع مرة أخرى للخروج",
                                modifier = Modifier
                                    .align(Alignment.BottomCenter)
                                    .padding(bottom = 48.dp)
                            )
                        }

                        // Deep link navigation (once only, after splash)
                        if (!showSplash && targetChannelId != null && savedInstanceState == null && !needsPairing) {
                            LaunchedEffect(targetChannelId) {
                                navController.navigate(Screen.Player.createRoute(targetChannelId))
                            }
                        }

                        // Update-available overlay — checks once after splash on a
                        // configured device; shows full-screen over the app when a
                        // newer version is published. Session-only dismiss.
                        if (!needsPairing) {
                            val updateViewModel: AppUpdateViewModel = hiltViewModel()
                            val updateState by updateViewModel.uiState.collectAsState()

                            LaunchedEffect(showSplash) {
                                if (!showSplash) updateViewModel.checkForUpdate()
                            }

                            val update = updateState.updateInfo
                            if (!showSplash && update != null && !updateState.dismissed) {
                                BackHandler(enabled = !updateState.isDownloading) {
                                    updateViewModel.dismiss()
                                }
                                UpdateAvailableScreen(
                                    updateInfo = update,
                                    isDownloading = updateState.isDownloading,
                                    downloadError = updateState.downloadError,
                                    onUpdateNow = { updateViewModel.downloadAndInstallUpdate() },
                                    onDismiss = { updateViewModel.dismiss() }
                                )
                            }
                        }

                        // Splash overlay
                        if (showSplash) {
                            SplashScreen(onSplashFinished = { showSplash = false })
                        }
                    }
                }
            }
        }
    }

    private fun isTvCodeConfigured(): Boolean {
        // A paired code OR a bring-your-own playlist (M3U/Xtream) counts as configured.
        return AppPreferences.hasAnySource(this)
    }

    private fun isFirstLaunch(): Boolean {
        val prefs: SharedPreferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        return !prefs.getBoolean("has_launched_before", false)
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // API 31+ auto-enters via setAutoEnterEnabled (PipController) — entering
        // here as well would double-trigger on some paths.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S &&
            isPlayerActive && isPlayerPlaying && isMobileDevice(this)
        ) {
            val params = PictureInPictureParams.Builder()
                .setAspectRatio(Rational(16, 9))
                .build()
            enterPictureInPictureMode(params)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        pipController.detach()
        channelHealthScanner.destroy()
    }

    private fun markFirstLaunchComplete() {
        val prefs: SharedPreferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        prefs.edit().putBoolean("has_launched_before", true).apply()
    }
}

/**
 * App shell composable that combines the navigation chrome with the NavHost.
 *
 * In landscape (TV/tablet): left rail sidebar with SideNavRail.
 * In portrait (phone): bottom navigation bar.
 *
 * Navigation chrome is only visible on top-level screens (Home, Channels, Search,
 * Favorites, Settings). It is hidden during Pairing and Player screens.
 */
@Composable
private fun DzhoofAppShell(
    navController: NavHostController,
    startDestination: String
) {
    val currentBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = currentBackStackEntry?.destination?.route

    val showNav = currentRoute in Screen.sidebarRoutes
    val isPortrait = LocalConfiguration.current.orientation == Configuration.ORIENTATION_PORTRAIT
    val context = LocalContext.current
    val isMobile = remember { isMobileDevice(context) }

    val onNavigate: (Screen) -> Unit = { screen ->
        navController.navigate(screen.route) {
            popUpTo(Screen.Home.route) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }

    // Single DzhoofNavGraph call site: an if/else per orientation would give
    // the NavHost two composition identities, so rotating disposes every screen
    // (the player loses its ExoPlayer and orientation request mid-rotation).
    DiagonalGradientBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(
                    if (isPortrait) WindowInsets.statusBars else WindowInsets.safeDrawing
                )
        ) {
            Row(modifier = Modifier.weight(1f)) {
                if (!isPortrait && showNav) {
                    SideNavRail(
                        currentRoute = currentRoute,
                        onScreenSelected = onNavigate,
                        compact = isMobile
                    )
                }
                Box(modifier = Modifier.weight(1f)) {
                    DzhoofNavGraph(
                        navController = navController,
                        startDestination = startDestination,
                        modifier = Modifier.fillMaxSize()
                    )
                    // Thumb-reachable Search on mobile across the browse screens
                    if (isPortrait && isMobile && currentRoute in Screen.searchableRoutes) {
                        FloatingActionButton(
                            onClick = {
                                navController.navigate(Screen.Search.route) { launchSingleTop = true }
                            },
                            modifier = Modifier
                                .align(Alignment.BottomEnd)
                                .padding(16.dp),
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary
                        ) {
                            Icon(Icons.Default.Search, contentDescription = "بحث")
                        }
                    }
                }
            }
            if (isPortrait && showNav) {
                BottomNavBar(
                    currentRoute = currentRoute,
                    onScreenSelected = onNavigate,
                    modifier = Modifier.windowInsetsPadding(WindowInsets.navigationBars)
                )
            }
        }
    }
}

private val tvBottomNavItems = listOf(
    Triple(Screen.Home, Icons.Default.Home, "الرئيسية"),
    Triple(Screen.Favorites, Icons.Default.Favorite, "المفضلة"),
    Triple(Screen.Categories, Icons.Default.Category, "التصنيفات"),
    Triple(Screen.Catalog, Icons.Default.Movie, "فيديو"),
    Triple(Screen.Settings, Icons.Default.Settings, "الإعدادات"),
)

/**
 * Phone navigation intentionally stays focused on five high-frequency actions.
 * Search is a first-class destination rather than a floating-only shortcut;
 * Guide and VOD remain reachable from the catalog/categories flows.
 */
private val phoneBottomNavItems = listOf(
    Triple(Screen.Home, Icons.Default.Home, "الرئيسية"),
    Triple(Screen.Search, Icons.Default.Search, "بحث"),
    Triple(Screen.Favorites, Icons.Default.Favorite, "المفضلة"),
    Triple(Screen.Categories, Icons.Default.Category, "التصنيفات"),
    Triple(Screen.Settings, Icons.Default.Settings, "الإعدادات"),
)

@Composable
private fun BottomNavBar(
    currentRoute: String?,
    onScreenSelected: (Screen) -> Unit,
    modifier: Modifier = Modifier
) {
    val screenWidthDp = LocalConfiguration.current.screenWidthDp
    val isPhone = screenWidthDp < 600
    val barHeight = if (isPhone) 74.dp else 64.dp
    val iconSize = if (isPhone) 24.dp else 22.dp
    val labelSize = if (isPhone) 11.sp else 10.sp
    val accent = MaterialTheme.colorScheme.primary
    val items = if (isPhone) phoneBottomNavItems else tvBottomNavItems

    // شريط سفلي عائم حديث — حاوية دائرية مرتفعة مع مؤشر "حبة" للأيقونة النشطة
    Surface(
        shape = RoundedCornerShape(26.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.97f),
        tonalElevation = 0.dp,
        shadowElevation = 16.dp,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
        modifier = modifier
            .fillMaxWidth(0.95f)
            .height(barHeight)
            .padding(horizontal = 10.dp, vertical = 7.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxSize(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            items.forEach { (screen, icon, label) ->
                val isSelected = currentRoute == screen.route ||
                    (screen == Screen.Channels && currentRoute == Screen.ChannelsByCategory.route)
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier
                        .clip(RoundedCornerShape(18.dp))
                        .background(
                            if (isSelected) accent.copy(alpha = 0.16f)
                            else Color.Transparent
                        )
                        .clickable { onScreenSelected(screen) }
                        .padding(horizontal = 12.dp, vertical = 5.dp)
                ) {
                    Icon(
                        imageVector = icon,
                        contentDescription = label,
                        tint = if (isSelected) accent else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(iconSize)
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = label,
                        maxLines = 1,
                        fontSize = labelSize,
                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (isSelected) accent else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}
