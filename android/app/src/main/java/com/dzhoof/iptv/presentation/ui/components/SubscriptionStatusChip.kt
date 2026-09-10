package com.dzhoof.iptv.presentation.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CardMembership
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.presentation.ui.theme.AccentGold
import com.dzhoof.iptv.presentation.ui.theme.ShapePill
import java.time.LocalDate

/** Formats and classifies the subscription end date for the status chip. */
object SubscriptionStatus {
    /** [expiresAt] comes from the API as an ISO-8601 timestamp. */
    fun isExpired(expiresAt: String?, today: LocalDate = LocalDate.now()): Boolean {
        val date = expiresAt?.take(10) ?: return false
        return runCatching { LocalDate.parse(date) }.getOrNull()?.isBefore(today) == true
    }

    fun dateLabel(expiresAt: String?): String? = expiresAt?.take(10)?.takeIf { it.isNotBlank() }
}

/**
 * The subscription status chip shown on Home — mirrors the "playlist expires"
 * badge viewers expect on an IPTV box, so a customer can see how long is left
 * without digging into settings.
 *
 * Renders nothing when the account has no subscription (for example a device
 * that is paired but not yet activated), so it never shows an empty badge.
 */
@Composable
fun SubscriptionStatusChip(
    expiresAt: String?,
    modifier: Modifier = Modifier
) {
    val label = SubscriptionStatus.dateLabel(expiresAt) ?: return
    val expired = SubscriptionStatus.isExpired(expiresAt)

    val accent = if (expired) MaterialTheme.colorScheme.error else AccentGold
    Row(
        modifier = modifier
            .clip(ShapePill)
            .background(accent.copy(alpha = 0.12f))
            .border(BorderStroke(1.dp, accent.copy(alpha = 0.55f)), ShapePill)
            .padding(horizontal = Dimens.Space3, vertical = Dimens.Space1),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Dimens.Space2)
    ) {
        Icon(
            imageVector = Icons.Filled.CardMembership,
            contentDescription = null,
            tint = accent,
            modifier = Modifier.size(Dimens.Space4)
        )
        Text(
            text = if (expired) "انتهى الاشتراك ($label)" else "الاشتراك ينتهي: $label",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = if (expired) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
        )
    }
}
