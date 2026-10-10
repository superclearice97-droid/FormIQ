package io.github.superclearice97.formiq

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.app.KeyguardManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import android.speech.tts.TextToSpeech
import android.view.WindowManager
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.Locale

class BridgeError(val kind: String, message: String) : Exception(message)

const val APP_HOST = "appassets.androidplatform.net"
const val APP_ORIGIN = "https://$APP_HOST"
const val APP_URL = "$APP_ORIGIN/assets/www/index.html"
const val PUBLIC_URL = "https://superclearice97-droid.github.io/FormIQ/"

/** Serves the bundled web app with the right content types (ES modules and WebAssembly need them). */
class AssetHandler(private val context: Context) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse? {
        if (path.contains("..")) return null
        return try {
            val stream = context.assets.open(path)
            val ext = path.substringAfterLast('.', "").lowercase(Locale.ROOT)
            val mime = when (ext) {
                "html" -> "text/html"; "js", "mjs" -> "text/javascript"; "css" -> "text/css"; "json" -> "application/json"
                "wasm" -> "application/wasm"; "woff2" -> "font/woff2"; "png" -> "image/png"; "svg" -> "image/svg+xml"
                else -> "application/octet-stream"
            }
            WebResourceResponse(mime, if (mime.startsWith("text/")) "utf-8" else null, stream)
        } catch (e: IOException) { null }
    }
}

fun assetLoader(context: Context): WebViewAssetLoader =
    WebViewAssetLoader.Builder().setDomain(APP_HOST).addPathHandler("/assets/", AssetHandler(context)).build()

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private var proxy: JavaScriptReplyProxy? = null
    private lateinit var ble: Ble
    private lateinit var health: Health
    private lateinit var steps: Steps
    private var tts: TextToSpeech? = null
    private val prefs by lazy { getSharedPreferences("formiq", MODE_PRIVATE) }
    private var unlocked = CompletableDeferred<Unit>()
    private var cover: LinearLayout? = null
    private var stoppedAt = 0L
    private val lockOn get() = prefs.getBoolean("lock", false)

    private var permWait: CompletableDeferred<Map<String, Boolean>>? = null
    private val permLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permWait?.complete(it); permWait = null }
    private var createWait: CompletableDeferred<Uri?>? = null
    private val createLauncher = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { createWait?.complete(it); createWait = null }
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val pickLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val uris = mutableListOf<Uri>()
        val data = r.data
        if (r.resultCode == RESULT_OK && data != null) {
            val clip = data.clipData
            if (clip != null) for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri)
            else data.data?.let { uris.add(it) }
        }
        fileCallback?.onReceiveValue(uris.toTypedArray()); fileCallback = null
    }
    private var photoUri: Uri? = null
    private val photoLauncher = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val u = photoUri
        fileCallback?.onReceiveValue(if (ok && u != null) arrayOf(u) else arrayOf()); fileCallback = null
    }
    private var hcWait: CompletableDeferred<Set<String>>? = null
    private val hcLauncher = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { hcWait?.complete(it); hcWait = null }
    private var btWait: CompletableDeferred<Boolean>? = null
    private val btLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { btWait?.complete(it.resultCode == RESULT_OK); btWait = null }

    suspend fun requestPerms(perms: Array<String>): Boolean {
        val missing = perms.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) return true
        val d = CompletableDeferred<Map<String, Boolean>>(); permWait = d
        permLauncher.launch(missing.toTypedArray())
        return d.await().values.all { it }
    }
    suspend fun requestHealth(perms: Set<String>): Set<String> {
        val d = CompletableDeferred<Set<String>>(); hcWait = d; hcLauncher.launch(perms); return d.await()
    }
    @SuppressLint("MissingPermission")
    suspend fun enableBluetooth(): Boolean {
        val d = CompletableDeferred<Boolean>(); btWait = d
        return try { btLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)); d.await() } catch (e: Exception) { btWait = null; false }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        File(cacheDir, "photos").deleteRecursively()              // never keep old meal photos
        if (lockOn) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val root = FrameLayout(this)
        root.filterTouchesWhenObscured = true                     // ignore taps through overlays from other apps
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)
        if (lockOn) showCover(root) else unlocked.complete(Unit)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            v.setPadding(b.left, b.top, b.right, b.bottom); WindowInsetsCompat.CONSUMED
        }

        ble = Ble(this) { name, obj -> event(name, obj) }
        health = Health(this)
        steps = Steps(this)

        val loader = assetLoader(this)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            setGeolocationEnabled(false)
            saveFormData = false
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = loader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = route(request.url)
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                if (request.origin.host != APP_HOST || !request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) { request.deny(); return }
                lifecycleScope.launch {
                    if (requestPerms(arrayOf(Manifest.permission.CAMERA))) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
                }
            }
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null); fileCallback = cb
                val accept = params.acceptTypes.joinToString(",").lowercase(Locale.ROOT)
                if (params.isCaptureEnabled && accept.contains("image")) {
                    lifecycleScope.launch {
                        if (requestPerms(arrayOf(Manifest.permission.CAMERA))) {
                            val dir = File(cacheDir, "photos").apply { mkdirs() }
                            dir.listFiles()?.forEach { it.delete() }   // keep no old meal photos around
                            val f = File(dir, "meal-${System.currentTimeMillis()}.jpg")
                            val u = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", f)
                            photoUri = u; photoLauncher.launch(u)
                        } else { fileCallback?.onReceiveValue(null); fileCallback = null }
                    }
                    return true
                }
                val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    val mimes = mimeTypes(params.acceptTypes)
                    type = if (mimes.size == 1) mimes[0] else "*/*"
                    if (mimes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, mimes.toTypedArray())
                    if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
                return try { pickLauncher.launch(i); true } catch (e: Exception) { fileCallback = null; false }
            }
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            // Only the bundled app (not Strava's sign-in pages or any other site) can talk to the phone's features
            WebViewCompat.addWebMessageListener(web, "FormIQBridge", setOf(APP_ORIGIN)) { _, message, _, isMainFrame, replyProxy ->
                if (!isMainFrame) return@addWebMessageListener
                proxy = replyProxy
                val data = message.data ?: return@addWebMessageListener
                lifecycleScope.launch { handle(data) }
            }
        }

        onBackPressedDispatcher.addCallback(this) { if (web.canGoBack()) web.goBack() else finish() }
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(APP_URL)
    }

    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web.saveState(outState) }
    override fun onResume() { super.onResume(); event("resume", JSONObject()) }
    override fun onStop() { super.onStop(); stoppedAt = SystemClock.elapsedRealtime() }
    override fun onStart() {
        super.onStart()
        if (lockOn && stoppedAt > 0 && SystemClock.elapsedRealtime() - stoppedAt > 30_000 && cover == null) showCover(web.parent as FrameLayout)
    }

    /* ---------- app lock: fingerprint, face or screen lock ---------- */
    private fun authenticators() = if (Build.VERSION.SDK_INT >= 30) BIOMETRIC_WEAK or DEVICE_CREDENTIAL else BIOMETRIC_WEAK
    private fun canLock(): Boolean =
        BiometricManager.from(this).canAuthenticate(authenticators()) == BiometricManager.BIOMETRIC_SUCCESS ||
            (Build.VERSION.SDK_INT < 30 && getSystemService(KeyguardManager::class.java)?.isDeviceSecure == true)

    @Suppress("DEPRECATION")
    private suspend fun authenticate(title: String): Boolean = suspendCancellableCoroutine { cont ->
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { if (cont.isActive) cont.resume(true) }
            override fun onAuthenticationError(code: Int, msg: CharSequence) { if (cont.isActive) cont.resume(false) }
        })
        val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).setSubtitle("Use your fingerprint, face or screen lock")
            .apply { if (Build.VERSION.SDK_INT >= 30) setAllowedAuthenticators(authenticators()) else setDeviceCredentialAllowed(true) }
            .build()
        prompt.authenticate(info)
    }

    private fun showCover(root: FrameLayout) {
        val dark = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
        val v = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; isClickable = true
            setBackgroundColor(if (dark) Color.parseColor("#0e1311") else Color.parseColor("#f3f5f4"))
            addView(TextView(context).apply { text = "FormIQ is locked"; textSize = 24f; gravity = Gravity.CENTER; setTextColor(if (dark) Color.WHITE else Color.parseColor("#15201b")) })
            addView(Button(context).apply { text = "Unlock"; setOnClickListener { lifecycleScope.launch { unlock() } } })
        }
        root.addView(v, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        cover = v
        lifecycleScope.launch { unlock() }
    }
    private suspend fun unlock() {
        if (authenticate("Unlock FormIQ")) { cover?.let { (it.parent as? FrameLayout)?.removeView(it) }; cover = null; unlocked.complete(Unit) }
    }
    override fun onDestroy() { tts?.shutdown(); ble.closeAll(); web.destroy(); super.onDestroy() }

    private fun mimeTypes(accept: Array<String>): List<String> {
        val out = linkedSetOf<String>()
        for (raw in accept.flatMap { it.split(",") }.map { it.trim().lowercase(Locale.ROOT) }.filter { it.isNotEmpty() }) {
            when {
                raw.startsWith("image/") || raw.startsWith("video/") -> out.add(raw)
                // zip, xml and csv files are often labelled loosely by phones, so allow any file for these
                else -> return listOf("*/*")
            }
        }
        return if (out.isEmpty()) listOf("*/*") else out.toList()
    }

    private fun route(url: Uri): Boolean {
        val s = url.toString()
        if (url.host == APP_HOST) return false
        if (s.startsWith(PUBLIC_URL) && (url.getQueryParameter("code") != null || url.getQueryParameter("error") != null)) {
            web.loadUrl("$APP_URL?${url.encodedQuery}#activity"); return true      // Strava sign-in finished: back to the app
        }
        if (url.host?.endsWith("strava.com") == true) return false               // Strava sign-in pages stay in the app
        if (url.scheme == "https" || url.scheme == "http") {
            try { startActivity(Intent(Intent.ACTION_VIEW, url)) } catch (_: Exception) {}
        }
        return true
    }

    /* ---------- bridge ---------- */
    private fun reply(id: Int, result: Any?) =
        proxy?.postMessage(JSONObject().put("id", id).put("ok", true).put("result", result ?: JSONObject.NULL).toString())
    private fun fail(id: Int, msg: String, kind: String) =
        proxy?.postMessage(JSONObject().put("id", id).put("ok", false).put("error", msg).put("name", kind).toString())
    fun event(name: String, obj: JSONObject) = runOnUiThread { try { proxy?.postMessage(obj.put("event", name).toString()) } catch (_: Exception) {} }

    private suspend fun handle(raw: String) {
        val m = try { JSONObject(raw) } catch (e: Exception) { return }
        val id = m.optInt("id")
        val a = m.optJSONObject("args") ?: JSONObject()
        try {
            val result: Any? = when (m.optString("method")) {
                "hello" -> JSONObject().put("version", BuildConfig.VERSION_NAME).put("code", BuildConfig.VERSION_CODE)
                "secureKey" -> { unlocked.await(); withContext(Dispatchers.Default) { val k = Vault.dataKey(this@MainActivity); val s = android.util.Base64.encodeToString(k, android.util.Base64.NO_WRAP); k.fill(0); s } }
                "lockStatus" -> JSONObject().put("available", canLock()).put("on", lockOn)
                "lockSet" -> {
                    val on = a.optBoolean("on")
                    if (on && !canLock()) throw BridgeError("NotSupportedError", "Set a screen lock on your phone first.")
                    if (!authenticate(if (on) "Turn on FormIQ lock" else "Turn off FormIQ lock")) throw BridgeError("NotAllowedError", "Not confirmed.")
                    prefs.edit().putBoolean("lock", on).apply()
                    if (on) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    JSONObject().put("available", true).put("on", on)
                }
                "saveFile" -> saveFile(a.getString("name"), a.getString("text"))
                "speak" -> { speak(a.optString("text")); null }
                "speakStop" -> { tts?.stop(); null }
                "keepAwake" -> { if (a.optBoolean("on")) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); null }
                "openUrl" -> { val u = a.getString("url"); if (u.startsWith("https://")) startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))); null }
                "bleRequest" -> ble.request(strings(a.getJSONArray("services")))
                "bleConnect" -> { ble.connect(a.getString("dev")); null }
                "bleHasService" -> ble.hasService(a.getString("dev"), a.getString("svc"))
                "bleHasChar" -> ble.hasChar(a.getString("dev"), a.getString("svc"), a.getString("chr"))
                "bleNotify" -> { ble.notify(a.getString("dev"), a.getString("svc"), a.getString("chr"), a.optBoolean("on", true)); null }
                "bleRead" -> ble.read(a.getString("dev"), a.getString("svc"), a.getString("chr"))
                "bleWrite" -> { ble.write(a.getString("dev"), a.getString("svc"), a.getString("chr"), a.getString("b64"), a.optBoolean("resp", true)); null }
                "bleDisconnect" -> { ble.disconnect(a.getString("dev")); null }
                "stepsStatus" -> steps.status()
                "stepsEnable" -> steps.enable()
                "stepsDisable" -> steps.disable()
                "stepsRead" -> steps.read(a.optInt("days", 10))
                "hcStatus" -> health.status()
                "hcConnect" -> health.connect()
                "hcRead" -> health.read(a.optInt("days", 30))
                "hcWrite" -> { health.write(a); null }
                "hcDisconnect" -> { health.disconnect(); health.status() }
                "stravaFetch" -> Net.strava(a)
                "wipe" -> {
                    try { steps.disable() } catch (_: Exception) {}
                    try { health.disconnect() } catch (_: Exception) {}
                    Vault.destroy(this)
                    WebStorage.getInstance().deleteAllData()
                    CookieManager.getInstance().removeAllCookies(null)
                    web.clearCache(true); web.clearHistory()
                    withContext(Dispatchers.IO) { cacheDir.deleteRecursively() }
                    prefs.edit().clear().commit()
                    window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    null
                }
                else -> throw BridgeError("NotSupportedError", "Unknown request")
            }
            if (id != 0) reply(id, result)
        } catch (e: BridgeError) { if (id != 0) fail(id, e.message ?: "Failed", e.kind) }
        catch (e: Exception) { if (id != 0) fail(id, e.message ?: "Failed", "Error") }
    }

    private fun strings(arr: JSONArray) = (0 until arr.length()).map { arr.getString(it) }

    private suspend fun saveFile(name: String, text: String): Boolean {
        val d = CompletableDeferred<Uri?>(); createWait = d
        createLauncher.launch(name)
        val uri = d.await() ?: return false
        withContext(Dispatchers.IO) { contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) } }
        return true
    }

    private fun speak(text: String) {
        val t = tts
        if (t == null) {
            tts = TextToSpeech(this) { status -> if (status == TextToSpeech.SUCCESS) tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "formiq") }
        } else t.speak(text, TextToSpeech.QUEUE_FLUSH, null, "formiq")
    }

    @Suppress("unused")
    private fun ext(name: String) = MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.'))
}
