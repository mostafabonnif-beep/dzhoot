package com.dzhoof.iptv.presentation.ui.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dzhoof.iptv.presentation.ui.screens.SettingOption
import com.dzhoof.iptv.presentation.ui.screens.SettingRowLayout
import com.dzhoof.iptv.presentation.ui.screens.SettingsCard

@Composable
internal fun AppearanceSection(
    currentTheme: String,
    onThemeChange: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    SettingsCard(title = "المظهر", modifier = modifier) {
        SettingRowLayout(
            text = {
                Text(
                    text = "السمة",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.SemiBold
                )
            },
            action = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SettingOption(label = "داكن",   value = "dark",   current = currentTheme, onSelect = onThemeChange)
                    SettingOption(label = "فاتح",  value = "light",  current = currentTheme, onSelect = onThemeChange)
                    SettingOption(label = "النظام", value = "system", current = currentTheme, onSelect = onThemeChange)
                }
            }
        )
    }
}
