package com.dzhoof.iptv

/**
 * Throttle for the channel re-sync triggered by an external broadcast.
 *
 * `ChannelUpdateReceiver` is `exported="true"` because it must receive
 * `BOOT_COMPLETED` and the standard TV-input contract action
 * `android.media.tv.action.INITIALIZE_PROGRAMS` — both are sent by the system
 * from outside the app. Its `android:permission="…RECEIVE_BOOT_COMPLETED"` is
 * **not** a meaningful filter: `RECEIVE_BOOT_COMPLETED` is a *normal* permission,
 * so any installed app can request it and then broadcast
 * `INITIALIZE_PROGRAMS` at will, forcing a full channel re-sync (network, Room
 * writes, TIF churn) on every call — a cheap denial-of-service against the device
 * and the server.
 *
 * The sender cannot be authenticated for either action, so the guard is
 * idempotence: one sync per [MIN_INTERVAL_MS], no matter how many broadcasts
 * arrive. A boot or a real TV-input initialisation is never more frequent than
 * that in practice, and the worker itself is already de-duplicated
 * (`ExistingWorkPolicy.KEEP`).
 */
object ChannelSyncThrottle {

    /** Broadcast storms inside this window collapse into the first sync. */
    const val MIN_INTERVAL_MS = 10 * 60 * 1000L

    /**
     * @param now current time (injected so this is testable).
     * @param lastSyncAt timestamp written by the previous accepted trigger, or null.
     * @return true when the sync should run and the timestamp be recorded.
     */
    fun shouldSync(now: Long, lastSyncAt: Long?): Boolean {
        if (lastSyncAt == null) return true
        // A clock jump backwards (timezone/NTP correction) must not lock syncing out
        // forever: treat a future timestamp as "long ago".
        if (lastSyncAt > now) return true
        return now - lastSyncAt >= MIN_INTERVAL_MS
    }
}
