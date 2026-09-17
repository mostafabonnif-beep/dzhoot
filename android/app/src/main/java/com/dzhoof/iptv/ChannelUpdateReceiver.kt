package com.dzhoof.iptv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.tv.TvContract
import android.util.Log
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.dzhoof.iptv.data.AppPreferences
import com.dzhoof.iptv.worker.ChannelSyncWorker

class ChannelUpdateReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.d(TAG, "Received broadcast: $action")
        when (action) {
            TvContract.ACTION_INITIALIZE_PROGRAMS -> {
                Log.d(TAG, "Initializing channels...")
                enqueueSync(context)
            }
            Intent.ACTION_BOOT_COMPLETED -> {
                Log.d(TAG, "Device booted, syncing channels...")
                enqueueSync(context)
            }
        }
    }

    /**
     * Enqueue a channel sync, at most once per [ChannelSyncThrottle.MIN_INTERVAL_MS].
     *
     * Both actions this receiver handles come from outside the app and cannot be
     * authenticated: `RECEIVE_BOOT_COMPLETED` (the manifest permission) is a
     * *normal* permission any app may hold, so any installed app can broadcast
     * `INITIALIZE_PROGRAMS` and force a full re-sync on every call. Throttling the
     * trigger makes that harmless without breaking boot or the TV-input contract.
     */
    private fun enqueueSync(context: Context) {
        val prefs = context.getSharedPreferences(AppPreferences.PREFS_NAME, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val last = prefs.getLong(KEY_LAST_SYNC_AT, 0L).takeIf { it > 0L }
        if (!ChannelSyncThrottle.shouldSync(now, last)) {
            Log.d(TAG, "Sync skipped: last trigger was ${now - (last ?: 0L)}ms ago")
            return
        }
        prefs.edit().putLong(KEY_LAST_SYNC_AT, now).apply()

        val syncRequest = OneTimeWorkRequestBuilder<ChannelSyncWorker>().build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            BOOT_SYNC_WORK,
            ExistingWorkPolicy.KEEP,
            syncRequest
        )
        Log.d(TAG, "Channel sync enqueued via WorkManager")
    }

    companion object {
        private const val TAG = "ChannelUpdateReceiver"
        private const val BOOT_SYNC_WORK = "boot_channel_sync"
        internal const val KEY_LAST_SYNC_AT = "channel_sync_last_trigger_at"
    }
}
