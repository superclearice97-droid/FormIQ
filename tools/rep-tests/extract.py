import sys, json, cv2, mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
vid, model, out = sys.argv[1], sys.argv[2], sys.argv[3]
flip = len(sys.argv) > 4
opts = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=model), running_mode=vision.RunningMode.VIDEO,
    num_poses=1, min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.4, min_tracking_confidence=0.4)
lm = vision.PoseLandmarker.create_from_options(opts)
cap = cv2.VideoCapture(vid); fps = cap.get(cv2.CAP_PROP_FPS) or 30; frames=[]; i=0
while True:
    ok, f = cap.read()
    if not ok: break
    if flip: f = cv2.flip(f, 1)
    img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
    r = lm.detect_for_video(img, int(i*1000/fps))
    t = i*1000/fps; i += 1
    if not r.pose_landmarks: frames.append({"t":t}); continue
    P=lambda L:[{"x":p.x,"y":p.y,"z":p.z,"visibility":p.visibility} for p in L]
    frames.append({"t":t,"lm":P(r.pose_landmarks[0]),"w":P(r.pose_world_landmarks[0])})
json.dump({"fps":fps,"frames":frames}, open(out,"w"))
print(out, len(frames), "frames", sum(1 for f in frames if "lm" in f), "with pose")
