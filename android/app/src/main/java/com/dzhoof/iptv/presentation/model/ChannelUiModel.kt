package com.dzhoof.iptv.presentation.model

import com.dzhoof.iptv.domain.model.ChannelHealthStatus

data class ChannelUiModel(
    val id: String,
    val name: String,
    val logoUrl: String?,
    val streamUrl: String? = null,
    val category: String,
    /** Supplier sort order within its group (curated channel order). */
    val order: Int = 0,
    val isFavorite: Boolean,
    val tvgId: String? = null,
    val healthStatus: ChannelHealthStatus = ChannelHealthStatus.UNKNOWN,
    val thumbnailPath: String? = null,
    val alternateStreamUrls: List<String> = emptyList(),
    val identityKey: String? = null,
    val identityConfidence: Double? = null,
    val serverHealthStatus: String? = null,
    val serverHealthScore: Int? = null,
    val serverFallbackCount: Int? = null,
    val serverRecommendation: String? = null,
    val nowProgramTitle: String? = null,
    val nextProgramTitle: String? = null,
    // Live EPG window for the currently-airing program (epoch millis).
    // Used to render "how far into the live program" progress — never a
    // saved file position. Null when EPG is unavailable.
    val nowProgramStartMs: Long? = null,
    val nowProgramEndMs: Long? = null
)
