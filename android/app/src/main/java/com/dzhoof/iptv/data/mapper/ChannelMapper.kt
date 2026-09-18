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
     * Drop entries that cannot be mapped at all.
     *
     * [ChannelDto.id] and [ChannelDto.name] are required: without them a channel
     * cannot be identified or displayed, and Gson assigns through reflection, so
     * a payload that omits them writes **null** into a non-null Kotlin field and
     * the failure surfaces as an NPE from `ChannelEntity`'s constructor intrinsic
     * check inside a bulk `map { toEntity(it) }` — where ONE bad entry aborts the
     * whole refresh.
     *
     * [ChannelDto.url] is deliberately **not** required. The TV list endpoint
     * strips playback URLs on purpose (`tokenizeListForClient` in
     * `server/backend/src/routes/channels.js`: "Playback URLs are intentionally
     * NOT embedded") because the app is meant to request a short-lived token per
     * play via `POST /api/v1/tv/playback-token`. A blank url is therefore the
     * NORMAL value for every channel the app syncs.
     *
     * Requiring it here dropped all ~14,170 synced channels, so the app showed
     * "لا توجد قنوات متاحة لهذا الحساب" on every device and could not play
     * anything — a defensive guard that silently disabled the product when the
     * upstream contract changed. `toEntity` already tolerates a blank url.
     */
    fun sanitize(dtos: List<ChannelDto>): List<ChannelDto> = dtos.filterNot { dto ->
        isMissing(dto.id) || isMissing(dto.name)
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
