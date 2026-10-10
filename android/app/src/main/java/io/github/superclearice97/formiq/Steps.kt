package io.github.superclearice97.formiq

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.fitness.FitnessLocal
import com.google.android.gms.fitness.LocalRecordingClient
import com.google.android.gms.fitness.data.LocalDataType
import com.google.android.gms.fitness.request.LocalDataReadRequest
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit

/** All-day steps with Google Play services' on-device Recording API: no account, no cloud, low battery use. */
class Steps(private val act: MainActivity) {
    private val prefs = act.getSharedPreferences("formiq", Context.MODE_PRIVATE)
    private val client by lazy { FitnessLocal.getLocalRecordingClient(act) }

    private fun available() = try {
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(act, LocalRecordingClient.LOCAL_RECORDING_CLIENT_MIN_VERSION_CODE) == ConnectionResult.SUCCESS
    } catch (e: Exception) { false }
    private fun permitted() = Build.VERSION.SDK_INT < 29 ||
        ContextCompat.checkSelfPermission(act, Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED

    fun status(): JSONObject = JSONObject().put("available", available()).put("permission", permitted()).put("enabled", prefs.getBoolean("steps", false) && permitted())

    suspend fun enable(): JSONObject {
        if (!available()) throw BridgeError("NotSupportedError", "All-day steps need Google Play services, which this phone doesn't have.")
        if (Build.VERSION.SDK_INT >= 29 && !act.requestPerms(arrayOf(Manifest.permission.ACTIVITY_RECOGNITION)))
            throw BridgeError("NotAllowedError", "Physical activity permission wasn't given. You can allow it for FormIQ in Settings.")
        client.subscribe(LocalDataType.TYPE_STEP_COUNT_DELTA).await()
        prefs.edit().putBoolean("steps", true).apply()
        return status()
    }

    suspend fun disable(): JSONObject {
        if (available()) try { client.unsubscribe(LocalDataType.TYPE_STEP_COUNT_DELTA).await() } catch (_: Exception) {}
        prefs.edit().putBoolean("steps", false).apply()
        return status()
    }

    suspend fun read(days: Int): JSONObject {
        val out = JSONObject()
        if (!available() || !permitted() || !prefs.getBoolean("steps", false)) return out
        val zone = ZoneId.systemDefault()
        val end = ZonedDateTime.now(zone)
        val start = end.toLocalDate().minusDays((minOf(days, 10) - 1).toLong()).atStartOfDay(zone)   // the phone keeps 10 days
        val req = LocalDataReadRequest.Builder()
            .aggregate(LocalDataType.TYPE_STEP_COUNT_DELTA)
            .bucketByTime(1, TimeUnit.DAYS)
            .setTimeRange(start.toEpochSecond(), end.toEpochSecond(), TimeUnit.SECONDS)
            .build()
        val resp = client.readData(req).await()
        for (bucket in resp.buckets) {
            var total = 0L
            for (ds in bucket.dataSets) for (dp in ds.dataPoints) for (field in dp.dataType.fields) total += dp.getValue(field).asInt()
            val day = Instant.ofEpochMilli(bucket.getStartTime(TimeUnit.MILLISECONDS)).atZone(zone).toLocalDate().toString()
            out.put(day, out.optLong(day) + total)
        }
        return out
    }
}
