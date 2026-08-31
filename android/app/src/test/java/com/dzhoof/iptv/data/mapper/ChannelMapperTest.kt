package com.dzhoof.iptv.data.mapper

import com.dzhoof.iptv.data.model.dto.ChannelDto
import com.dzhoof.iptv.data.model.dto.ChannelMetadataDto
import com.dzhoof.iptv.data.source.local.entity.ChannelEntity
import com.dzhoof.iptv.domain.model.Channel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ChannelMapperTest {

    private lateinit var mapper: ChannelMapper

    @Before
    fun setUp() {
        mapper = ChannelMapper()
    }

    private fun buildEntity(
        id: String = "ch1",
        name: String = "Test Channel",
        streamUrl: String = "http://stream.example.com/test.m3u8",
        logoUrl: String? = "http://logo.example.com/test.png",
        categoryId: String = "News",
        language: String? = "en",
        country: String? = "US",
        groupTitle: String? = "News",
        tvgId: String? = "tvg1",
        tvgName: String? = "Test Channel",
        catchupType: String? = null,
        catchupDays: Int? = null
    ) = ChannelEntity(
        id = id,
        name = name,
        streamUrl = streamUrl,
        logoUrl = logoUrl,
        categoryId = categoryId,
        language = language,
        country = country,
        groupTitle = groupTitle,
        tvgId = tvgId,
        tvgName = tvgName,
        catchupType = catchupType,
        catchupDays = catchupDays
    )

    private fun buildDto(
        id: String = "ch1",
        name: String = "Test Channel",
        url: String = "http://stream.example.com/test.m3u8",
        groupTitle: String? = "News",
        tvgId: String? = "tvg1",
        tvgName: String? = "Test Channel",
        tvgLanguage: String? = "en",
        tvgCountry: String? = "US",
        metadata: ChannelMetadataDto? = null
    ) = ChannelDto(
        id = id,
        name = name,
        url = url,
        channelImg = null,
        groupTitle = groupTitle,
        tvgId = tvgId,
        tvgName = tvgName,
        tvgLanguage = tvgLanguage,
        tvgCountry = tvgCountry,
        metadata = metadata
    )

    // toDomain tests

    @Test
    fun `toDomain maps basic entity fields to channel`() {
        val entity = buildEntity()

        val channel = mapper.toDomain(entity)

        assertEquals("ch1", channel.id)
        assertEquals("Test Channel", channel.name)
        assertEquals("http://stream.example.com/test.m3u8", channel.streamUrl)
        assertEquals("News", channel.category)
        assertFalse(channel.isFavorite)
    }

    @Test
    fun `toDomain with isFavorite true sets isFavorite on channel`() {
        val entity = buildEntity()

        val channel = mapper.toDomain(entity, isFavorite = true)

        assertTrue(channel.isFavorite)
    }

    @Test
    fun `toDomain with alternateStreamUrls populates list on channel`() {
        val entity = buildEntity()
        val alternates = listOf("http://alt1.example.com/test.m3u8", "http://alt2.example.com/test.m3u8")

        val channel = mapper.toDomain(entity, alternateStreamUrls = alternates)

        assertEquals(alternates, channel.alternateStreamUrls)
    }

    // toEntity tests

    @Test
    fun `toEntity maps basic dto fields to entity`() {
        val dto = buildDto()

        val entity = mapper.toEntity(dto)

        assertEquals("ch1", entity.id)
        assertEquals("Test Channel", entity.name)
        assertEquals("http://stream.example.com/test.m3u8", entity.streamUrl)
        assertEquals("News", entity.categoryId)
    }

    @Test
    fun `toEntity with null groupTitle sets categoryId to uncategorized`() {
        val dto = buildDto(groupTitle = null)

        val entity = mapper.toEntity(dto)

        assertEquals("uncategorized", entity.categoryId)
    }

    @Test
    fun `toEntity prefers metadata language over tvgLanguage`() {
        val metadata = ChannelMetadataDto(language = "fr")
        val dto = buildDto(tvgLanguage = "en", metadata = metadata)

        val entity = mapper.toEntity(dto)

        assertEquals("fr", entity.language)
    }

    // fromDomain test

    @Test
    fun `fromDomain maps channel fields to entity`() {
        val channel = Channel(
            id = "ch1",
            name = "Test Channel",
            streamUrl = "http://stream.example.com/test.m3u8",
            logoUrl = "http://logo.example.com/test.png",
            category = "News",
            language = "en",
            country = "US"
        )

        val entity = mapper.fromDomain(channel)

        assertEquals("ch1", entity.id)
        assertEquals("Test Channel", entity.name)
        assertEquals("http://stream.example.com/test.m3u8", entity.streamUrl)
        assertEquals("News", entity.categoryId)
        assertEquals("en", entity.language)
        assertEquals("US", entity.country)
        assertNull(entity.tvgId)
        assertNull(entity.tvgName)
    }

    // Catch-up capability tests

    @Test
    fun `toEntity maps catchup capability from dto`() {
        val dto = buildDto().copy(
            catchup = com.dzhoof.iptv.data.model.dto.ChannelCatchupDto(type = "timeshift", days = 3)
        )

        val entity = mapper.toEntity(dto)

        assertEquals("timeshift", entity.catchupType)
        assertEquals(3, entity.catchupDays)
    }

    @Test
    fun `toEntity leaves catchup null when dto has none`() {
        val entity = mapper.toEntity(buildDto())

        assertNull(entity.catchupType)
        assertNull(entity.catchupDays)
    }

    @Test
    fun `toDomain exposes supportsCatchup from entity`() {
        val entity = buildEntity(catchupType = "append", catchupDays = 7)

        val channel = mapper.toDomain(entity)

        assertTrue(channel.supportsCatchup)
        assertEquals("append", channel.catchupType)
        assertEquals(7, channel.catchupDays)
    }

    @Test
    fun `toDomain reports no catchup when entity lacks it`() {
        val channel = mapper.toDomain(buildEntity())

        assertFalse(channel.supportsCatchup)
        assertNull(channel.catchupType)
    }

    @Test
    fun `fromDomain carries catchup fields to entity`() {
        val channel = Channel(
            id = "ch1",
            name = "Test Channel",
            streamUrl = "http://stream.example.com/test.m3u8",
            logoUrl = null,
            category = "News",
            language = null,
            country = null,
            catchupType = "timeshift",
            catchupDays = 3
        )

        val entity = mapper.fromDomain(channel)

        assertEquals("timeshift", entity.catchupType)
        assertEquals(3, entity.catchupDays)
    }
}
