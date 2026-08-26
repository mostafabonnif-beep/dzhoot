package com.dzhoof.iptv.presentation.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dzhoof.iptv.presentation.ui.theme.DzGold400
import com.dzhoof.iptv.presentation.ui.theme.DzGreen400

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
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Brand gradient accent pill (green → gold), rounded
            Box(
                modifier = Modifier
                    .width(5.dp)
                    .height(24.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(
                        Brush.verticalGradient(listOf(accentColor, DzGold400))
                    )
            )
            Spacer(modifier = Modifier.width(12.dp))
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
