package com.dzhoof.iptv.domain.usecase

import com.dzhoof.iptv.data.model.Result
import com.dzhoof.iptv.domain.repository.FavoriteRepository
import javax.inject.Inject

class PullFavoritesUseCase @Inject constructor(
    private val repository: FavoriteRepository
) : UseCase<Unit, Result<Unit>>() {

    override suspend fun execute(params: Unit): Result<Unit> {
        return repository.pullFavoritesFromServer()
    }
}
