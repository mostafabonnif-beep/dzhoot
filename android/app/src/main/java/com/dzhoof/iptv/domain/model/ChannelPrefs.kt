package com.dzhoof.iptv.domain.model

/**
 * Per-channel management flags (v1.2.0). Local-only — never synced to the
 * server. [hidden] removes the channel from browse lists; [locked] requires
 * the parental PIN before playback.
 *
 * Defaults mirror the storage model: absent prefs rows read as
 * hidden=false, locked=false.
 */
data class ChannelPrefs(
    val channelId: String,
    val hidden: Boolean = false,
    val locked: Boolean = false
)
