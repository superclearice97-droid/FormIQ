package io.github.superclearice97.formiq

import android.content.Intent
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

/** Opened by Health Connect to show how FormIQ uses health data. */
class PrivacyActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val web = WebView(this)
        val loader = assetLoader(this)
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = loader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == APP_HOST) {
                    if (request.url.path?.endsWith("index.html") == true) { startActivity(Intent(this@PrivacyActivity, MainActivity::class.java)); finish(); return true }
                    return false
                }
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) {}
                return true
            }
        }
        setContentView(web)
        web.loadUrl("$APP_ORIGIN/assets/www/privacy.html")
    }
}
