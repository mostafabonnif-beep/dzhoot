package com.dzhoof.iptv.presentation.util

import java.util.Locale

private const val ACTIVATION_CODE_MAX_CHARS = 16

fun normalizeActivationCodeInput(raw: String): String {
    val compact = raw
        .uppercase(Locale.ROOT)
        .filter(Char::isLetterOrDigit)
        .take(ACTIVATION_CODE_MAX_CHARS)

    return compact.chunked(4).joinToString("-")
}
