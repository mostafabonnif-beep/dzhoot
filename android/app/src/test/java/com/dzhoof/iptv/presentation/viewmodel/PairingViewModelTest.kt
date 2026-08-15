package com.dzhoof.iptv.presentation.viewmodel

import android.content.Context
import com.dzhoof.iptv.MainDispatcherRule
import com.dzhoof.iptv.data.AppPreferences
import com.dzhoof.iptv.data.PinnedHttpClient
import com.dzhoof.iptv.presentation.ui.player.isTvDevice
import com.google.zxing.qrcode.QRCodeWriter
import io.mockk.any
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkConstructor
import io.mockk.mockkObject
import io.mockk.mockkStatic
import io.mockk.unmockkConstructor
import io.mockk.unmockkObject
import io.mockk.unmockkStatic
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class PairingViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val context: Context = mockk(relaxed = true)

    @Before
    fun setUp() {
        mockkObject(AppPreferences, PinnedHttpClient)
        mockkStatic("com.dzhoof.iptv.presentation.ui.player.DeviceUtilsKt")
        mockkConstructor(QRCodeWriter::class)
        every { AppPreferences.getServerUrl(context) } returns "https://dzhoof.example"
        every { isTvDevice(context) } returns false
    }

    @After
    fun tearDown() {
        unmockkObject(AppPreferences, PinnedHttpClient)
        unmockkStatic("com.dzhoof.iptv.presentation.ui.player.DeviceUtilsKt")
        unmockkConstructor(QRCodeWriter::class)
    }

    @Test
    fun `connection failure exposes retry state`() = runTest {
        every { PinnedHttpClient.post(any(), any(), any()) } throws IOException("offline")

        val viewModel = PairingViewModel(context)
        advanceUntilIdle()

        assertEquals("خطأ في الاتصال: offline", viewModel.uiState.value.statusMessage)
        assertTrue(viewModel.uiState.value.showRetryButton)
        assertEquals(false, viewModel.uiState.value.isLoading)
    }

    @Test
    fun `server rejection exposes the returned pairing error`() = runTest {
        every { PinnedHttpClient.post(any(), any(), any()) } returns response(
            200,
            "{\"success\":false,\"error\":\"الخادم مشغول\"}",
        )

        val viewModel = PairingViewModel(context)
        advanceUntilIdle()

        assertEquals("تعذر إنشاء PIN: الخادم مشغول", viewModel.uiState.value.statusMessage)
        assertTrue(viewModel.uiState.value.showRetryButton)
    }

    @Test
    fun `successful request publishes PIN and pairing URL`() = runTest {
        every { PinnedHttpClient.post(any(), any(), any()) } returns response(
            200,
            "{\"success\":true,\"pin\":\"123456\",\"expiresAt\":\"2000-01-01T00:00:00.000Z\"}",
        )

        val viewModel = PairingViewModel(context)
        advanceUntilIdle()

        assertEquals("123456", viewModel.uiState.value.pin)
        assertEquals("https://dzhoof.example/pair?pin=123456", viewModel.uiState.value.pairingUrl)
        assertEquals(false, viewModel.uiState.value.isLoading)
        assertEquals(false, viewModel.uiState.value.showCountdown)
    }

    private fun response(code: Int, body: String): Response =
        Response.Builder()
            .request(Request.Builder().url("https://dzhoof.example").build())
            .protocol(Protocol.HTTP_1_1)
            .code(code)
            .message("OK")
            .body(body.toResponseBody("application/json".toMediaType()))
            .build()
}
