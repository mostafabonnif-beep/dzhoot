package com.dzhoof.iptv.update

/**
 * When an automatic update check is allowed to run.
 *
 * Pure logic (no Android types) so the rules are unit-tested; callers supply "now" and
 * the last check time.
 *
 * The operations brief asks for a check at startup, on foreground *with a cooldown*, and
 * every 6–24 hours in the background. The two cadences are different on purpose: a user
 * who relaunches the app should not hammer the API, but also should not wait half a day
 * to be told about an update.
 */
object UpdateSchedulePolicy {

    /** Minimum gap between two automatic foreground checks. */
    const val FOREGROUND_COOLDOWN_MINUTES = 30L

    /** Background cadence bounds required by the brief (6–24 hours). */
    const val MIN_INTERVAL_HOURS = 6
    const val DEFAULT_INTERVAL_HOURS = 12
    const val MAX_INTERVAL_HOURS = 24

    fun foregroundCooldownMillis(): Long = FOREGROUND_COOLDOWN_MINUTES * 60_000L

    fun periodicCooldownMillis(intervalHours: Int = DEFAULT_INTERVAL_HOURS): Long =
        periodicIntervalHours(intervalHours) * 60L * 60_000L

    /** Clamps any caller-supplied cadence into the brief's 6–24 hour window. */
    fun periodicIntervalHours(intervalHours: Int = DEFAULT_INTERVAL_HOURS): Int =
        intervalHours.coerceIn(MIN_INTERVAL_HOURS, MAX_INTERVAL_HOURS)

    /**
     * True when enough time has passed since [lastCheckAtMillis]. A never-checked device
     * (0) is always due, and a clock that moved backwards is treated as due rather than
     * blocking checks forever.
     */
    fun isDue(nowMillis: Long, lastCheckAtMillis: Long, cooldownMillis: Long): Boolean {
        if (lastCheckAtMillis <= 0L) return true
        if (nowMillis < lastCheckAtMillis) return true
        return nowMillis - lastCheckAtMillis >= cooldownMillis
    }
}
