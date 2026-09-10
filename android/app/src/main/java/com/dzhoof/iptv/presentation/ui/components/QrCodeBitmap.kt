package com.dzhoof.iptv.presentation.ui.components

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter

/**
 * The app's single QR generator.
 *
 * Three screens had grown their own copy of this loop (pairing, channel
 * manager, add-source) with the same 512px RGB_565 output; keeping one
 * implementation means one place to fix if encoding ever changes.
 *
 * Returns null when the payload cannot be encoded, so callers simply render
 * their layout without a code instead of crashing.
 */
fun qrCodeBitmap(text: String, size: Int = DEFAULT_QR_SIZE): Bitmap? = try {
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size)
    val width = matrix.width
    val height = matrix.height
    Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565).apply {
        for (x in 0 until width) {
            for (y in 0 until height) {
                setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
            }
        }
    }
} catch (_: Exception) {
    null
}

/** 512px matches what the shipped QR panels were already rendering. */
const val DEFAULT_QR_SIZE = 512
