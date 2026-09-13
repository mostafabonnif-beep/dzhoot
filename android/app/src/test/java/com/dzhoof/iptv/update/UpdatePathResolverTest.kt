package com.dzhoof.iptv.update

import org.junit.Assert.assertEquals
import org.junit.Test

class UpdatePathResolverTest {

    @Test
    fun `a Play installation uses the Play path`() {
        val distribution = UpdatePathResolver.resolve(
            UpdatePathEvidence(
                installedFromPlayStore = true,
                isDeviceOwner = false,
                isProfileOwner = false,
            ),
        )

        assertEquals(UpdateDistribution.PLAY, distribution)
    }

    @Test
    fun `Play governs the install even on a managed device`() {
        val distribution = UpdatePathResolver.resolve(
            UpdatePathEvidence(
                installedFromPlayStore = true,
                isDeviceOwner = true,
                isProfileOwner = true,
            ),
        )

        assertEquals(UpdateDistribution.PLAY, distribution)
    }

    @Test
    fun `a proven device owner uses the managed path`() {
        val distribution = UpdatePathResolver.resolve(
            UpdatePathEvidence(
                installedFromPlayStore = false,
                isDeviceOwner = true,
                isProfileOwner = false,
            ),
        )

        assertEquals(UpdateDistribution.MANAGED_DEVICE, distribution)
    }

    @Test
    fun `a managed-profile owner uses the managed path`() {
        val distribution = UpdatePathResolver.resolve(
            UpdatePathEvidence(
                installedFromPlayStore = false,
                isDeviceOwner = false,
                isProfileOwner = true,
            ),
        )

        assertEquals(UpdateDistribution.MANAGED_DEVICE, distribution)
    }

    @Test
    fun `an ordinary sideload falls back to the external apk path`() {
        val distribution = UpdatePathResolver.resolve(
            UpdatePathEvidence(
                installedFromPlayStore = false,
                isDeviceOwner = false,
                isProfileOwner = false,
            ),
        )

        assertEquals(UpdateDistribution.EXTERNAL_APK, distribution)
    }

    @Test
    fun `the reported names are exactly the ones the brief requires`() {
        assertEquals("play", UpdateDistribution.PLAY.wireName)
        assertEquals("external_apk", UpdateDistribution.EXTERNAL_APK.wireName)
        assertEquals("managed_device", UpdateDistribution.MANAGED_DEVICE.wireName)
    }
}
