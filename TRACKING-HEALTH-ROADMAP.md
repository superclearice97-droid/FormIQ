# FormIQ tracking and health roadmap

This is a development branch. Do not ship until the Android APK and actual camera tracking have been tested.

## Tracking baseline (implemented)
- Existing MediaPipe VIDEO pipeline remains the default.
- `window.FormIQTrackingDiagnostics()` returns observed FPS, exponentially-smoothed inference time, peak inference time, sample count and selected model. This measures inference only, not end-to-end display latency.
- No "Aggressive" toggle or heavier-model override has been reintroduced.

## Native pipeline (not yet implemented)
1. Add CameraX Preview and ImageAnalysis using KEEP_ONLY_LATEST, with correct orientation and lifecycle cleanup.
2. Integrate MediaPipe Pose Landmarker Android LIVE_STREAM mode and an asynchronous result listener. Maintain a single in-flight frame and close every ImageProxy.
3. Preserve timestamps, handle camera mirroring and coordinate transforms, and bridge compact landmarks to the existing exercise tracker.
4. Introduce explicit fallback to the current WebView camera tracker on unsupported devices or native errors.
5. Benchmark Lite and Full on real devices (FPS, median and p95 latency, thermal and battery behavior); only offer adaptive selection after evidence.
6. Test camera permission denial, app background/foreground, rotation, device sleep, low memory, and switching tabs. No automatic camera uploads.

## Health and workout data (not yet implemented)
- Existing Health Connect integration reads steps and exercise sessions and writes workouts.
- Expand incrementally, with per-metric opt-in: heart rate, active calories, sleep, resting heart rate, body mass, distance, and other supported records.
- Handle denied permissions, missing metrics, record origins, deduplication and time-zone boundaries.
- Keep health data on device by default; no cloud transfer without explicit user action.
- Add workout volume, progression, rest and mobility dashboards. Do not treat fitness estimates as medical diagnoses.

## Stretching (implemented)
- 12 dynamic (counted) + 12 static (timed) stretches live in the main Workout tab and use the same camera tracking, setup guide, scoring and history as every other exercise. The separate Stretch tab was removed.
- Older timer-only entries saved under `formiq.mobility.v1` are no longer shown; they stay on the device until "Delete all my data".
- Verify each movement on a real phone; stretch duration is a suggested interval, not an individual prescription.

## Release gates
- JavaScript syntax checks, Gradle assembleRelease, and Android UI smoke test.
- Real-device camera responsiveness and accuracy regression tests against baseline.
- Verify native and web feature parity and preserve user data on upgrade.
- Merge only after reviewing build and device test results.
