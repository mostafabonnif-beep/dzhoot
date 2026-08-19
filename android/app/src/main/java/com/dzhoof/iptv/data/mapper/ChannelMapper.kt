package com.dzhoof.iptv.data.mapper

import com.dzhoof.iptv.data.model.dto.ChannelDto
import com.dzhoof.iptv.data.source.local.entity.ChannelEntity
import com.dzhoof.iptv.domain.model.Channel
import com.dzhoof.iptv.domain.model.ChannelServerMetadata
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Mapper for converting between Channel representations across layers.
 * 
 * This mapper handles bidirectional transformations between:
 * - Domain models (Channel) used in business logic
 * - Database entities (ChannelEntity) used for local storage
 * - DTOs (ChannelDto) used for network communication
 * 
 * Requirements: TR-003 (Clean Architecture - proper layer separation)
 */
@Singleton
class ChannelMapper @Inject constructor() {
    
    /**
     * Convert a ChannelEntity to a domain Channel model.
     * 
     * @param entity The database entity
     * @param isFavorite Whether this channel is marked as favorite
     * @return Domain model representation
     */
    fun toDomain(
        entity: ChannelEntity,
        isFavorite: Boolean = false,
        alternateStreamUrls: List<String> = emptyList(),
        serverMetadata: ChannelServerMetadata? = null
    ): Channel {
        return Channel(
            id = entity.id,
            name = entity.name,
            streamUrl = entity.streamUrl,
            logoUrl = entity.logoUrl,
            category = entity.categoryId,
            language = entity.language,
            country = entity.country,
            tvgId = entity.tvgId,
            isFavorite = isFavorite,
            alternateStreamUrls = alternateStreamUrls,
            catchupType = entity.catchupType,
            catchupDays = entity.catchupDays,
            identityKey = serverMetadata?.identityKey,
            identityConfidence = serverMetadata?.identityConfidence,
            identityMatch = serverMetadata?.identityMatch,
            serverHealthStatus = serverMetadata?.healthStatus,
            serverHealthScore = serverMetadata?.healthScore,
            serverFallbackCount = serverMetadata?.fallbackCount,
            serverRecommendation = serverMetadata?.recommendation
        )
    }
    
    /**
     * Convert a ChannelDto to a ChannelEntity for local storage.
     * 
     * @param dto The data transfer object from API
     * @return Database entity representation
     */
    fun toEntity(dto: ChannelDto): ChannelEntity {
        return ChannelEntity(
            id = dto.id,
            name = dto.name,
            streamUrl = dto.url,
            logoUrl = dto.logoUrl,
            categoryId = dto.groupTitle ?: "uncategorized",
            language = dto.metadata?.language ?: dto.tvgLanguage,
            country = dto.tvgCountry,
            groupTitle = dto.groupTitle,
            tvgId = dto.tvgId,
            tvgName = dto.tvgName,
            catchupType = dto.catchup?.type,
            catchupDays = dto.catchup?.days,
            isActive = true, // API channels are always active; Gson ignores Kotlin defaults
            lastUpdated = System.currentTimeMillis()
        )
    }
    
    /**
     * Convert a domain Channel model to a ChannelEntity.
     * 
     * @param channel The domain model
     * @return Database entity representation
     */
    fun fromDomain(channel: Channel): ChannelEntity {
        return ChannelEntity(
            id = channel.id,
            name = channel.name,
            streamUrl = channel.streamUrl,
            logoUrl = channel.logoUrl,
            categoryId = channel.category,
            language = channel.language,
            country = channel.country,
            groupTitle = channel.category,
            tvgId = null,
            tvgName = null,
            catchupType = channel.catchupType,
            catchupDays = channel.catchupDays,
            isActive = true,
            lastUpdated = System.currentTimeMillis()
        )
    }
}
