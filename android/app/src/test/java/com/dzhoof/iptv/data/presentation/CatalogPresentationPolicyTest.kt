package com.dzhoof.iptv.data.presentation

import com.dzhoof.iptv.data.model.dto.ChannelDto
import com.dzhoof.iptv.data.source.local.entity.ChannelEntity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogPresentationPolicyTest {
    private fun channelDto(
        name: String = "Al Kass Sports",
        groupTitle: String? = "العالم العربي · رياضة",
        tvgName: String? = name,
        channelImg: String? = null,
        tvgLogo: String? = null
    ) = ChannelDto(
        id = "channel-1",
        name = name,
        url = "https://iptv.example/playback/token.m3u8",
        channelImg = channelImg,
        tvgLogo = tvgLogo,
        groupTitle = groupTitle,
        tvgName = tvgName
    )

    @Test
    fun `suppresses decorative hash marker in channel name`() {
        assertFalse(CatalogPresentationPolicy.isCustomerVisible(
            channelDto(name = "##### ALKASS RAW #####")
        ))
    }

    @Test
    fun `suppresses supplier marker in group or artwork path`() {
        assertFalse(CatalogPresentationPolicy.isCustomerVisible(
            channelDto(groupTitle = "AR| NEO 4K")
        ))
        assertFalse(CatalogPresentationPolicy.isCustomerVisible(
            channelDto(tvgLogo = "https://images.example/neo/channel.png")
        ))
    }

    @Test
    fun `keeps ordinary legal channel labels and 4K quality text`() {
        assertTrue(CatalogPresentationPolicy.isCustomerVisible(
            channelDto(name = "Al Kass Sports 4K", groupTitle = "العالم العربي · رياضة")
        ))
    }

    @Test
    fun `suppresses an existing cached entity before it reaches the player`() {
        val cached = ChannelEntity(
            id = "channel-2",
            name = "##### SPORT #####",
            streamUrl = "https://iptv.example/playback/token.m3u8",
            logoUrl = null,
            categoryId = "رياضة",
            language = "ar",
            country = "العالم العربي",
            groupTitle = "العالم العربي · رياضة",
            tvgId = null,
            tvgName = "##### SPORT #####"
        )

        assertFalse(CatalogPresentationPolicy.isCustomerVisible(cached))
    }
}
