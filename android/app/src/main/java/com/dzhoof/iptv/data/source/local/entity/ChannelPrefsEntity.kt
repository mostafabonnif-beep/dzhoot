package com.dzhoof.iptv.data.source.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Per-channel user preference flags (v1.2.0 channel management).
 *
 * Two independent, local-only flags:
 *  - [hidden]: the channel is excluded from the main channels list (browse).
 *  - [locked]: playback of the channel requires the parental PIN.
 *
 * No foreign key to [channels] on purpose — the channels table is fully
 * replaced on every sync, while these flags must survive channel refreshes.
 * A row exists only while at least one flag is set to `true`; channels with no
 * prefs simply have no row (defaults apply). Kept local — never synced to the
 * server.
 */
@Entity(
    tableName = "channel_prefs",
    indices = [
        Index(value = ["hidden"]),
        Index(value = ["locked"])
    ]
)
data class ChannelPrefsEntity(
    @PrimaryKey
    val channelId: String,

    val hidden: Boolean = false,

    val locked: Boolean = false
)
