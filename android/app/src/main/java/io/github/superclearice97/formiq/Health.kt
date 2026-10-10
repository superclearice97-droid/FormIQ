package io.github.superclearice97.formiq

import android.content.Intent
import android.net.Uri
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Length
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.Period
import java.time.ZoneId

/** Health Connect: read daily steps and workouts from other apps, save FormIQ workouts. Only after the person connects it. */
class Health(private val act: MainActivity) {
    private val readSteps = HealthPermission.getReadPermission(StepsRecord::class)
    private val readExercise = HealthPermission.getReadPermission(ExerciseSessionRecord::class)
    private val writeExercise = HealthPermission.getWritePermission(ExerciseSessionRecord::class)
    private val writeDistance = HealthPermission.getWritePermission(DistanceRecord::class)
    private val perms = setOf(readSteps, readExercise, writeExercise, writeDistance)
    private val provider = "com.google.android.apps.healthdata"

    private fun sdk() = HealthConnectClient.getSdkStatus(act, provider)
    private fun client() = HealthConnectClient.getOrCreate(act, provider)

    suspend fun status(): JSONObject {
        val s = sdk()
        val o = JSONObject().put("status", when (s) {
            HealthConnectClient.SDK_AVAILABLE -> "available"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update"
            else -> "unavailable"
        })
        if (s == HealthConnectClient.SDK_AVAILABLE) {
            val g = client().permissionController.getGrantedPermissions()
            o.put("steps", readSteps in g).put("read", readExercise in g).put("write", writeExercise in g).put("connected", g.intersect(perms).isNotEmpty())
        }
        return o
    }

    suspend fun connect(): JSONObject {
        when (sdk()) {
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                try { act.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$provider&url=healthconnect%3A%2F%2Fonboarding"))) } catch (_: Exception) {}
                throw BridgeError("NotSupportedError", "Install or update Health Connect from the Play Store, then try again.")
            }
            HealthConnectClient.SDK_UNAVAILABLE -> throw BridgeError("NotSupportedError", "Health Connect isn't available on this phone.")
        }
        act.requestHealth(perms)
        return status()
    }

    suspend fun read(days: Int): JSONObject {
        val c = client(); val g = c.permissionController.getGrantedPermissions()
        val end = LocalDateTime.now(); val start = end.toLocalDate().minusDays((days - 1).toLong()).atStartOfDay()
        val steps = JSONObject(); val sessions = JSONArray()
        if (readSteps in g) {
            val res = c.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(
                metrics = setOf(StepsRecord.COUNT_TOTAL),
                timeRangeFilter = TimeRangeFilter.between(start, end),
                timeRangeSlicer = Period.ofDays(1)))
            for (r in res) { val v = r.result[StepsRecord.COUNT_TOTAL] ?: continue; steps.put(r.startTime.toLocalDate().toString(), v) }
        }
        if (readExercise in g) {
            val rr = c.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, timeRangeFilter = TimeRangeFilter.after(start.atZone(ZoneId.systemDefault()).toInstant())))
            for (s in rr.records) {
                val pkg = s.metadata.dataOrigin.packageName
                if (pkg == act.packageName) continue
                sessions.put(JSONObject()
                    .put("id", "hc-" + s.metadata.id)
                    .put("start", s.startTime.toEpochMilli())
                    .put("minutes", Duration.between(s.startTime, s.endTime).toMinutes())
                    .put("type", typeName(s.exerciseType))
                    .put("title", s.title ?: "")
                    .put("app", appName(pkg)))
            }
        }
        return JSONObject().put("steps", steps).put("sessions", sessions)
    }

    suspend fun write(a: JSONObject) {
        val c = client(); val g = c.permissionController.getGrantedPermissions()
        if (writeExercise !in g) return
        val start = Instant.ofEpochMilli(a.getLong("start")); val end = start.plusSeconds(maxOf(60L, a.getLong("seconds")))
        val off = ZoneId.systemDefault().rules.getOffset(start)
        val type = when (a.optString("type")) {
            "ride" -> ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY
            "run" -> ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL
            "walk" -> ExerciseSessionRecord.EXERCISE_TYPE_WALKING
            else -> ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING
        }
        val id = a.getString("id")
        val records = mutableListOf<Record>(ExerciseSessionRecord(
            startTime = start, startZoneOffset = off, endTime = end, endZoneOffset = off,
            exerciseType = type, title = a.optString("title").ifEmpty { null },
            metadata = Metadata.manualEntry(clientRecordId = id)))
        val meters = a.optDouble("meters", 0.0)
        if (meters > 0 && writeDistance in g) records.add(DistanceRecord(
            startTime = start, startZoneOffset = off, endTime = end, endZoneOffset = off,
            distance = Length.meters(meters), metadata = Metadata.manualEntry(clientRecordId = "$id-distance")))
        c.insertRecords(records)
    }

    suspend fun disconnect() { if (sdk() == HealthConnectClient.SDK_AVAILABLE) client().permissionController.revokeAllPermissions() }

    private fun typeName(t: Int) = when (t) {
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING -> "Run"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "Treadmill run"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "Walk"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "Hike"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING -> "Ride"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "Indoor ride"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING, ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "Strength"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "Yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL, ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "Swim"
        ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL -> "Elliptical"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "Row"
        ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING -> "HIIT"
        else -> "Workout"
    }
    private fun appName(pkg: String) = when (pkg) {
        "com.google.android.apps.fitness" -> "Google Fit"
        "com.sec.android.app.shealth" -> "Samsung Health"
        "com.strava" -> "Strava"
        "com.fitbit.FitbitMobile" -> "Fitbit"
        "com.garmin.android.apps.connectmobile" -> "Garmin Connect"
        "com.google.android.apps.healthdata" -> "Health Connect"
        else -> "Health Connect"
    }
}
