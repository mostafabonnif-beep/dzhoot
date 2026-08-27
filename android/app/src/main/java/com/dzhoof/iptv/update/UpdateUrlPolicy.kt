package com.dzhoof.iptv.update

import java.net.URI

/** Pure policy for accepting APK download hosts before DownloadManager is invoked. */
internal object UpdateUrlPolicy {
    fun isAllowed(rawUrl: String, configuredServerHost: String?): Boolean {
        val uri = runCatching { URI(rawUrl) }.getOrNull() ?: return false
        if (uri.scheme != "https" || uri.host.isNullOrBlank()) return false

        val host = uri.host.lowercase()
        val isConfiguredServer = configuredServerHost
            ?.trim()
            ?.lowercase()
            ?.removeSuffix(".") == host
        val isGithubRelease = host == "github.com" ||
            host == "objects.githubusercontent.com" ||
            host.endsWith(".githubusercontent.com")
        return isConfiguredServer || isGithubRelease
    }
}
