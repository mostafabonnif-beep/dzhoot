package com.dzhoof.iptv.data.repository

import android.content.Context
import android.provider.Settings
import com.dzhoof.iptv.BuildConfig
import com.google.firebase.messaging.FirebaseMessaging
import com.dzhoof.iptv.DzHoofFirebaseMessagingService
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
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
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

    /**
     * Returns the current Firebase token when Firebase is configured for this build.
     * Debug builds without google-services.json intentionally continue without a token.
     */
    private suspend fun getPushToken(): String? {
        if (!BuildConfig.FIREBASE_ENABLED) return null
        val preferences = appContext.getSharedPreferences(
            DzHoofFirebaseMessagingService.PREFERENCES,
            Context.MODE_PRIVATE,
        )
        preferences.getString(DzHoofFirebaseMessagingService.PUSH_TOKEN, null)
            ?.takeIf { it.isNotBlank() }
            ?.let { return it }

        return try {
            suspendCancellableCoroutine { continuation ->
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    val token = if (task.isSuccessful) task.result?.takeIf { it.isNotBlank() } else null
                    if (token != null) {
                        preferences.edit().putString(DzHoofFirebaseMessagingService.PUSH_TOKEN, token).apply()
                    }
                    continuation.resume(token)
                }
            }
        } catch (_: Exception) {
            null
        }
    }

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
                        appVersion = BuildConfig.VERSION_NAME,
                        pushToken = getPushToken(),
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
