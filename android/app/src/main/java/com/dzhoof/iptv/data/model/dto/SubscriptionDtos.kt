package com.dzhoof.iptv.data.model.dto

import com.google.gson.annotations.SerializedName

/** Request body for POST /api/v1/activation/redeem */
data class RedeemCodeRequest(
    @SerializedName("code")
    val code: String,

    @SerializedName("deviceId")
    val deviceId: String? = null,

    @SerializedName("deviceName")
    val deviceName: String? = null,

    @SerializedName("platform")
    val platform: String? = null,

    @SerializedName("appVersion")
    val appVersion: String? = null,
)

/** Plan summary returned by redeem + subscription endpoints. */
data class SubscriptionPlanDto(
    @SerializedName("_id") val id: String? = null,
    @SerializedName("name") val name: String? = null,
    @SerializedName("durationDays") val durationDays: Int? = null,
    @SerializedName("maxDevices") val maxDevices: Int? = null,
)

/** Subscription summary returned by redeem + subscription endpoints. */
data class SubscriptionDto(
    @SerializedName("_id") val id: String? = null,
    @SerializedName("status") val status: String? = null,
    @SerializedName("startsAt") val startsAt: String? = null,
    @SerializedName("expiresAt") val expiresAt: String? = null,
)

/** A registered device. */
data class DeviceDto(
    @SerializedName("_id") val id: String? = null,
    @SerializedName("deviceId") val deviceId: String? = null,
    @SerializedName("name") val name: String? = null,
    @SerializedName("platform") val platform: String? = null,
    @SerializedName("lastSeenAt") val lastSeenAt: String? = null,
)

/** Request body for POST /api/v1/activation/client-redeem. */
typealias ClientRedeemRequest = RedeemCodeRequest

/** Success payload of POST /api/v1/activation/client-redeem. */
data class ClientRedeemResponse(
    @SerializedName("success") val success: Boolean = false,
    @SerializedName("sessionId") val sessionId: String? = null,
    @SerializedName("user") val user: ClientRedeemUserDto? = null,
    @SerializedName("data") val data: SubscriptionViewDataDto? = null,
    @SerializedName("error") val error: String? = null,
    @SerializedName("code") val code: String? = null,
)

data class ClientRedeemUserDto(
    @SerializedName("channelListCode") val channelListCode: String? = null,
)

/** Success payload of POST /api/v1/activation/redeem */
data class RedeemResponseDto(
    @SerializedName("success") val success: Boolean = false,
    @SerializedName("data") val data: RedeemDataDto? = null,
    @SerializedName("error") val error: String? = null,
    @SerializedName("code") val code: String? = null,
)

data class RedeemDataDto(
    @SerializedName("subscription") val subscription: SubscriptionDto? = null,
    @SerializedName("plan") val plan: SubscriptionPlanDto? = null,
    @SerializedName("devicesUsed") val devicesUsed: Int = 0,
    @SerializedName("maxDevices") val maxDevices: Int = 0,
)

/** Response of GET /api/v1/me/subscription */
data class SubscriptionViewResponse(
    @SerializedName("success") val success: Boolean = false,
    @SerializedName("data") val data: SubscriptionViewDataDto? = null,
    @SerializedName("error") val error: String? = null,
)

data class SubscriptionViewDataDto(
    @SerializedName("subscription") val subscription: SubscriptionDto? = null,
    @SerializedName("plan") val plan: SubscriptionPlanDto? = null,
    @SerializedName("devicesUsed") val devicesUsed: Int = 0,
    @SerializedName("maxDevices") val maxDevices: Int = 0,
    @SerializedName("devices") val devices: List<DeviceDto> = emptyList(),
)

/** Response of GET /api/v1/me/devices */
data class DevicesResponse(
    @SerializedName("success") val success: Boolean = false,
    @SerializedName("data") val data: List<DeviceDto> = emptyList(),
    @SerializedName("error") val error: String? = null,
)

/** Request body for POST /api/v1/me/devices */
data class RegisterDeviceRequest(
    @SerializedName("deviceId") val deviceId: String,
    @SerializedName("name") val name: String? = null,
    @SerializedName("platform") val platform: String? = null,
    @SerializedName("appVersion") val appVersion: String? = null,
    @SerializedName("pushToken") val pushToken: String? = null,
)
