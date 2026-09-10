package com.dzhoof.iptv.presentation.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.focusable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dzhoof.iptv.presentation.ui.theme.DzGreen400
import com.dzhoof.iptv.presentation.ui.theme.Dimens

/**
 * Row/section title with a brand-gradient accent pill (DzGreen → DzGold).
 * Title stays neutral ([MaterialTheme.colorScheme.onSurface]) so color carries
 * category identity without competing with content. "عرض الكل" is localized.
 */
@Composable
fun SectionHeader(
    title: String,
    accentColor: Color,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.titleLarge,
    onSeeAllClick: (() -> Unit)? = null
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .focusable(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            BrandAccentBar(accentColor = accentColor)
            Spacer(modifier = Modifier.width(Dimens.HeaderAccentBarGap))
            Text(
                text = title,
                style = style,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
        if (onSeeAllClick != null) {
            TextButton(onClick = onSeeAllClick) {
                Text(
                    text = "عرض الكل",
                    style = MaterialTheme.typography.labelMedium.copy(
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 16.sp
                    ),
                    color = accentColor,
                    modifier = Modifier.padding(horizontal = 4.dp)
                )
            }
        }
    }
}
