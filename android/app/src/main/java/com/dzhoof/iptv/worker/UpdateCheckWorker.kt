package com.dzhoof.iptv.worker

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.dzhoof.iptv.update.UpdateManager
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.withTimeout

/**
 * Background update check (see `WorkManagerInitializer.scheduleUpdateCheck`).
 *
 * It only *detects* that a newer build exists — it never downloads or installs anything.
 * Installing always goes through the system installer and the user's explicit consent, so
 * a background worker can never surprise the user with an install.
 */
@HiltWorker
class UpdateCheckWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
    private val updateManager: UpdateManager,
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        return try {
            val outcome = withTimeout(CHECK_TIMEOUT_MS) {
                updateManager.check(UpdateManager.Trigger.PERIODIC)
            }
            when {
                outcome is UpdateManager.Outcome.Failed && outcome.code.retryable ->
                    if (runAttemptCount < MAX_RETRY_ATTEMPTS) Result.retry() else Result.success()
                else -> Result.success()
            }
        } catch (e: Exception) {
            // A failed check must never fail the periodic work permanently; retry a bounded
            // number of times and then wait for the next interval.
            Log.e(TAG, "Update check failed", e)
            if (runAttemptCount < MAX_RETRY_ATTEMPTS) Result.retry() else Result.success()
        }
    }

    companion object {
        private const val TAG = "UpdateCheckWorker"
        const val WORK_NAME = "update_check_work"
        private const val MAX_RETRY_ATTEMPTS = 3
        private const val CHECK_TIMEOUT_MS = 60_000L
    }
}
