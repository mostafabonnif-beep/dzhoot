package com.dzhoof.iptv.data.presentation

import com.dzhoof.iptv.data.model.dto.ChannelDto
import com.dzhoof.iptv.data.source.local.entity.ChannelEntity

/**
 * Last-line customer presentation guard for managed catalog data.
 *
 * The server is authoritative and filters these entries before delivery. This
 * policy protects existing local cache and prevents a legacy server response
 * from storing provider-marked entries between application updates. It never
 * edits upstream source, rights, or audit records on the server.
 */
object CatalogPresentationPolicy {
    private val decorativeHashMarker = Regex("#{3,}")
    private val upstreamNameMarker = Regex("(?:^|[\\s|_./-])neo(?:[\\s|_./-]|$)", RegexOption.IGNORE_CASE)

    fun isCustomerVisible(channel: ChannelDto): Boolean = isCustomerVisible(
        channel.name,
        channel.tvgName,
        channel.groupTitle,
        channel.channelImg,
        channel.tvgLogo
    )

    fun isCustomerVisible(channel: ChannelEntity): Boolean = isCustomerVisible(
        channel.name,
        channel.tvgName,
        channel.groupTitle,
        channel.logoUrl
    )

    private fun isCustomerVisible(vararg displayFields: String?): Boolean =
        displayFields.none { value ->
            val text = value.orEmpty()
            decorativeHashMarker.containsMatchIn(text) || upstreamNameMarker.containsMatchIn(text)
        }
}
