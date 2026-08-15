package com.dzhoof.iptv.presentation.viewmodel

import com.dzhoof.iptv.MainDispatcherRule
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.model.dto.DeviceDto
import com.dzhoof.iptv.data.model.dto.RedeemDataDto
import com.dzhoof.iptv.data.model.dto.SubscriptionDto
import com.dzhoof.iptv.data.model.dto.SubscriptionPlanDto
import com.dzhoof.iptv.data.model.dto.SubscriptionViewDataDto
import com.dzhoof.iptv.domain.repository.SubscriptionRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.any
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SubscriptionViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val repository: SubscriptionRepository = mockk()
    private val subscription = SubscriptionViewDataDto(
        subscription = SubscriptionDto(
            id = "sub-1",
            status = "ACTIVE",
            expiresAt = "2026-12-31T00:00:00Z",
        ),
        plan = SubscriptionPlanDto(
            id = "plan-1",
            name = "Premium",
            durationDays = 30,
            maxDevices = 2,
        ),
        devicesUsed = 1,
        maxDevices = 2,
        devices = listOf(DeviceDto(deviceId = "device-1", name = "Living room TV")),
    )

    @Test
    fun `loads the current subscription on startup`() = runTest {
        coEvery { repository.getSubscription() } returns Result.Success(subscription)

        val viewModel = SubscriptionViewModel(repository)
        advanceUntilIdle()

        assertEquals(subscription, viewModel.uiState.value.subscription)
        assertEquals(false, viewModel.uiState.value.isLoading)
        assertEquals(null, viewModel.uiState.value.error)
    }

    @Test
    fun `redeems a code and preserves the success message after refresh`() = runTest {
        coEvery { repository.getSubscription() } returns Result.Success(subscription)
        coEvery { repository.redeemCode("DZHF-ABCD-EFGH-IJKL") } returns Result.Success(
            RedeemDataDto(
                subscription = subscription.subscription,
                plan = subscription.plan,
                devicesUsed = 1,
                maxDevices = 2,
            ),
        )

        val viewModel = SubscriptionViewModel(repository)
        advanceUntilIdle()
        viewModel.redeem("DZHF-ABCD-EFGH-IJKL")
        advanceUntilIdle()

        coVerify { repository.redeemCode("DZHF-ABCD-EFGH-IJKL") }
        assertTrue(viewModel.uiState.value.redeemSuccess?.contains("تم تفعيل الاشتراك") == true)
        assertEquals(subscription.plan, viewModel.uiState.value.subscription?.plan)
    }

    @Test
    fun `maps activation error codes to Arabic guidance`() = runTest {
        coEvery { repository.getSubscription() } returns Result.Success(subscription)
        coEvery { repository.redeemCode("BAD-CODE") } returns Result.Error(
            IllegalArgumentException("INVALID_CODE: rejected"),
        )

        val viewModel = SubscriptionViewModel(repository)
        advanceUntilIdle()
        viewModel.redeem("BAD-CODE")
        advanceUntilIdle()

        assertEquals("كود التفعيل غير صالح.", viewModel.uiState.value.error)
        assertEquals(false, viewModel.uiState.value.isRedeeming)
    }

    @Test
    fun `registers and removes devices through the repository`() = runTest {
        coEvery { repository.getSubscription() } returns Result.Success(subscription)
        coEvery { repository.registerDevice() } returns Result.Success(Unit)
        coEvery { repository.removeDevice("device-1") } returns Result.Success(Unit)

        val viewModel = SubscriptionViewModel(repository)
        advanceUntilIdle()
        viewModel.registerDevice()
        advanceUntilIdle()
        viewModel.removeDevice(DeviceDto(deviceId = "device-1"))
        advanceUntilIdle()

        coVerify { repository.registerDevice() }
        coVerify { repository.removeDevice("device-1") }
    }

    @Test
    fun `ignores blank redemption codes`() = runTest {
        coEvery { repository.getSubscription() } returns Result.Success(subscription)

        val viewModel = SubscriptionViewModel(repository)
        advanceUntilIdle()
        viewModel.redeem("   ")
        advanceUntilIdle()

        coVerify(exactly = 0) { repository.redeemCode(any()) }
    }
}
