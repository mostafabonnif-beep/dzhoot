package com.dzhoof.iptv.di

import android.content.Context
import android.net.Uri
import com.dzhoof.iptv.BuildConfig
import com.dzhoof.iptv.data.AppPreferences
import com.dzhoof.iptv.data.source.remote.DzhoofApiService
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

/**
 * Hilt module providing networking dependencies.
 * 
 * This module configures OkHttp, Retrofit, and the API service with:
 * - Logging interceptor for debugging
 * - Timeout configurations
 * - Custom headers
 * - Network security (HTTPS only)
 * 
 * Requirements:
 * - TR-002: Update Dependencies (Retrofit 2.11.0, OkHttp 4.12.0)
 * - TR-012: Network Security (HTTPS only, timeout configurations)
 */
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    /**
     * Provides configured OkHttpClient with logging, timeouts, and headers.
     * 
     * Configuration:
     * - Connect timeout: 30 seconds
     * - Read timeout: 30 seconds
     * - Write timeout: 30 seconds
     * - Logging: BODY level in debug, NONE in release
     * - Custom headers: Accept: application/json
     * 
     * @return Configured OkHttpClient instance
     */
    @Provides
    @Singleton
    fun provideOkHttpClient(@ApplicationContext context: Context): OkHttpClient {
        // No certificate pinning: the managed server uses Let's Encrypt (leaf rotates
        // every ~90 days, which breaks a hardcoded pin), and BYO sources use arbitrary
        // hosts. Standard system-CA TLS validation still applies.
        return OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)

            .addInterceptor(
                HttpLoggingInterceptor().apply {
                    level = if (BuildConfig.DEBUG) {
                        HttpLoggingInterceptor.Level.HEADERS
                    } else {
                        HttpLoggingInterceptor.Level.NONE
                    }
                    redactHeader("X-TV-Code")
                }
            )

            .addInterceptor { chain ->
                val original = chain.request()
                val apiHost = Uri.parse(BuildConfig.API_BASE_URL).host
                val isManagedApiRequest = apiHost != null && original.url.host == apiHost
                val isPlaybackRequest = original.url.encodedPath.contains("/api/v1/tv/playback/")
                val builder = original.newBuilder()
                    // Manifests and segments are media, not JSON. Sending an
                    // API-only Accept header can make strict IPTV/CDN servers
                    // reject an otherwise valid stream.
                    .addHeader("Accept", if (isPlaybackRequest) "*/*" else "application/json")

                // Never leak the paired customer's credentials to a BYO source.
                // Managed playback requests still carry the headers required by
                // the server-side token/auth contract.
                if (isManagedApiRequest) {
                    val tvCode = AppPreferences.getTvCode(context)
                    val sessionId = AppPreferences.getSessionId(context)
                    builder.addHeader("X-TV-Code", tvCode)
                    if (sessionId.isNotBlank()) builder.addHeader("X-Session-Id", sessionId)
                    if (original.body != null) builder.addHeader("Content-Type", "application/json")
                }
                chain.proceed(builder.build())
            }

            .build()
    }

    /**
     * Provides configured Retrofit instance with base URL from BuildConfig.
     * 
     * Configuration:
     * - Base URL: From BuildConfig.API_BASE_URL
     * - Converter: Gson for JSON serialization/deserialization
     * - Client: Configured OkHttpClient
     * 
     * @param okHttpClient Configured OkHttpClient instance
     * @return Configured Retrofit instance
     */
    @Provides
    @Singleton
    fun provideRetrofit(okHttpClient: OkHttpClient): Retrofit {
        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    /**
     * Provides DzhoofApiService implementation.
     * 
     * This service interface defines all API endpoints for the DZ HOOF IPTV application.
     * Retrofit will generate the implementation at runtime.
     * 
     * @param retrofit Configured Retrofit instance
     * @return DzhoofApiService implementation
     */
    @Provides
    @Singleton
    fun provideDzhoofApiService(retrofit: Retrofit): DzhoofApiService {
        return retrofit.create(DzhoofApiService::class.java)
    }
}
