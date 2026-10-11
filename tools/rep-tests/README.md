# Rep-counter tests

Checks `reps.js` against pose data recorded from real workout videos, with the true rep counts written down by hand.

1. `pip install mediapipe opencv-python`
2. For each video: `python3 extract.py VIDEO.mp4 ../../vendor/models/pose_landmarker_full.task data/NAME_full.json`
3. `node suite.mjs ../../reps.js full 1` (last number: use every Nth frame, e.g. 3 = 10 fps)

The videos aren't included (they belong to their authors). The ones used were public sample videos from
open-source pose-estimation projects on GitHub. Only pose coordinates are used; no images are kept.

`synth.mjs` builds synthetic movements (twists, side bends, knee lifts, jumps, holds...) from one real
standing pose and checks each exercise counts them, and that standing still or walking counts nothing.
`reference_count.py` is an independent offline count (peak finding on the whole recording) used to
cross-check the app's live counter on longer video sets.
