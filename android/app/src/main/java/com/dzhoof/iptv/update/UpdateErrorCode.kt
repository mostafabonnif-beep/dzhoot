package com.dzhoof.iptv.update

/**
 * Stable, non-sensitive update error codes for the Android client.
 *
 * These mirror the server's central taxonomy
 * (`server/docs/ERROR_TAXONOMY.md`, `@dzhoof/shared/errors`): the same `code` values
 * are used in logs, crash reports and telemetry, so nothing downstream has to parse
 * user-facing text to decide whether to retry, block or ask the user to act.
 *
 * [userMessage] is what the UI shows (Arabic-first); the server side of the same code
 * carries the matching `userMessageKey`.
 */
enum class UpdateErrorCode(
    /** Whether repeating the same operation can plausibly succeed. */
    val retryable: Boolean,
    /** User-facing Arabic message. Never contains technical detail or a stack trace. */
    val userMessage: String,
) {
    /** The update check itself failed (network or release provider unavailable). */
    UPDATE_CHECK_NETWORK(true, "تعذر الاتصال بالخادم للتحقق من التحديث"),

    /** The offered release is missing, malformed or points somewhere untrusted. */
    UPDATE_METADATA_INVALID(false, "لا يتوفر رابط للتنزيل"),

    /** The APK download did not complete. */
    UPDATE_DOWNLOAD_FAILED(true, "فشل تنزيل التحديث"),

    /** The downloaded file's SHA-256 does not match the published checksum. */
    UPDATE_CHECKSUM_MISMATCH(true, "ملف التحديث تالف — البصمة لا تتطابق"),

    /** The APK is not signed with the certificate of the installed application. */
    UPDATE_SIGNATURE_MISMATCH(false, "تعذر التحقق من التحديث — لا تتطابق التوقيعات"),

    /** The downloaded APK is not this application, or is not the expected build. */
    UPDATE_PACKAGE_MISMATCH(false, "ملف التحديث لا يخص هذا التطبيق"),

    /** The offered build is not newer than the installed one (no downgrades). */
    UPDATE_DOWNGRADE_BLOCKED(false, "الإصدار المتوفر أقدم من الإصدار المثبّت"),

    /** This device cannot install the offered build through the automatic path. */
    UPDATE_NOT_SUPPORTED(false, "لا يمكن تثبيت التحديث تلقائيًا على هذا الجهاز"),

    /** Android requires the user to approve installing from this source / the prompt. */
    UPDATE_USER_ACTION_REQUIRED(true, "اسمح للتطبيق بتثبيت التحديثات من هذا المصدر، ثم أعد المحاولة"),

    /** Not enough free storage to stage or install the APK. */
    UPDATE_STORAGE_INSUFFICIENT(true, "لا توجد مساحة كافية لتثبيت التحديث"),

    /** PackageInstaller reported a failure. */
    UPDATE_INSTALL_FAILED(true, "تعذر تثبيت التحديث"),

    /** The backend API was unreachable or returned an unusable response. */
    API_UNAVAILABLE(true, "الخدمة غير متاحة حاليًا"),
}
