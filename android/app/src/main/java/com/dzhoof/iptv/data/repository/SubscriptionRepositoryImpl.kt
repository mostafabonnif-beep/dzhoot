package com.dzhoof.iptv.data.repository

import android.content.Context
import android.provider.Settings
import com.dzhoof.iptv.BuildConfig
import com.google.firebase.messaging.FirebaseMessaging
import com.dzhoof.iptv.DzHoofFirebaseMessagingService
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.AppPreferences
import com.dzhoof.iptv.data.model.dto.RedeemCodeRequest
import com.dzhoof.iptv.data.model.dto.ClientRedeemRequest
import com.dzhoof.iptv.data.model.dto.ClientRedeemResponse
import com.dzhoof.iptv.data.model.dto.RedeemDataDto
import com.dzhoof.iptv.data.model.dto.RedeemResponseDto
import com.dzhoof.iptv.data.model.dto.RegisterDeviceRequest
import com.dzhoof.iptv.data.model.dto.SubscriptionViewDataDto
import com.dzhoof.iptv.data.model.dto.SubscriptionViewResponse
import com.dzhoof.iptv.data.source.remote.DzhoofApiService
import com.dzhoof.iptv.di.IoDispatcher
import com.dzhoof.iptv.domain.repository.SubscriptionRepository
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import java.io.IOException
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of [SubscriptionRepository] backed by the DZ HOOF API.
 */
@Singleton
class SubscriptionRepositoryImpl @Inject constructor(
    private val apiService: DzhoofApiService,
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
    private fun backendError(raw: String?, fallback: String): IOException {
        val json = runCatching { JSONObject(raw.orEmpty()) }.getOrNull()
        val code = json?.optString("code")?.takeIf { it.isNotBlank() }
        val message = json?.optString("error")?.takeIf { it.isNotBlank() } ?: fallback
        return IOException(if (code != null) "$code: $message" else message)
    }

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
                        Result.error(IOException(
                            if (!body?.code.isNullOrBlank()) "${body?.code}: ${body?.error ?: "Activation failed"}"
                            else body?.error ?: "Activation failed",
                        ))
                    }
                } else {
                    Result.error(backendError(response.errorBody()?.string(), "Activation failed (HTTP ${response.code()})"))
                }
            } catch (e: Exception) {
                Result.error(e)
            }
        }

    override suspend fun clientRedeem(code: String): Result<SubscriptionViewDataDto> =
        withContext(dispatcher) {
            try {
                val response = apiService.clientRedeem(
                    ClientRedeemRequest(
                        code = code.trim(),
                        deviceId = getDeviceId(),
                        deviceName = deviceName(),
                        platform = platform(),
                        appVersion = BuildConfig.VERSION_NAME,
                    ),
                )
                if (response.isSuccessful) {
                    val body: ClientRedeemResponse? = response.body()
                    val data = body?.data
                    val sessionId = body?.sessionId
                    val deviceAccessToken = body?.deviceAccess?.token
                    if (body?.success == true && data != null && !sessionId.isNullOrBlank() && !deviceAccessToken.isNullOrBlank()) {
                        AppPreferences.setSessionId(appContext, sessionId)
                        AppPreferences.setDeviceAccessToken(appContext, deviceAccessToken)
                        Result.success(data)
                    } else {
                        Result.error(IOException(body?.error ?: "فشل تفعيل كود العميل"))
                    }
                } else {
                    Result.error(backendError(response.errorBody()?.string(), "فشل تفعيل كود العميل (HTTP ${response.code()})"))
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
                        Result.error(IOException(body?.error ?: "تعذر تحميل الاشتراك"))
                    }
                } else {
                    Result.error(backendError(response.errorBody()?.string(), "تعذر تحميل الاشتراك (HTTP ${response.code()})"))
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
                    Result.error(backendError(response.errorBody()?.string(), "Device registration failed (HTTP ${response.code()})"))
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
                    Result.error(backendError(response.errorBody()?.string(), "Failed to remove device (HTTP ${response.code()})"))
                }
            } catch (e: Exception) {
                Result.error(e)
            }
        }
}
