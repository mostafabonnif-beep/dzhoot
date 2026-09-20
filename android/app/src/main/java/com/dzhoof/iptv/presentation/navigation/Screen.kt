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
    object Catalog : Screen("catalog?tab={tab}") {
        fun createRoute(tab: String = "movies"): String = "catalog?tab=$tab"
    }
    object MovieDetails : Screen("movie_details/{movieId}") {
        fun createRoute(movieId: String): String = "movie_details/${URLEncoder.encode(movieId, "UTF-8")}"
    }
    object SeriesDetails : Screen("series_details/{seriesId}") {
        fun createRoute(seriesId: String): String = "series_details/${URLEncoder.encode(seriesId, "UTF-8")}"
    }
    object Guide : Screen("guide")
    object Multiview : Screen("multiview?channelId={channelId}") {
        // Channel ids for bring-your-own playlists are derived from the display
        // name, so they can contain '&', '#' or '/' — the query value must be
        // encoded or the route parses into the wrong destination/arguments.
        fun createRoute(channelId: String? = null) =
            if (channelId.isNullOrBlank()) "multiview"
            else "multiview?channelId=${URLEncoder.encode(channelId, "UTF-8")}"
    }
    object Search : Screen("search")
    object Favorites : Screen("favorites")
    object Settings : Screen("settings")

    /** «إبلاغ عن مشكلة» — the customer report form. */
    object ReportProblem : Screen("report_problem")
    object Diagnostics : Screen("diagnostics")
    object AddSource : Screen("add_source")
    object ManageChannels : Screen("manage_channels")
    object VodPlayer : Screen("vod_player/{contentType}/{contentId}?title={title}") {
        fun createRoute(contentType: String, contentId: String, title: String): String =
            "vod_player/${URLEncoder.encode(contentType, "UTF-8")}/${URLEncoder.encode(contentId, "UTF-8")}?title=${URLEncoder.encode(title, "UTF-8")}"
    }
    object Player : Screen("player/{channelId}?catchupStart={catchupStart}&catchupDur={catchupDur}") {
        // Encoded like the other id-carrying routes below: a channel id such as
        // "m3u-3-24/7 HD" (BYO playlists derive the id from the channel name when
        // there is no tvg-id) would otherwise add a path segment, match no
        // destination and throw from Navigation.
        fun createRoute(channelId: String) = "player/${URLEncoder.encode(channelId, "UTF-8")}"

        /** Catch-up playback of a past program (Xtream timeshift). */
        fun createCatchupRoute(channelId: String, startMillis: Long, durationMinutes: Int) =
            "player/${URLEncoder.encode(channelId, "UTF-8")}?catchupStart=$startMillis&catchupDur=$durationMinutes"
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
        val sidebarRoutes = setOf("home", "channels", "categories", Catalog.route, "guide", "search", "favorites", "settings", "channels/category/{categoryId}")

        /** Routes where the mobile Search FAB is offered (excludes Search itself + Settings). */
        val searchableRoutes = setOf("home", "channels", "categories", "guide", "favorites", "channels/category/{categoryId}")
    }
}
