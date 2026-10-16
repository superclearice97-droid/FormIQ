# FormIQ

Camera-based workout tracker that runs in the browser on phones and computers.

- Tracks body pose on-device (MediaPipe Pose Landmarker); no video is uploaded
- Auto-frame (toggle): digital pan and zoom follows you so you stay centred and a good size; the guide only asks for the body parts each exercise needs (for example head to hips for arm work)
- Desktop app for Linux (zip, AppImage, deb), Windows and Mac, built by GitHub Actions from the `desktop/` folder (Electron wrapper around the same web app, offline, camera-only permissions, camera picker, Bluetooth device chooser). Download page: install-desktop.html
- Adaptive framing: the setup guide asks only for the body parts an exercise needs (squats work from hips and knees, no feet required), accepts partial views and relaxes its demands if you are stuck
- A customizable coach: 25 hairstyles (many black styles: afro, puffs, braids, locs, cornrows, bantu knots and more), 14 hair colours, 8 skin tones, outfits, build, proportions and extras, saved on your device
- An original, fully 3D anime-style coach (three.js, bundled, drag it to look around; falls back to 2D without WebGL) demonstrates every exercise in an animation, and pops up on the camera view whenever you need to get back into position (there is also a Show demo button)
- Built-in coaching for every exercise: muscles worked, step-by-step instructions, common mistakes, breathing, easier and harder versions, plus live on-screen coaching and a spoken cue during each set (all offline)
- Setup guide: tells you how to get into the picture (step back, move left or right, turn, starting position), counts 3-2-1, and only then starts counting. It pauses if you leave the frame and can be turned off.
- Counts reps, sides and hold time for 77 exercises, no equipment needed:
  - Strength: squat, push-up, pull-up, bicep curl, lunge
  - Arms: overhead press, front raise, behind-the-head press, bow pull, one-arm shoulder press, triceps kickback, overhead arm twist, overhead arm circles
  - Core: overhead side bend, standing twist, lunge twist, pendulum bend, overhead bend, overhead hip shake, knee-to-chest, seated forward press, plank hip lift, leg raise, open & close leg raise, Russian twist, flutter kick, seated arm raise, leg scissors, crunch, sit-up
  - Legs: wide squat, overhead squat, seated knee squeeze, hip lift (glute bridge), knee lift, side step, arm raise combo, knee lift & arm raise
  - Cardio: jog in place, high knees, jump rope (with or without a rope), jumping jacks, mountain climber
  - Stretches, tracked like everything else: 12 moving warm-up stretches (counted) and 12 still cool-down stretches (timed while your position is right), with Warm-up and Cool-down circuits
  - Yoga & holds (timed): plank, chair, tree, hinge, revolved crescent lunge, warrior I, II and III, seated side stretch, boat, standing forward fold
- Ready-made circuits (starter full body, leg day, core, arms, cardio, yoga flow) that move from one exercise to the next for you
- Scores each rep 0–100 for range of motion and form faults
- Logs sets with a rest timer and voice rep counts; history is saved in the browser
- Can analyze a recorded video as well as the live camera
- Food tab: scan a barcode or search, get a 0–100 score with pros, cons, estimated health risks and additive ratings; saved food library and meal scoring
- Food score (FormIQ's own method): nutrition 60 pts (Nutri-Score grade or nutrient levels), additives 30 pts, organic 10 pts; capped at 49 with a high-risk additive

Open it at the GitHub Pages address for this repo. The camera needs https, which Pages provides.

## Privacy, terms and licenses

- [Privacy Policy](https://superclearice97-droid.github.io/FormIQ/privacy.html): camera frames and pose data are processed on-device and never uploaded; workout history stays in browser local storage.
- [Terms of Use](https://superclearice97-droid.github.io/FormIQ/terms.html): not medical advice, exercise at your own risk, provided as is.
- Activity tab: live step counter (motion sensor, while open), daily and weekly goals with streaks; imports Apple Health export (zip/xml) and Google Takeout / Samsung Health CSVs on-device; Strava two-way sync via the user's own API app; FitShow and other FTMS treadmills/bikes over Web Bluetooth; export all data
- Ride tab: gamified indoor rides and runs on FTMS smart bikes, trainers and treadmills (FitShow and others), or on any treadmill with no extra gear: the camera watches you run, or the phone's motion sensor or a fitness app (Health Connect) counts your steps, and your runner moves in step; races with a start pen and countdown, start and finish arches, 13 rivals with different racing styles, live place and time gaps, spoken race calls, results and race badges; animated runners; km or mile units and per-split times; pseudo-3D routes with hills, pace partners, ghost of your best time, structured workouts with ERG mode, XP, levels, badges, unlockable routes and jerseys; live power, cadence, speed/pace, heart-rate zones and breathing rate estimated from a chest strap's RR intervals; hill simulation on bikes and opt-in auto-incline on treadmills (never speed); TCX export and Strava upload
- Android app (`android/`): WebView shell built by GitHub Actions into `FormIQ.apk` releases; native Bluetooth bridge, all-day steps via the on-device Recording API, Health Connect read/write, camera, file save, speech and update checks; bridge restricted to the bundled app's origin
- Privacy by design: all code, fonts and models are self-hosted (see `.github/workflows/vendor.yml`); a Content Security Policy blocks every other connection except Open Food Facts lookups and the optional, user-keyed AI provider; no referrer is sent; "Delete all my data" erases everything stored on the device.
- Optional photo meal analysis: off by default; the user's own Anthropic or Gemini key; photo shrunk and stripped of EXIF/GPS, sent directly from the device only after an explicit tap; never touches a FormIQ server.
- [Licenses](https://superclearice97-droid.github.io/FormIQ/licenses.html): MediaPipe Tasks Vision and Pose Landmarker models (Apache 2.0, Google LLC); Open Food Facts data (ODbL / DbCL, photos CC BY-SA 3.0); barcode-detector and zxing-wasm (MIT); Barlow Condensed and IBM Plex fonts (SIL OFL 1.1).

Users accept the terms and privacy policy in the app before the camera starts.
