package com.dzhoof.iptv.domain.model

/**
 * Domain model representing a TV channel.
 * 
 * This is the core business entity for channels, independent of any
 * data source or UI framework. It contains only the essential information
 * needed by the business logic.
 */
data class Channel(
    val id: String,
    val name: String,
    val streamUrl: String,
    val logoUrl: String?,
    val category: String,
    val language: String?,
    val country: String?,
    val tvgId: String? = null,
    val isFavorite: Boolean = false,
    val alternateStreamUrls: List<String> = emptyList(),
    /** Catch-up (timeshift) capability, e.g. "append", "timeshift" — null when unsupported. */
    val catchupType: String? = null,
    /** Provider's catch-up history window in days (null = server default). */
    val catchupDays: Int? = null
) {
    /** Whether the server advertises catch-up for this channel. */
    val supportsCatchup: Boolean
        get() = !catchupType.isNullOrBlank()
}
