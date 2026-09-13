package com.dzhoof.iptv.update

import android.util.Log
import com.dzhoof.iptv.presentation.model.UpdateInfo
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Single entry point for the update pipeline.
 *
 * Owns *policy* — when a check is allowed, how often, and what the last result was — and
 * leaves the network to [UpdateRepository]. Nothing here (or below) lives in a Composable
 * or an Activity, so the rules are unit-tested.
 */
@Singleton
class UpdateManager @Inject constructor(
    private val repository: UpdateRepository,
    private val checkStore: UpdateCheckStore,
    private val distributionProvider: UpdateDistributionProvider,
) {

    /**
     * Which of the three distribution paths this install uses (`play` / `external_apk` /
     * `managed_device`). Non-sensitive, and the only device fact the pipeline reports.
     */
    val distribution: UpdateDistribution
        get() = distributionProvider.current()

    /** Why a check is being attempted — each trigger has its own cadence. */
    enum class Trigger {
        /** App reached the foreground/startup: short cooldown so relaunches do not spam. */
        APP_LAUNCH,

        /** WorkManager periodic check: the brief's 6–24 hour cadence. */
        PERIODIC,

        /** The user explicitly asked (Settings): never rate limited. */
        MANUAL,
    }

    sealed interface Outcome {
        /** The trigger's cooldown has not elapsed; nothing was requested. */
        data object Skipped : Outcome
        data object UpToDate : Outcome
        data class Available(val update: UpdateInfo) : Outcome
        data class Failed(val code: UpdateErrorCode) : Outcome
    }

    /**
     * Runs a check when the trigger's policy allows it. Never throws.
     *
     * Every non-skipped attempt (success *and* failure) moves the cooldown forward, so a
     * dead provider cannot be retried in a tight loop.
     */
    suspend fun check(trigger: Trigger, nowMillis: Long = System.currentTimeMillis()): Outcome {
        Log.i(TAG, "check trigger=$trigger distribution=${distribution.wireName}")

        if (trigger != Trigger.MANUAL) {
            val cooldown = when (trigger) {
                Trigger.PERIODIC -> UpdateSchedulePolicy.periodicCooldownMillis()
                else -> UpdateSchedulePolicy.foregroundCooldownMillis()
            }
            if (!UpdateSchedulePolicy.isDue(nowMillis, checkStore.lastCheckAtMillis(), cooldown)) {
                return Outcome.Skipped
            }
        }

        val outcome = when (val result = repository.fetchAvailableUpdate()) {
            is UpdateRepository.Result.Found -> Outcome.Available(result.update)
            UpdateRepository.Result.UpToDate -> Outcome.UpToDate
            is UpdateRepository.Result.Failed -> Outcome.Failed(result.code)
        }

        if (outcome !is Outcome.Skipped) {
            checkStore.recordCheck(nowMillis, resultCode(outcome))
        }
        return outcome
    }

    private companion object {
        const val TAG = "UpdateManager"
    }

    /** Non-sensitive label persisted for diagnostics. */
    internal fun resultCode(outcome: Outcome): String = when (outcome) {
        is Outcome.Available -> "available"
        Outcome.UpToDate -> "up_to_date"
        is Outcome.Skipped -> "skipped"
        is Outcome.Failed -> outcome.code.name
    }
}
