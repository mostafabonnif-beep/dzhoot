package com.dzhoof.iptv.presentation.mapper

import com.dzhoof.iptv.data.source.local.entity.ChannelHealthEntity
import com.dzhoof.iptv.domain.model.Channel
import com.dzhoof.iptv.domain.model.ChannelHealthStatus
import com.dzhoof.iptv.domain.model.showableHealthStatus
import com.dzhoof.iptv.presentation.model.ChannelUiModel
import com.dzhoof.iptv.presentation.util.CategoryLocalizer
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChannelUiMapper @Inject constructor() {

    fun toUiModel(
        channel: Channel,
        healthStatus: ChannelHealthStatus = ChannelHealthStatus.UNKNOWN,
        thumbnailPath: String? = null
    ): ChannelUiModel {
        return ChannelUiModel(
            id = channel.id,
            name = channel.name,
            logoUrl = channel.logoUrl,
            streamUrl = channel.streamUrl,
            category = channel.category,
            order = channel.order,
            tvgId = channel.tvgId,
            isFavorite = channel.isFavorite,
            healthStatus = healthStatus,
            thumbnailPath = thumbnailPath,
            alternateStreamUrls = channel.alternateStreamUrls,
            identityKey = channel.identityKey,
            identityConfidence = channel.identityConfidence,
            serverHealthStatus = channel.serverHealthStatus,
            serverHealthScore = channel.serverHealthScore,
            serverFallbackCount = channel.serverFallbackCount,
            serverRecommendation = channel.serverRecommendation
        )
    }

    /**
     * Decorate channels with their stored health, honouring [showableHealthStatus]: a failure
     * mark only describes the present while it is recent.
     *
     * This is the single funnel every channel list goes through (channels, search, favorites,
     * player overlays), so expiring here also fixes the "البث غير متاح" card badge, the zap order
     * that skipped dead-marked channels, and the health-based list sorting.
     *
     * @param now the moment the statuses are read — injectable so the expiry rule stays testable;
     *   production callers use the default.
     */
    fun toUiModelsWithHealth(
        channels: List<Channel>,
        healthEntities: List<ChannelHealthEntity>,
        now: Long = System.currentTimeMillis()
    ): List<ChannelUiModel> {
        val healthMap = healthEntities.associateBy { it.channelId }
        return channels.map { channel ->
            val healthEntity = healthMap[channel.id]
            val status = showableHealthStatus(
                rawStatus = healthEntity?.status,
                lastCheckedAt = healthEntity?.lastCheckedAt ?: 0L,
                now = now
            )
            toUiModel(channel, status, healthEntity?.thumbnailPath)
        }
    }
    
    /**
     * Convert a ChannelUiModel back to a domain Channel.
     * 
     * Note: This creates a minimal Channel with only UI-available data.
     * Full channel data should be retrieved from the repository.
     */
    fun fromUiModel(uiModel: ChannelUiModel): Channel {
        return Channel(
            id = uiModel.id,
            name = uiModel.name,
            streamUrl = uiModel.streamUrl ?: "",
            logoUrl = uiModel.logoUrl,
            category = uiModel.category,
            language = null,
            country = null,
            isFavorite = uiModel.isFavorite
        )
    }
}
