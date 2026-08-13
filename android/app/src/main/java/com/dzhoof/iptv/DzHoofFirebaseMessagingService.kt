package com.dzhoof.iptv

import com.google.firebase.messaging.FirebaseMessagingService

/**
 * Keeps the latest FCM token available to the authenticated device-registration flow.
 * The token is never logged; SubscriptionRepository sends it to the API after auth.
 */
class DzHoofFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        if (token.isBlank()) return
        getSharedPreferences(PREFERENCES, MODE_PRIVATE)
            .edit()
            .putString(PUSH_TOKEN, token)
            .apply()
    }

    companion object {
        const val PREFERENCES = "dzhoof_push"
        const val PUSH_TOKEN = "push_token"
    }
}
