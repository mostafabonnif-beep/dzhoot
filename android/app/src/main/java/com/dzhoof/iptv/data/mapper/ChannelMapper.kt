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
     * Drop entries that cannot be mapped.
     *
     * `ChannelDto.id` / `name` / `url` are declared non-null, but Gson assigns
     * through reflection: a payload that omits one of them (or spells it
     * differently) writes **null** into a non-null Kotlin field. The failure then
     * surfaces as an NPE from `ChannelEntity`'s constructor intrinsic check —
     * inside a bulk `map { toEntity(it) }`, so ONE malformed entry aborted the
     * whole refresh and the user kept the stale channel list behind a generic
     * "تعذر تحميل القنوات". Skipping the bad entry costs nothing and is what the
     * customer expects.
     *
     * @return the usable subset, in order.
     */
    fun sanitize(dtos: List<ChannelDto>): List<ChannelDto> = dtos.filterNot { dto ->
        isMissing(dto.id) || isMissing(dto.name) || isMissing(dto.url)
    }

    /**
     * A nullable-typed read of a field the payload can under-fill. The parameter
     * type is `String?` on purpose: comparing a non-null Kotlin type against null
     * is flagged by the compiler, but the value genuinely can be null at runtime.
     */
    private fun isMissing(value: String?): Boolean = value.isNullOrBlank()
    
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
            order = entity.order,
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
            // `orEmpty()` guards the Gson-null case even when a caller skipped
            // `sanitize`; Room rejects an empty primary key rather than crashing.
            id = dto.id.orEmpty(),
            name = dto.name.orEmpty(),
            streamUrl = dto.url.orEmpty(),
            logoUrl = dto.logoUrl,
            categoryId = dto.groupTitle ?: "uncategorized",
            language = dto.metadata?.language ?: dto.tvgLanguage,
            country = dto.tvgCountry,
            groupTitle = dto.groupTitle,
            order = dto.order,
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
            order = channel.order,
            tvgId = null,
            tvgName = null,
            catchupType = channel.catchupType,
            catchupDays = channel.catchupDays,
            isActive = true,
            lastUpdated = System.currentTimeMillis()
        )
    }
}
