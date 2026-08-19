package com.dzhoof.iptv.presentation.navigation

import java.net.URLDecoder
import java.net.URLEncoder

/**
 * Sealed class representing all navigation destinations in the app.
 */
sealed class Screen(val route: String) {
    object Pairing : Screen("pairing")
    object Home : Screen("home")
    object Channels : Screen("channels")
    object Categories : Screen("categories")
    object Catalog : Screen("catalog")
    object MovieDetails : Screen("movie_details/{movieId}") {
        fun createRoute(movieId: String): String = "movie_details/${URLEncoder.encode(movieId, "UTF-8")}"
    }
    object SeriesDetails : Screen("series_details/{seriesId}") {
        fun createRoute(seriesId: String): String = "series_details/${URLEncoder.encode(seriesId, "UTF-8")}"
    }
    object Guide : Screen("guide")
    object Multiview : Screen("multiview?channelId={channelId}") {
        fun createRoute(channelId: String? = null) =
            if (channelId.isNullOrBlank()) "multiview" else "multiview?channelId=$channelId"
    }
    object Search : Screen("search")
    object Favorites : Screen("favorites")
    object Settings : Screen("settings")
    object AddSource : Screen("add_source")
    object VodPlayer : Screen("vod_player/{contentType}/{contentId}?title={title}") {
        fun createRoute(contentType: String, contentId: String, title: String): String =
            "vod_player/${URLEncoder.encode(contentType, "UTF-8")}/${URLEncoder.encode(contentId, "UTF-8")}?title=${URLEncoder.encode(title, "UTF-8")}"
    }
    object Player : Screen("player/{channelId}?catchupStart={catchupStart}&catchupDur={catchupDur}") {
        fun createRoute(channelId: String) = "player/$channelId"

        /** Catch-up playback of a past program (Xtream timeshift). */
        fun createCatchupRoute(channelId: String, startMillis: Long, durationMinutes: Int) =
            "player/$channelId?catchupStart=$startMillis&catchupDur=$durationMinutes"
    }
    object ChannelsByCategory : Screen("channels/category/{categoryId}") {
        fun createRoute(categoryId: String): String {
            // Blank category would produce "channels/category/" which matches
            // no destination and crashes NavController — fall back to all channels
            if (categoryId.isBlank()) return Channels.route
            val encoded = URLEncoder.encode(categoryId, "UTF-8")
            return "channels/category/$encoded"
        }
        fun decodeCategory(raw: String): String =
            URLDecoder.decode(raw, "UTF-8")
    }

    companion object {
        /** Route strings for top-level screens that show the sidebar navigation rail. */
        val sidebarRoutes = setOf("home", "channels", "categories", "catalog", "guide", "search", "favorites", "settings", "channels/category/{categoryId}")

        /** Routes where the mobile Search FAB is offered (excludes Search itself + Settings). */
        val searchableRoutes = setOf("home", "channels", "categories", "guide", "favorites", "channels/category/{categoryId}")
    }
}
