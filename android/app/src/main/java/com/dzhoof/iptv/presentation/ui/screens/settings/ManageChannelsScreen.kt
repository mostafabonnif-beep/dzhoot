package com.dzhoof.iptv.presentation.ui.screens.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dzhoof.iptv.data.AppPreferences
import com.dzhoof.iptv.presentation.model.ManageChannelRow
import com.dzhoof.iptv.presentation.ui.components.AppSpinner
import com.dzhoof.iptv.presentation.ui.components.CategoryChip
import com.dzhoof.iptv.presentation.ui.components.EmptyState
import com.dzhoof.iptv.presentation.ui.components.ParentalPinDialog
import com.dzhoof.iptv.presentation.ui.components.ScreenScaffold
import com.dzhoof.iptv.presentation.ui.components.SpinnerSize
import com.dzhoof.iptv.presentation.ui.player.isMobileDevice
import com.dzhoof.iptv.presentation.ui.theme.Dimens
import com.dzhoof.iptv.presentation.ui.theme.ShapeSmall
import com.dzhoof.iptv.presentation.ui.theme.subtleBorder
import com.dzhoof.iptv.presentation.util.CategoryLocalizer
import com.dzhoof.iptv.presentation.viewmodel.ManageChannelsViewModel

/** The two management modes, switchable via the chip row (D-pad left/right on TV). */
internal enum class ManageSection(val label: String) {
    Hide("إخفاء"),
    Lock("قفل")
}

/** A lock-toggle awaiting parental PIN verification: (channelId, desired locked). */
private data class PendingLock(val channelId: String, val locked: Boolean)

/**
 * Channel management ("إدارة القنوات"): browse every channel and toggle two
 * local-only flags — hidden (dropped from browse lists) and locked (PIN-gated
 * playback). Lock changes verify the parental PIN via [ParentalPinDialog];
 * unlocking is free once the PIN was verified earlier in the session, and
 * locking is refused (with a hint) when no PIN is configured yet.
 *
 * Everything here is per-device state — nothing is sent to the server.
 */
@Composable
internal fun ManageChannelsScreen(
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ManageChannelsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val isMobile = isMobileDevice(context)
    val isCompact = LocalConfiguration.current.screenWidthDp < 600

    var section by remember { mutableStateOf(ManageSection.Hide) }
    var pendingLock by remember { mutableStateOf<PendingLock?>(null) }
    var showNoPinHint by remember { mutableStateOf(false) }

    /** Entry point for a lock-flag change — applies the PIN gate rules. */
    fun onLockToggle(row: ManageChannelRow, locked: Boolean) {
        when {
            // Unlocking is free once the parent verified the PIN this session.
            !locked && AppPreferences.isParentalUnlockedThisSession() ->
                viewModel.setLocked(row.channelId, false)
            // Locking requires a configured PIN; without one, point to Parental settings.
            locked && !AppPreferences.hasParentalPin(context) ->
                showNoPinHint = true
            else ->
                pendingLock = PendingLock(row.channelId, locked)
        }
    }

    ScreenScaffold(
        title = "إدارة القنوات",
        modifier = modifier,
        onBack = onNavigateBack
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // ── Mode chips (hide / lock) ─────────────────────────────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(
                        start = if (isCompact) Dimens.ScreenPaddingHorizontalMobile else Dimens.ScreenPaddingHorizontalTv,
                        end = if (isCompact) Dimens.ScreenPaddingHorizontalMobile else Dimens.ScreenPaddingHorizontalTv
                    ),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                val hideFocus = remember { FocusRequester() }
                CategoryChip(
                    label = ManageSection.Hide.label,
                    isSelected = section == ManageSection.Hide,
                    selectedContainerColor = MaterialTheme.colorScheme.primary,
                    selectedLabelColor = MaterialTheme.colorScheme.onPrimary,
                    onClick = { section = ManageSection.Hide },
                    modifier = if (!isMobile) Modifier.focusRequester(hideFocus) else Modifier
                )
                CategoryChip(
                    label = ManageSection.Lock.label,
                    isSelected = section == ManageSection.Lock,
                    selectedContainerColor = MaterialTheme.colorScheme.primary,
                    selectedLabelColor = MaterialTheme.colorScheme.onPrimary,
                    onClick = { section = ManageSection.Lock }
                )
                // Land TV focus on the tab chips so the first D-pad press picks a
                // mode instead of accidentally toggling the first channel row.
                if (!isMobile) {
                    LaunchedEffect(Unit) { runCatching { hideFocus.requestFocus() } }
                }
            }
            Text(
                text = "التغييرات محلية على هذا الجهاز فقط",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(
                    start = if (isCompact) Dimens.ScreenPaddingHorizontalMobile else Dimens.ScreenPaddingHorizontalTv,
                    end = if (isCompact) Dimens.ScreenPaddingHorizontalMobile else Dimens.ScreenPaddingHorizontalTv
                )
            )
            Spacer(modifier = Modifier.height(Dimens.Space2))

            // ── List ─────────────────────────────────────────────────
            when {
                uiState.isLoading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    AppSpinner(size = SpinnerSize.Medium)
                }
                uiState.rows.isEmpty() -> EmptyState(
                    message = "لا توجد قنوات بعد — حدّث قائمتك من شاشة القنوات أولًا"
                )
                else -> ManageChannelList(
                    rows = uiState.rows,
                    section = section,
                    isMobile = isMobile,
                    isCompact = isCompact,
                    onHideToggle = viewModel::setHidden,
                    onLockToggle = { row, locked -> onLockToggle(row, locked) }
                )
            }
        }
    }

    // ── PIN gate for lock toggles ─────────────────────────────────────
    pendingLock?.let { pending ->
        ParentalPinDialog(
            title = if (pending.locked) "أدخل PIN لقفل هذه القناة" else "أدخل PIN لفتح هذه القناة",
            verify = { AppPreferences.verifyParentalPin(context, it) },
            errorMessage = "PIN غير صحيح",
            onSuccess = {
                // A successful entry unlocks the session (like the player flow), so
                // further unlock toggles don't re-prompt.
                AppPreferences.setParentalUnlockedThisSession(true)
                viewModel.setLocked(pending.channelId, pending.locked)
                pendingLock = null
            },
            onDismiss = { pendingLock = null }
        )
    }

    // ── Hint when locking without a configured PIN ────────────────────
    if (showNoPinHint) {
        AlertDialog(
            onDismissRequest = { showNoPinHint = false },
            title = { Text("PIN غير مضبوط") },
            text = { Text("لا يمكن قفل القنوات قبل ضبط رمز PIN من الإعدادات ← الرقابة الأبوية.") },
            confirmButton = {
                TextButton(onClick = { showNoPinHint = false }) {
                    Text("حسنًا")
                }
            }
        )
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun ManageChannelList(
    rows: List<ManageChannelRow>,
    section: ManageSection,
    isMobile: Boolean,
    isCompact: Boolean,
    onHideToggle: (String, Boolean) -> Unit,
    onLockToggle: (ManageChannelRow, Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    LazyColumn(
        state = rememberLazyListState(),
        modifier = modifier
            .fillMaxSize()
            .focusRestorer(),
        contentPadding = PaddingValues(
            start = if (isCompact) Dimens.ScreenPaddingHorizontalMobile else Dimens.ScreenPaddingHorizontalTv,
            end = if (isCompact) Dimens.ScreenPaddingHorizontalMobile else Dimens.ScreenPaddingHorizontalTv,
            top = Dimens.Space1,
            bottom = if (isCompact) Dimens.ScreenPaddingVerticalMobile else Dimens.Space5
        ),
        verticalArrangement = Arrangement.spacedBy(Dimens.Space2)
    ) {
        items(rows, key = { it.channelId }) { row ->
            when (section) {
                ManageSection.Hide -> ManageToggleRow(
                    row = row,
                    checked = row.hidden,
                    statusLabel = if (row.hidden) "مخفية — لن تظهر في قوائم القنوات" else null,
                    onToggle = { hidden -> onHideToggle(row.channelId, hidden) },
                    isMobile = isMobile
                )
                ManageSection.Lock -> ManageToggleRow(
                    row = row,
                    checked = row.locked,
                    statusLabel = if (row.locked) "مقفلة — تتطلب PIN للمشاهدة" else null,
                    onToggle = { locked -> onLockToggle(row, locked) },
                    isMobile = isMobile
                )
            }
        }
    }
}

/**
 * One manage row: channel name + category (and a status caption when flagged)
 * with a trailing Switch. Phone rows toggle by tapping anywhere; on TV the
 * Switch itself is the focus target (D-pad center toggles), mirroring the
 * Parental section's switch rows.
 */
@Composable
private fun ManageToggleRow(
    row: ManageChannelRow,
    checked: Boolean,
    statusLabel: String?,
    onToggle: (Boolean) -> Unit,
    isMobile: Boolean,
    modifier: Modifier = Modifier
) {
    val content: @Composable () -> Unit = {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = Dimens.Space3, vertical = Dimens.Space2),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = row.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = if (statusLabel != null) {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = statusLabel ?: CategoryLocalizer.localize(row.category),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (statusLabel != null) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Spacer(modifier = Modifier.width(Dimens.Space3))
            Switch(checked = checked, onCheckedChange = onToggle)
        }
    }

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = ShapeSmall,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, subtleBorder)
    ) {
        if (isMobile) {
            // Whole row is the touch target; the Switch inside still consumes its
            // own taps so no double-toggle.
            Box(
                modifier = Modifier.clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = { onToggle(!checked) }
                )
            ) {
                content()
            }
        } else {
            content()
        }
    }
}
