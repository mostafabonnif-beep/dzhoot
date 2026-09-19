package com.dzhoof.iptv.di

import android.content.Context
import coil.ImageLoader
import coil.decode.SvgDecoder
import coil.disk.DiskCache
import coil.memory.MemoryCache
import coil.request.CachePolicy
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module for image loading optimization with Coil.
 */
@Module
@InstallIn(SingletonComponent::class)
object ImageLoadingModule {

    @Provides
    @Singleton
    fun provideImageLoader(
        @ApplicationContext context: Context
    ): ImageLoader {
        return ImageLoader.Builder(context)
            // Many IPTV providers serve channel logos as SVG. Coil has no SVG
            // support unless this decoder is registered, and without it those
            // logos fail silently and the card falls back to a placeholder.
            .components {
                add(SvgDecoder.Factory())
            }
            .memoryCache {
                MemoryCache.Builder(context)
                    .maxSizePercent(0.25)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(context.cacheDir.resolve("image_cache"))
                    .maxSizeBytes(50 * 1024 * 1024)
                    .build()
            }
            .memoryCachePolicy(CachePolicy.ENABLED)
            .diskCachePolicy(CachePolicy.ENABLED)
            .networkCachePolicy(CachePolicy.ENABLED)
            .crossfade(150)
            // RGB_565 only when the image is guaranteed opaque; PNG logos with
            // alpha (rendered over colored card backgrounds) keep ARGB_8888.
            .allowRgb565(true)
            .allowHardware(true)
            .build()
    }
}
