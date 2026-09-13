package com.dzhoof.iptv.update

import com.dzhoof.iptv.presentation.model.UpdateInfo
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The update data source: exactly one network round-trip, no policy decisions.
 *
 * Kept separate from [UpdateManager] so the scheduling/rate-limit rules can be unit
 * tested against a fake, with no HTTP, no Context and no WorkManager involved.
 */
interface UpdateRepository {

    sealed interface Result {
        data class Found(val update: UpdateInfo) : Result
        data object UpToDate : Result
        data class Failed(val code: UpdateErrorCode) : Result
    }

    /** Never throws: transport failures come back as [Result.Failed]. */
    suspend fun fetchAvailableUpdate(): Result
}

@Singleton
class AppUpdaterUpdateRepository @Inject constructor(
    private val appUpdater: AppUpdater,
) : UpdateRepository {

    override suspend fun fetchAvailableUpdate(): UpdateRepository.Result =
        when (val result = appUpdater.checkDetailed()) {
            is AppUpdater.CheckResult.Found -> UpdateRepository.Result.Found(result.update)
            AppUpdater.CheckResult.UpToDate -> UpdateRepository.Result.UpToDate
            is AppUpdater.CheckResult.Failed -> UpdateRepository.Result.Failed(result.code)
        }
}
