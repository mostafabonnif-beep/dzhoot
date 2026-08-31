package com.dzhoof.iptv.domain.repository

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.model.dto.RedeemDataDto
import com.dzhoof.iptv.data.model.dto.SubscriptionViewDataDto
import com.dzhoof.iptv.data.model.dto.DeviceDto

/**
 * Repository contract for the subscription & activation system.
 *
 * Covers: redeeming activation codes, reading the current subscription,
 * and managing the user's registered devices (subject to the plan cap).
 */
interface SubscriptionRepository {

    /**
     * Redeems an activation code.
     *
     * @param code the code as typed by the user (DZHF-XXXX-XXXX-XXXX)
     * @return Result with the new/extended subscription data
     */
    suspend fun redeemCode(code: String): Result<RedeemDataDto>

    /** Bootstraps a customer install from an activation code without an account login. */
    suspend fun clientRedeem(code: String): Result<SubscriptionViewDataDto>

    /**
     * Fetches the current subscription, plan and device usage.
     */
    suspend fun getSubscription(): Result<SubscriptionViewDataDto>

    /**
     * Registers the current device (enforced against the plan's device cap).
     */
    suspend fun registerDevice(): Result<Unit>

    /**
     * Removes a device, freeing a subscription slot.
     */
    suspend fun removeDevice(deviceId: String): Result<Unit>

    /**
     * Returns a stable id for this install (used when registering devices).
     */
    fun getDeviceId(): String
}
