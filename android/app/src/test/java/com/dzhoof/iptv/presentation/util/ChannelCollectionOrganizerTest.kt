package com.dzhoof.iptv.presentation.util

import com.dzhoof.iptv.presentation.model.ChannelUiModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChannelCollectionOrganizerTest {

    @Test
    fun `collections expose a dedicated bein sports shelf before generic sports`() {
        val channels = listOf(
            channel(name = "beIN SPORTS 1 HD", category = "AR | SPORT"),
            channel(name = "beIN MAX 2", category = "Football"),
            channel(name = "Eurosport 1", category = "Sports"),
            channel(name = "France 24", category = "News")
        )

        val collections = ChannelCollectionOrganizer.collections(channels)

        val bein = collections.firstOrNull { it.id == ChannelCollectionOrganizer.BEIN_SPORTS_ID }
        assertNotNull(bein)
        assertEquals(2, bein?.channelCount)
        assertTrue(collections.indexOfFirst { it.id == ChannelCollectionOrganizer.BEIN_SPORTS_ID } <
            collections.indexOfFirst { it.id == ChannelCollectionOrganizer.SPORTS_ID })
    }

    @Test
    fun `country collections use explicit provider country and inferred text`() {
        val channels = listOf(
            channel(name = "ENTV الوطنية", category = "General", country = "DZ"),
            channel(name = "TF1", category = "FRANCE | General"),
            channel(name = "MBC 1", category = "Arab", country = "SA")
        )

        val collections = ChannelCollectionOrganizer.collections(channels)

        assertEquals(1, collections.first { it.id == "collection:country:dz" }.channelCount)
        assertEquals(1, collections.first { it.id == "collection:country:fr" }.channelCount)
        assertEquals(1, collections.first { it.id == "collection:country:sa" }.channelCount)
    }

    @Test
    fun `short country tokens are matched as words rather than inside channel names`() {
        val channels = listOf(
            channel(name = "Fresh Music", category = "Entertainment"),
            channel(name = "TV 5", category = "FR | General")
        )

        val frenchChannels = ChannelCollectionOrganizer.filter(channels, "collection:country:fr")

        assertEquals(listOf("TV 5"), frenchChannels.map { it.name })
    }

    @Test
    fun `filter preserves the raw channels and returns only selected virtual collection`() {
        val channels = listOf(
            channel(name = "beIN SPORTS 2", category = "Sport"),
            channel(name = "Canal+ Cinema", category = "Movies"),
            channel(name = "Algeria 3", category = "DZ | General")
        )

        val filtered = ChannelCollectionOrganizer.filter(channels, ChannelCollectionOrganizer.BEIN_SPORTS_ID)

        assertEquals(listOf("beIN SPORTS 2"), filtered.map { it.name })
        assertEquals("beIN SPORTS", ChannelCollectionOrganizer.titleFor(ChannelCollectionOrganizer.BEIN_SPORTS_ID))
        assertTrue(ChannelCollectionOrganizer.isCollectionId(ChannelCollectionOrganizer.BEIN_SPORTS_ID))
        assertFalse(ChannelCollectionOrganizer.isCollectionId("Sport"))
    }

    private fun channel(
        name: String,
        category: String,
        country: String? = null
    ) = ChannelUiModel(
        id = name,
        name = name,
        logoUrl = null,
        category = category,
        isFavorite = false,
        country = country
    )
}
