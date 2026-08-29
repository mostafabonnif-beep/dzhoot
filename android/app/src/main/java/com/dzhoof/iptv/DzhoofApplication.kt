package com.dzhoof.iptv

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.dzhoof.iptv.crash.CrashReporter
import com.dzhoof.iptv.worker.WorkManagerInitializer
import com.google.firebase.crashlytics.FirebaseCrashlytics
import dagger.hilt.android.HiltAndroidApp
import io.sentry.SentryEvent
import io.sentry.SentryOptions
import io.sentry.android.core.SentryAndroid
import javax.inject.Inject

@HiltAndroidApp
class DzhoofApplication : Application(), Configuration.Provider {

    @Inject lateinit var workerFactory: HiltWorkerFactory

    // On-demand WorkManager init wired with Hilt's worker factory so @HiltWorker
    // workers (channel + EPG sync) can be instantiated.
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()

    override fun onCreate() {
        super.onCreate()
        instance = this

        // Capture every uncaught exception locally and upload it to the DZ HOOF
        // API on the next launch. Firebase/Sentry are not wired for production
        // builds, so this is the only crash visibility we have.
        Thread.setDefaultUncaughtExceptionHandler(
            CrashReporter(this, Thread.getDefaultUncaughtExceptionHandler()),
        )
        Thread {
            CrashReporter.uploadPending(applicationContext)
        }.start()

        if (BuildConfig.FIREBASE_ENABLED) {
            runCatching {
                FirebaseCrashlytics.getInstance().setCrashlyticsCollectionEnabled(!BuildConfig.DEBUG)
            }
        }

        // Filter out noisy Sentry HTTP client errors from health scan / thumbnail extraction.
        // These OkHttp clients hit hundreds of external stream URLs where 4xx/5xx is expected.
        SentryAndroid.init(this) { options: SentryOptions ->
            options.beforeSend = SentryOptions.BeforeSendCallback { event, _ ->
                val exType = event.exceptions?.firstOrNull()?.type ?: ""
                if (exType == "SentryHttpClientException") null else event
            }
        }

        WorkManagerInitializer.scheduleChannelSync(this)
        WorkManagerInitializer.scheduleEpgSync(this)
    }

    companion object {
        private lateinit var instance: DzhoofApplication

        @JvmStatic
        fun getAppContext() = instance.applicationContext
    }
}
