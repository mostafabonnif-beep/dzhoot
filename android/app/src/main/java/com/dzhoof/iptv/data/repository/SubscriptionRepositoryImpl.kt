package com.dzhoof.iptv.data.repository

import android.content.Context
import android.provider.Settings
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.model.dto.RedeemCodeRequest
import com.dzhoof.iptv.data.model.dto.RedeemDataDto
import com.dzhoof.iptv.data.model.dto.RedeemResponseDto
import com.dzhoof.iptv.data.model.dto.RegisterDeviceRequest
import com.dzhoof.iptv.data.model.dto.SubscriptionViewDataDto
import com.dzhoof.iptv.data.model.dto.SubscriptionViewResponse
import com.dzhoof.iptv.data.source.remote.FireVisionApiService
import com.dzhoof.iptv.di.IoDispatcher
import com.dzhoof.iptv.domain.repository.SubscriptionRepository
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [SubscriptionRepository] backed by the DZ HOOF API.
 */
@Singleton
class SubscriptionRepositoryImpl @Inject constructor(
    private val apiService: FireVisionApiService,
    private val appContext: Context,
    @IoDispatcher private val dispatcher: CoroutineDispatcher,
) : SubscriptionRepository {

    override fun getDeviceId(): String {
        val androidId = Settings.Secure.getString(
            appContext.contentResolver,
            Settings.Secure.ANDROID_ID,
        ).orEmpty()
        return if (androidId.isBlank()) "dzhoof-device" else "dz-${androidId.take(16)}"
    }

    private fun deviceName(): String =
        "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".trim()

    private fun platform(): String = "android"

    override suspend fun redeemCode(code: String): Result<RedeemDataDto> =
        withContext(dispatcher) {
            try {
                val response = apiService.redeemCode(
                    RedeemCodeRequest(
                        code = code.trim(),
                        deviceId = getDeviceId(),
                        deviceName = deviceName(),
                        platform = platform(),
                    ),
                )
                if (response.isSuccessful) {
                    val body: RedeemResponseDto? = response.body()
                    val data = body?.data
                    if (body?.success == true && data != null) {
                        Result.success(data)
                    } else {
                        Result.error(IOException(body?.error ?: "Activation failed"))
                    }
                } else {
                    Result.error(IOException("Activation failed (HTTP ${response.code()})"))
                }
            } catch (e: Exception) {
                Result.error(e)
            }
        }

    override suspend fun getSubscription(): Result<SubscriptionViewDataDto> =
        withContext(dispatcher) {
            try {
                val response = apiService.getSubscription()
                if (response.isSuccessful) {
                    val body: SubscriptionViewResponse? = response.body()
                    val data = body?.data
                    if (body?.success == true && data != null) {
                        Result.success(data)
                    } else {
                        Result.error(IOException(body?.error ?: "Failed to load subscription"))
                    }
                } else {
                    Result.error(IOException("Failed to load subscription (HTTP ${response.code()})"))
                }
            } catch (e: Exception) {
                Result.error(e)
            }
        }

    override suspend fun registerDevice(): Result<Unit> =
        withContext(dispatcher) {
            try {
                val response = apiService.registerDevice(
                    RegisterDeviceRequest(
                        deviceId = getDeviceId(),
                        name = deviceName(),
                        platform = platform(),
                        appVersion = null,
                    ),
                )
                if (response.isSuccessful) {
                    Result.success(Unit)
                } else {
                    Result.error(IOException("Device registration failed (HTTP ${response.code()})"))
                }
            } catch (e: Exception) {
                Result.error(e)
            }
        }

    override suspend fun removeDevice(deviceId: String): Result<Unit> =
        withContext(dispatcher) {
            try {
                val response = apiService.deleteDevice(deviceId)
                if (response.isSuccessful) {
                    Result.success(Unit)
                } else {
                    Result.error(IOException("Failed to remove device (HTTP ${response.code()})"))
                }
            } catch (e: Exception) {
                Result.error(e)
            }
        }
}
