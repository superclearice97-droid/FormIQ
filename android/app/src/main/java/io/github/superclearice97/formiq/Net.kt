package io.github.superclearice97.formiq

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

/** Strava requests made by the app itself (not limited by browser cross-site rules). Only strava.com is allowed. */
object Net {
    suspend fun strava(a: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val url = a.getString("url")
        if (!url.startsWith("https://www.strava.com/")) throw BridgeError("SecurityError", "Not allowed.")
        val conn = URL(url).openConnection() as HttpsURLConnection
        conn.requestMethod = a.optString("method", "GET")
        conn.connectTimeout = 15000; conn.readTimeout = 30000
        conn.setRequestProperty("Accept", "application/json")
        a.optJSONObject("headers")?.let { h -> h.keys().forEach { k -> conn.setRequestProperty(k, h.getString(k)) } }
        val body = a.optJSONObject("body")
        if (body != null) {
            conn.doOutput = true
            val bytes: ByteArray
            when (body.optString("type")) {
                "form" -> {
                    val f = body.getJSONObject("fields")
                    bytes = f.keys().asSequence().joinToString("&") { k -> URLEncoder.encode(k, "UTF-8") + "=" + URLEncoder.encode(f.getString(k), "UTF-8") }.toByteArray()
                    conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                }
                "multipart" -> {
                    val boundary = "formiq-" + UUID.randomUUID()
                    val out = ByteArrayOutputStream()
                    fun line(s: String) = out.write((s + "\r\n").toByteArray())
                    val f = body.optJSONObject("fields") ?: JSONObject()
                    for (k in f.keys()) { line("--$boundary"); line("Content-Disposition: form-data; name=\"$k\""); line(""); line(f.getString(k)) }
                    body.optJSONObject("file")?.let { file ->
                        line("--$boundary")
                        line("Content-Disposition: form-data; name=\"${file.getString("field")}\"; filename=\"${file.getString("name")}\"")
                        line("Content-Type: ${file.optString("mime", "application/octet-stream")}"); line("")
                        out.write(file.getString("text").toByteArray()); line("")
                    }
                    line("--$boundary--")
                    bytes = out.toByteArray()
                    conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
                }
                else -> throw BridgeError("Error", "Unsupported request.")
            }
            conn.outputStream.use { it.write(bytes) }
        }
        val code = conn.responseCode
        val text = (if (code in 200..399) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        conn.disconnect()
        JSONObject().put("status", code).put("body", text)
    }
}
