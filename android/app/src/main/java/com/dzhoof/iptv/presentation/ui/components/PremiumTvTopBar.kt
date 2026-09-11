package com.dzhoof.iptv.presentation.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.R
import com.dzhoof.iptv.presentation.navigation.Screen
import com.dzhoof.iptv.presentation.ui.theme.Atlas900
import com.dzhoof.iptv.presentation.ui.theme.DzGold400
import com.dzhoof.iptv.presentation.ui.theme.DzGold500
import com.dzhoof.iptv.presentation.ui.theme.FocusBorder
import com.dzhoof.iptv.presentation.ui.theme.TextSecondaryDark

private data class TvTopBarItem(
    val label: String,
    val route: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

private val tvTopBarItems = listOf(
    TvTopBarItem("الرئيسية", Screen.Home.route, Icons.Filled.Home),
    TvTopBarItem("مباشر", Screen.Channels.route, Icons.Filled.Tv),
    TvTopBarItem("أفلام", Screen.Catalog.createRoute("movies"), Icons.Filled.Movie),
    TvTopBarItem("مسلسلات", Screen.Catalog.createRoute("series"), Icons.Filled.Movie),
    TvTopBarItem("المفضلة", Screen.Favorites.route, Icons.Filled.Favorite),
    TvTopBarItem("الدليل", Screen.Guide.route, Icons.Filled.Tv),
    TvTopBarItem("بحث", Screen.Search.route, Icons.Filled.Search),
    TvTopBarItem("الإعدادات", Screen.Settings.route, Icons.Filled.Settings),
)

@Composable
fun PremiumTvTopBar(
    currentRoute: String?,
    currentCatalogTab: String?,
    onRouteSelected: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(76.dp)
            .background(Atlas900.copy(alpha = 0.94f))
            .padding(horizontal = 28.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Image(
            painter = painterResource(R.drawable.ic_dzhoof_logo),
            contentDescription = "DZ HOOF",
            modifier = Modifier
                .size(52.dp)
                .clip(RoundedCornerShape(14.dp))
        )
        Spacer(modifier = Modifier.width(8.dp))
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            tvTopBarItems.forEach { item ->
                TvTopBarButton(
                    item = item,
                    selected = isTvTopBarRouteSelected(currentRoute, currentCatalogTab, item.route),
                    onClick = { onRouteSelected(item.route) }
                )
            }
        }
    }
}

private fun isTvTopBarRouteSelected(
    currentRoute: String?,
    currentCatalogTab: String?,
    route: String
): Boolean {
    val current = currentRoute.orEmpty()
    return when {
        route.startsWith("catalog?") -> {
            current.startsWith("catalog") && route.substringAfter("tab=") == currentCatalogTab
        }
        route == Screen.Channels.route -> current == Screen.Channels.route || current.startsWith("channels/category")
        else -> current == route
    }
}

@Composable
private fun TvTopBarButton(
    item: TvTopBarItem,
    selected: Boolean,
    onClick: () -> Unit
) {
    var focused by remember { mutableStateOf(false) }
    val active = selected || focused

    Card(
        onClick = onClick,
        modifier = Modifier
            .height(52.dp)
            .tvFocusVisuals(focused = focused, shape = RoundedCornerShape(14.dp))
            .onFocusChanged { focused = it.isFocused },
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(
            width = if (active) 1.5.dp else 1.dp,
            color = if (active) FocusBorder.copy(alpha = if (focused) 1f else 0.72f)
            else Color.White.copy(alpha = 0.08f)
        ),
        colors = CardDefaults.cardColors(
            containerColor = when {
                focused -> DzGold500.copy(alpha = 0.40f)
                selected -> DzGold500.copy(alpha = 0.20f)
                else -> Color.Transparent
            }
        )
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = item.icon,
                contentDescription = null,
                modifier = Modifier.size(22.dp),
                tint = if (active) DzGold400 else TextSecondaryDark
            )
            Text(
                text = item.label,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                color = if (active) Color.White else TextSecondaryDark,
                maxLines = 1
            )
        }
    }
}
