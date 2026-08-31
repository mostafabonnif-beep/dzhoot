package com.dzhoof.iptv.crash

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.Settings
import android.util.Log
import com.dzhoof.iptv.BuildConfig
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONArray
import org.json.JSONObject

/**
 * Queues uncaught exceptions to disk and uploads them to the DZ HOOF API on the
 * next app launch. Chained behind the platform handler so the OS still
 * terminates the app normally. Never does network I/O from the crashing thread
 * (a crash handler must stay fast and safe), so the payload is persisted first
 * and drained on the next cold start.
 *
 * This is the app-side half of `POST /api/v1/app/crash-report` — Firebase and
 * Sentry are not configured for production builds (no google-services.json / no
 * DSN), so without this reporter every crash is invisible to the operator.
 */
class CrashReporter(
    private val context: Context,
    private val previous: Thread.UncaughtExceptionHandler?,
) : Thread.UncaughtExceptionHandler {

    override fun uncaughtException(thread: Thread, throwable: Throwable) {
        // The OS handler is always invoked so the process still dies normally.
        runCatching { queue(thread, throwable) }
        previous?.uncaughtException(thread, throwable)
    }

    private fun queue(thread: Thread, throwable: Throwable) {
        val entry = buildReport(context, thread, throwable)
        val queueFile = crashQueueFile(context)
        val list = runCatching {
            JSONArray(queueFile.readText())
        }.getOrElse { JSONArray() }
        if (list.length() >= MAX_QUEUED) list.remove(0)
        list.put(entry)
        queueFile.writeText(list.toString())
        Log.w(TAG, "Crash queued: ${entry.optString("exceptionType")} — ${entry.optString("exceptionMessage")}")
    }

    companion object {
        private const val TAG = "CrashReporter"
        private const val MAX_QUEUED = 20
        private const val MAX_STACK_CHARS = 40000

        fun crashQueueFile(context: Context): File =
            File(context.filesDir, "crashqueue.json")

        fun buildReport(context: Context, thread: Thread, throwable: Throwable): JSONObject {
            val report = JSONObject()
            report.put("deviceId", deviceId(context))
            report.put("appVersion", BuildConfig.VERSION_NAME)
            report.put("appVersionCode", BuildConfig.VERSION_CODE)
            report.put("platform", "android")
            report.put("deviceModel", Build.MODEL)
            report.put("deviceBrand", Build.BRAND ?: Build.MANUFACTURER)
            report.put("androidVersion", Build.VERSION.RELEASE)
            report.put("sdkInt", Build.VERSION.SDK_INT)

            val memory = ActivityManager.MemoryInfo()
            val activityManager =
                context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            if (activityManager != null) {
                runCatching { activityManager.getMemoryInfo(memory) }
            }
            report.put("totalRamMb", memory.totalMem / 1024 / 1024)
            report.put("freeRamMb", memory.availMem / 1024 / 1024)

            val storage = runCatching {
                val stat = StatFs(Environment.getDataDirectory().path)
                stat.availableBytes / 1024 / 1024
            }.getOrDefault(-1)
            report.put("freeStorageMb", storage)

            report.put("exceptionType", throwable.javaClass.name)
            report.put("exceptionMessage", throwable.message?.take(1000))
            report.put("stackTrace", stackTraceWithCauses(throwable).take(MAX_STACK_CHARS))
            report.put("threadName", thread.name)
            return report
        }

        private fun stackTraceWithCauses(throwable: Throwable): String {
            val writer = StringWriter()
            val printer = PrintWriter(writer)
            var current: Throwable? = throwable
            while (current != null) {
                if (current !== throwable) printer.append("Caused by: ")
                current.printStackTrace(printer)
                current = current.cause
            }
            return writer.toString()
        }

        private fun deviceId(context: Context): String {
            val androidId = runCatching {
                Settings.Secure.getString(
                    context.contentResolver,
                    Settings.Secure.ANDROID_ID,
                )
            }.getOrNull().orEmpty()
            return if (androidId.isBlank()) "dzhoof-device" else "dz-${androidId.take(16)}"
        }

        /**
         * Drains the crash queue, uploading every pending report. Called once on
         * each cold start from [com.dzhoof.iptv.DzhoofApplication]. Never throws.
         */
        fun uploadPending(context: Context) {
            val queueFile = crashQueueFile(context)
            val list = runCatching {
                JSONArray(queueFile.readText())
            }.getOrNull() ?: return
            if (list.length() == 0) return

            val remaining = JSONArray()
            var changed = false
            for (index in 0 until list.length()) {
                val entry = list.optJSONObject(index) ?: continue
                changed = true
                if (!post(context, entry)) remaining.put(entry)
            }
            if (changed) {
                runCatching { queueFile.writeText(remaining.toString()) }
            }
        }

        private fun post(context: Context, entry: JSONObject): Boolean {
            val base = BuildConfig.API_BASE_URL.trimEnd('/')
            val body = entry.toString().toByteArray(Charsets.UTF_8)
            val connection = runCatching {
                val url = URL("$base/api/v1/app/crash-report")
                val opened = url.openConnection() as HttpURLConnection
                opened.requestMethod = "POST"
                opened.connectTimeout = 10_000
                opened.readTimeout = 10_000
                opened.doOutput = true
                opened.setRequestProperty("Content-Type", "application/json")
                opened.setRequestProperty(
                    "User-Agent",
                    "DZ-HOOF-Android/${BuildConfig.VERSION_NAME}",
                )
                opened.setFixedLengthStreamingMode(body.size)
                opened
            }.getOrElse { return false }

            return try {
                connection.outputStream.use { it.write(body) }
                val code = connection.responseCode
                code in 200..299
            } catch (_: Exception) {
                false
            } finally {
                runCatching { connection.disconnect() }
            }
        }
    }
}
