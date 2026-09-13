package com.dzhoof.iptv.update

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/** Binds the update-pipeline interfaces to their production implementations. */
@Module
@InstallIn(SingletonComponent::class)
abstract class UpdateModule {

    @Binds
    @Singleton
    abstract fun bindUpdateRepository(impl: AppUpdaterUpdateRepository): UpdateRepository

    @Binds
    @Singleton
    abstract fun bindUpdateCheckStore(impl: AppPreferencesUpdateCheckStore): UpdateCheckStore
}
