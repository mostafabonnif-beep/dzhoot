package com.dzhoof.iptv.data.model.dto

import com.google.gson.annotations.SerializedName

/**
 * Non-sensitive backend build identity from `GET /health/version`.
 *
 * The endpoint is documented to contain no secrets, connection strings or internal
 * hostnames — only the running build's version/commit/builtAt/environment. The
 * diagnostics screen still screens every value before display (defence in depth).
 */
data class HealthVersionDto(
    @SerializedName("status") val status: String? = null,
    @SerializedName("service") val service: String? = null,
    @SerializedName("version") val version: String? = null,
    @SerializedName("commit") val commit: String? = null,
    @SerializedName("builtAt") val builtAt: String? = null,
    @SerializedName("environment") val environment: String? = null,
)
