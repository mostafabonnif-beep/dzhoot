package com.dzhoof.iptv.presentation.ui.screens

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.PlayCircleOutline
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.ui.theme.DzGreen300
import com.dzhoof.iptv.presentation.ui.theme.DzRed400
import com.dzhoof.iptv.presentation.ui.theme.categoryColor
import com.dzhoof.iptv.presentation.ui.theme.categoryIcon

/** A category ready for the touch-first Client 2.0 mobile browser. */
internal data class Client2MobileCategory(
    val sourceName: String,
    val displayName: String,
    val channelCount: Int,
    val isFavorite: Boolean
)

/**
 * Mobile-only category browser. It deliberately avoids image-heavy grid cards:
 * provider thumbnails are inconsistent, and the previous two-column card mixed
 * the category title, count and icon in a very small area. Each item here has a
 * stable reading order: category, usable channel count, action, then favourite.
 */
@Composable
internal fun Client2MobileCategories(
    categories: List<Client2MobileCategory>,
    totalChannelCount: Int,
    onCategoryClick: (String) -> Unit,
    onToggleFavorite: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var query by rememberSaveable { mutableStateOf("") }
    val visibleCategories = remember(categories, query) {
        val normalizedQuery = query.trim()
        if (normalizedQuery.isBlank()) categories
        else categories.filter { category ->
            category.displayName.contains(normalizedQuery, ignoreCase = true) ||
                category.sourceName.contains(normalizedQuery, ignoreCase = true)
        }
    }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item(key = "categories_mobile_intro") {
            MobileCategoriesIntro(
                categoryCount = categories.size,
                channelCount = totalChannelCount,
                modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 4.dp)
            )
        }

        item(key = "categories_mobile_search") {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                placeholder = { Text("ابحث في التصنيفات") },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Search,
                        contentDescription = null,
                        tint = DzGreen300
                    )
                },
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = MaterialTheme.colorScheme.surface,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                    focusedIndicatorColor = DzGreen300,
                    unfocusedIndicatorColor = MaterialTheme.colorScheme.outlineVariant
                ),
                shape = MaterialTheme.shapes.large,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 6.dp)
            )
        }

        if (visibleCategories.isEmpty()) {
            item(key = "categories_mobile_no_results") {
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    shape = MaterialTheme.shapes.large,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 8.dp)
                ) {
                    Text(
                        text = "لا توجد فئة تطابق «${query.trim()}»",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(18.dp)
                    )
                }
            }
        } else {
            items(visibleCategories, key = { it.sourceName }) { category ->
                MobileCategoryRow(
                    category = category,
                    onClick = { onCategoryClick(category.sourceName) },
                    onFavoriteClick = { onToggleFavorite(category.sourceName) },
                    modifier = Modifier.padding(horizontal = 20.dp)
                )
            }
        }

        item(key = "categories_mobile_bottom_space") {
            Spacer(modifier = Modifier.height(18.dp))
        }
    }
}

@Composable
private fun MobileCategoriesIntro(
    categoryCount: Int,
    channelCount: Int,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = "دليل القنوات",
            style = MaterialTheme.typography.labelLarge,
            color = DzGreen300,
            fontWeight = FontWeight.Bold
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = "اكتشف حسب اهتماماتك",
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onBackground,
            fontWeight = FontWeight.ExtraBold
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = "$categoryCount تصنيف · $channelCount قناة متاحة",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun MobileCategoryRow(
    category: Client2MobileCategory,
    onClick: () -> Unit,
    onFavoriteClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val tint = categoryColor(category.sourceName)

    Surface(
        onClick = onClick,
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.large,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.52f)),
        modifier = modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(94.dp)
                .background(
                    Brush.horizontalGradient(
                        colors = listOf(
                            MaterialTheme.colorScheme.surface,
                            tint.copy(alpha = 0.08f)
                        )
                    )
                )
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                color = tint.copy(alpha = 0.14f),
                shape = MaterialTheme.shapes.large,
                modifier = Modifier.size(62.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = categoryIcon(category.sourceName),
                        contentDescription = null,
                        tint = tint,
                        modifier = Modifier.size(31.dp)
                    )
                }
            }
            Spacer(modifier = Modifier.width(13.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = category.displayName,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.ExtraBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.height(5.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Outlined.PlayCircleOutline,
                        contentDescription = null,
                        tint = tint,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(5.dp))
                    Text(
                        text = categoryCountLabel(category.channelCount),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1
                    )
                }
            }
            IconButton(onClick = onFavoriteClick, modifier = Modifier.size(44.dp)) {
                Icon(
                    imageVector = if (category.isFavorite) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                    contentDescription = if (category.isFavorite) "إزالة ${category.displayName} من المفضلة" else "إضافة ${category.displayName} إلى المفضلة",
                    tint = if (category.isFavorite) DzRed400 else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(22.dp)
                )
            }
        }
    }
}

private fun categoryCountLabel(count: Int): String = when (count) {
    0 -> "لا توجد قنوات حالياً"
    1 -> "قناة واحدة"
    2 -> "قناتان"
    in 3..10 -> "$count قنوات"
    else -> "$count قناة"
}
