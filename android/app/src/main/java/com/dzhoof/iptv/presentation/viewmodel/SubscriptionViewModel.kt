package com.dzhoof.iptv.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.data.model.dto.DeviceDto
import com.dzhoof.iptv.data.model.dto.SubscriptionViewDataDto
import com.dzhoof.iptv.domain.repository.SubscriptionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** UI state for the subscription screen. */
data class SubscriptionUiState(
    val isLoading: Boolean = false,
    val isRedeeming: Boolean = false,
    val subscription: SubscriptionViewDataDto? = null,
    val redeemSuccess: String? = null,
    val error: String? = null,
)

@HiltViewModel
class SubscriptionViewModel @Inject constructor(
    private val repository: SubscriptionRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SubscriptionUiState())
    val uiState: StateFlow<SubscriptionUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            when (val result = repository.getSubscription()) {
                is Result.Success -> _uiState.value = SubscriptionUiState(
                    subscription = result.data,
                )
                is Result.Error -> _uiState.value = SubscriptionUiState(
                    error = friendlyError(result.exception.message, "تعذر تحميل حالة الاشتراك"),
                )
            }
        }
    }

    fun redeem(code: String) {
        if (code.isBlank()) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isRedeeming = true, error = null, redeemSuccess = null)
            when (val result = repository.redeemCode(code)) {
                is Result.Success -> {
                    val plan = result.data.plan
                    val expires = result.data.subscription?.expiresAt
                    val message = buildString {
                        append("تم تفعيل الاشتراك")
                        if (!plan?.name.isNullOrBlank()) append(" — ${plan?.name}")
                        if (!expires.isNullOrBlank()) {
                            append(" · ينتهي في ")
                            append(formatExpiry(expires))
                        }
                    }
                    _uiState.value = _uiState.value.copy(
                        isRedeeming = false,
                        redeemSuccess = message,
                        subscription = SubscriptionViewDataDto(
                            subscription = result.data.subscription,
                            plan = result.data.plan,
                            devicesUsed = result.data.devicesUsed,
                            maxDevices = result.data.maxDevices,
                        ),
                    )
                    // Re-fetch the full view (devices list) after a successful redeem.
                    refresh()
                }
                is Result.Error -> _uiState.value = _uiState.value.copy(
                    isRedeeming = false,
                    error = friendlyError(result.exception.message, "فشل تفعيل الكود"),
                )
            }
        }
    }

    fun removeDevice(device: DeviceDto) {
        val deviceId = device.deviceId ?: return
        viewModelScope.launch {
            when (val result = repository.removeDevice(deviceId)) {
                is Result.Success -> refresh()
                is Result.Error -> _uiState.value = _uiState.value.copy(
                    error = friendlyError(result.exception.message, "تعذر حذف الجهاز"),
                )
            }
        }
    }

    private fun friendlyError(raw: String?, fallback: String): String {
        val code = raw.orEmpty().substringBefore(':').trim()
        return when (code) {
            "SUBSCRIPTION_EXPIRED" -> "انتهى اشتراكك. فعّل كودًا جديدًا للمتابعة."
            "ACTIVATION_RATE_LIMITED" -> "تم تجاوز محاولات التفعيل. حاول بعد قليل."
            "DEVICE_LIMIT_REACHED" -> "تم بلوغ الحد الأقصى للأجهزة في خطتك. احذف جهازًا أولًا."
            "CODE_ALREADY_USED" -> "هذا الكود مستخدم من قبل."
            "CODE_EXPIRED" -> "انتهت صلاحية هذا الكود."
            "PLAN_UNAVAILABLE" -> "الخطة المرتبطة بهذا الكود غير متاحة حاليًا."
            "INVALID_CODE" -> "كود التفعيل غير صالح."
            else -> raw?.substringAfter(':', raw)?.trim().takeUnless { it.isNullOrBlank() } ?: fallback
        }
    }

    private fun formatExpiry(iso: String): String =
        try {
            java.time.Instant.parse(iso)
                .atZone(java.time.ZoneId.systemDefault())
                .toLocalDate()
                .toString()
        } catch (_: Exception) {
            iso
        }
}
