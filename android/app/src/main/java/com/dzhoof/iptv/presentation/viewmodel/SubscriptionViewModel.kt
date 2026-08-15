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
                    error = customerError(result.exception, "تعذر تحميل معلومات الاشتراك"),
                )
            }
        }
    }

    fun claim(code: String) {
        if (code.isBlank()) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isRedeeming = true, error = null, redeemSuccess = null)
            when (val result = repository.claimCode(code)) {
                is Result.Success -> {
                    val plan = result.data.plan
                    val expires = result.data.subscription?.expiresAt
                    _uiState.value = _uiState.value.copy(
                        isRedeeming = false,
                        redeemSuccess = buildActivationMessage(plan?.name, expires),
                        subscription = SubscriptionViewDataDto(
                            subscription = result.data.subscription,
                            plan = result.data.plan,
                            devicesUsed = result.data.devicesUsed,
                            maxDevices = result.data.maxDevices,
                        ),
                    )
                }
                is Result.Error -> _uiState.value = _uiState.value.copy(
                    isRedeeming = false,
                    error = customerError(result.exception, "تعذر تفعيل الاشتراك"),
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
                    _uiState.value = _uiState.value.copy(
                        isRedeeming = false,
                        redeemSuccess = buildActivationMessage(
                            result.data.plan?.name,
                            result.data.subscription?.expiresAt,
                        ),
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
                    error = customerError(result.exception, "تعذر تفعيل الاشتراك"),
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
                    error = customerError(result.exception, "تعذر إزالة الجهاز"),
                )
            }
        }
    }

    private fun buildActivationMessage(planName: String?, expiresAt: String?): String = buildString {
        append("تم تفعيل اشتراكك بنجاح")
        if (!planName.isNullOrBlank()) append(" — $planName")
        if (!expiresAt.isNullOrBlank()) append(" · ينتهي في ${formatExpiry(expiresAt)}")
    }

    /** Hide transport/server details from customers while keeping useful guidance. */
    private fun customerError(exception: Throwable, fallback: String): String {
        val raw = exception.message.orEmpty().lowercase()
        return when {
            "http 400" in raw || "bad request" in raw || "invalid" in raw ->
                "كود التفعيل غير صالح أو تم استخدامه من قبل. تحقق من الكود وحاول مرة أخرى."
            "http 401" in raw || "http 403" in raw || "expired" in raw ->
                "انتهت صلاحية الاشتراك أو لا يملك الحساب صلاحية الوصول. يمكنك تفعيل كود جديد."
            "unable to resolve host" in raw || "timeout" in raw || "connect" in raw ->
                "تعذر الاتصال بالخدمة حاليًا. تحقق من الإنترنت وحاول مرة أخرى."
            else -> fallback
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
