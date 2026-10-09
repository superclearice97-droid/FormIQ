# FormIQ

Camera-based workout tracker that runs in the browser on phones and computers.

- Tracks body pose on-device (MediaPipe Pose Landmarker); no video is uploaded
- Counts reps for squats, push-ups, bicep curls and overhead presses
- Scores each rep 0–100 for range of motion and form faults
- Logs sets with a rest timer and voice rep counts; history is saved in the browser
- Can analyze a recorded video as well as the live camera
- Food tab: scan a barcode or search, get a 0–100 score with pros, cons, estimated health risks and additive ratings; saved food library and meal scoring
- Food score (FormIQ's own method): nutrition 60 pts (Nutri-Score grade or nutrient levels), additives 30 pts, organic 10 pts; capped at 49 with a high-risk additive

Open it at the GitHub Pages address for this repo. The camera needs https, which Pages provides.

## Privacy, terms and licenses

- [Privacy Policy](https://superclearice97-droid.github.io/FormIQ/privacy.html): camera frames and pose data are processed on-device and never uploaded; workout history stays in browser local storage.
- [Terms of Use](https://superclearice97-droid.github.io/FormIQ/terms.html): not medical advice, exercise at your own risk, provided as is.
- Privacy by design: all code, fonts and models are self-hosted (see `.github/workflows/vendor.yml`); a Content Security Policy blocks every other connection except Open Food Facts lookups and the optional, user-keyed AI provider; no referrer is sent; "Delete all my data" erases everything stored on the device.
- Optional photo meal analysis: off by default; the user's own Anthropic or Gemini key; photo shrunk and stripped of EXIF/GPS, sent directly from the device only after an explicit tap; never touches a FormIQ server.
- [Licenses](https://superclearice97-droid.github.io/FormIQ/licenses.html): MediaPipe Tasks Vision and Pose Landmarker models (Apache 2.0, Google LLC); Open Food Facts data (ODbL / DbCL, photos CC BY-SA 3.0); barcode-detector and zxing-wasm (MIT); Barlow Condensed and IBM Plex fonts (SIL OFL 1.1).

Users accept the terms and privacy policy in the app before the camera starts.
