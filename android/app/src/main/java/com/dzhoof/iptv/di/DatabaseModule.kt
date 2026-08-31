package com.dzhoof.iptv.di

import android.content.Context
import androidx.room.Room
import com.dzhoof.iptv.data.source.local.DzhoofDatabase
import com.dzhoof.iptv.data.source.local.dao.CategoryDao
import com.dzhoof.iptv.data.source.local.dao.ChannelDao
import com.dzhoof.iptv.data.source.local.dao.ChannelHealthDao
import com.dzhoof.iptv.data.source.local.dao.EpgDao
import com.dzhoof.iptv.data.source.local.dao.FavoriteCategoryDao
import com.dzhoof.iptv.data.source.local.dao.FavoriteDao
import com.dzhoof.iptv.data.source.local.dao.PlaybackPositionDao
import com.dzhoof.iptv.data.source.local.dao.SearchHistoryDao
import com.dzhoof.iptv.data.source.local.dao.StreamMetricsDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module providing database-related dependencies.
 * Installed in SingletonComponent for app-wide availability.
 * 
 * This module provides:
 * - DzhoofDatabase singleton instance
 * - All DAO instances (ChannelDao, CategoryDao, FavoriteDao, SearchHistoryDao, PlaybackPositionDao)
 * 
 * Requirements: TR-003 (Architecture Modernization), TR-007 (Database Performance)
 */
@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): DzhoofDatabase {
        return Room.databaseBuilder(
            context,
            DzhoofDatabase::class.java,
            "firevision_db" // keep name for existing installs — do not rename
        )
            .addMigrations(
                DzhoofDatabase.MIGRATION_1_2,
                DzhoofDatabase.MIGRATION_2_3,
                DzhoofDatabase.MIGRATION_3_4,
                DzhoofDatabase.MIGRATION_4_5,
                DzhoofDatabase.MIGRATION_5_6,
                DzhoofDatabase.MIGRATION_6_7,
                DzhoofDatabase.MIGRATION_7_8,
                DzhoofDatabase.MIGRATION_8_9,
                DzhoofDatabase.MIGRATION_9_10
            )
            .build()
    }

    /**
     * Provides ChannelDao for channel data operations.
     * 
     * @param database DzhoofDatabase instance
     * @return ChannelDao instance
     */
    @Provides
    fun provideChannelDao(database: DzhoofDatabase): ChannelDao {
        return database.channelDao()
    }

    /**
     * Provides CategoryDao for category data operations.
     * 
     * @param database DzhoofDatabase instance
     * @return CategoryDao instance
     */
    @Provides
    fun provideCategoryDao(database: DzhoofDatabase): CategoryDao {
        return database.categoryDao()
    }

    /**
     * Provides FavoriteDao for favorite data operations.
     * 
     * @param database DzhoofDatabase instance
     * @return FavoriteDao instance
     */
    @Provides
    fun provideFavoriteDao(database: DzhoofDatabase): FavoriteDao {
        return database.favoriteDao()
    }

    /**
     * Provides SearchHistoryDao for search history data operations.
     * 
     * @param database DzhoofDatabase instance
     * @return SearchHistoryDao instance
     */
    @Provides
    fun provideSearchHistoryDao(database: DzhoofDatabase): SearchHistoryDao {
        return database.searchHistoryDao()
    }

    /**
     * Provides PlaybackPositionDao for playback position data operations.
     * 
     * @param database DzhoofDatabase instance
     * @return PlaybackPositionDao instance
     */
    @Provides
    fun providePlaybackPositionDao(database: DzhoofDatabase): PlaybackPositionDao {
        return database.playbackPositionDao()
    }

    @Provides
    fun provideChannelHealthDao(database: DzhoofDatabase): ChannelHealthDao {
        return database.channelHealthDao()
    }

    @Provides
    fun provideFavoriteCategoryDao(database: DzhoofDatabase): FavoriteCategoryDao {
        return database.favoriteCategoryDao()
    }

    @Provides
    fun provideStreamMetricsDao(database: DzhoofDatabase): StreamMetricsDao {
        return database.streamMetricsDao()
    }

    @Provides
    fun provideEpgDao(database: DzhoofDatabase): EpgDao {
        return database.epgDao()
    }
}
