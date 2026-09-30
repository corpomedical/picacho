// Where the Angle Stage's camera stands, and the same thing in words
// (operator, 2026-09-30: "Go ahead with A").
//
// The live proof that evening: the stage's camera was turned about 45° round
// Eva, and the guided re-render came back front-on, a widened copy of the
// take. The edit model was given the turn only as a rough 3D sketch (image
// 1), while the take (image 2) and the take's own wording ("…facing the
// camera…") both said front. So the page now sends the camera as numbers
// with the sketch, and the server says it in plain words before anything
// else in the edit prompt.
//
// Pure and import-free: the page measures with it, the server checks and
// words with it, and a probe script can import it as it is.

/**
 * The camera relative to the take's own view (the stage opens there).
 * azimuthDeg: degrees round the subject, positive = towards the subject's
 * LEFT side (the side on the picture's right when they face the camera).
 * elevationDeg: degrees above (+) or below (−) the take's camera height.
 * distanceRatio: the camera's distance over the take's (below 1 = closer).
 */
export type StageCameraView = {
  azimuthDeg: number;
  elevationDeg: number;
  distanceRatio: number;
};

type Vec3 = { x: number; y: number; z: number };

const DEG = 180 / Math.PI;

/**
 * Measure the view from the camera's offset to the orbit target (camera
 * position minus target) and the stage's home offset. The stage's proxy faces
 * +z, towards the home camera, so the subject's left is +x.
 */
export function measureStageCamera(offset: Vec3, home: Vec3): StageCameraView {
  const r = Math.hypot(offset.x, offset.y, offset.z) || 1;
  const homeR = Math.hypot(home.x, home.y, home.z) || 1;
  const elevation = Math.asin(Math.max(-1, Math.min(1, offset.y / r))) * DEG;
  const homeElevation = Math.asin(Math.max(-1, Math.min(1, home.y / homeR))) * DEG;
  return {
    azimuthDeg: Math.atan2(offset.x, offset.z) * DEG,
    elevationDeg: elevation - homeElevation,
    distanceRatio: r / homeR,
  };
}

/** What the client sent, as numbers in range — or null, and the old prompt. */
export function readStageCameraView(raw: unknown): StageCameraView | null {
  if (!raw || typeof raw !== "object") return null;
  const { azimuthDeg, elevationDeg, distanceRatio } = raw as Record<string, unknown>;
  const nums = [azimuthDeg, elevationDeg, distanceRatio];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  // Wrap the turn into (−180, 180]; clamp the rest to what OrbitControls can reach.
  let az = (azimuthDeg as number) % 360;
  if (az > 180) az -= 360;
  if (az <= -180) az += 360;
  return {
    azimuthDeg: az,
    elevationDeg: Math.max(-90, Math.min(90, elevationDeg as number)),
    distanceRatio: Math.max(0.1, Math.min(5, distanceRatio as number)),
  };
}

/**
 * The camera in words, for the edit prompt. Empty when the camera is where
 * the take's was — the old prompt is right for that.
 */
export function describeStageCamera(view: StageCameraView): string {
  const turn = Math.abs(view.azimuthDeg);
  const deg = Math.round(turn / 5) * 5;
  const side = view.azimuthDeg > 0 ? "left" : "right";
  // Facing the take's camera, the subject's left is the picture's right; seen
  // from their left side, they face the picture's left.
  const faces = view.azimuthDeg > 0 ? "left" : "right";
  const e = view.elevationDeg;
  const d = view.distanceRatio;
  if (turn < 12 && Math.abs(e) < 8 && d >= 0.85 && d <= 1.2) return "";

  const parts: string[] = [];
  if (turn < 12) parts.push("the same front view as image 2");
  else if (turn < 35) parts.push(`a slightly turned view, the camera moved about ${deg}° round to the subject's ${side} side`);
  else if (turn < 60) parts.push(`a three-quarter view from the subject's ${side} side, the camera moved about ${deg}° round from the front`);
  else if (turn < 120) parts.push(`a side profile view from the subject's ${side} side, the camera moved about ${deg}° round from the front`);
  else if (turn < 155) parts.push(`a three-quarter view from behind, on the subject's ${side} side, the camera moved about ${deg}° round from the front`);
  else parts.push("a view from directly behind the subject");

  if (e < -20) parts.push("from a low angle looking up");
  else if (e < -8) parts.push("from slightly below");
  else if (e > 60) parts.push("from almost directly overhead");
  else if (e > 30) parts.push("from a high angle looking down");
  else if (e > 10) parts.push("from slightly above, looking down");

  if (d < 0.6) parts.push("a close-up, much closer than image 2");
  else if (d < 0.85) parts.push("a little closer than image 2");
  else if (d > 1.6) parts.push("a wide shot, the subject small in the frame");
  else if (d > 1.2) parts.push("a wider shot than image 2");

  // How far the subject reads as turned, said as plainly as the camera: on
  // 09-30 "we see their left side" alone turned a 45° sketch into a profile.
  let words = `Camera placement: ${parts.join(", ")}.`;
  if (turn >= 12 && turn < 35) {
    words += ` The subject keeps their pose, so they are turned only slightly, about ${deg}°, towards the ${faces} of the picture; their face is still mostly towards the camera.`;
  } else if (turn >= 35 && turn < 60) {
    words += ` The subject keeps their pose, so they stand turned about ${deg}° away from the camera, towards the ${faces} of the picture: not in profile, we still see their face and front at an angle, and a little of their ${side} side.`;
  } else if (turn >= 60 && turn < 120) {
    words += ` The subject keeps their pose, so they are seen side-on, in profile, facing the ${faces} of the picture.`;
  } else if (turn >= 120 && turn < 155) {
    words += ` The subject keeps their pose, so they face away from the camera, towards the ${faces} of the picture; we see their back and a little of their face in profile.`;
  } else if (turn >= 155) {
    words += " The subject keeps their pose, so we see their back.";
  }
  return words;
}

/**
 * The edit prompt for one angle (angle-stage.ts renderAngleFrame). With the
 * camera where the take's was, or no view sent (a page from before
 * 2026-09-30), it is the original prompt word for word. With a turned camera,
 * the words come first, image 2 is kept to how things look (it shows another
 * angle), and the take's own wording yields on camera and facing — "facing
 * the camera" in a take's prompt was one of the three voices saying front.
 */
export function angleFramePrompt(scene: string, cameraView: unknown): string {
  const view = readStageCameraView(cameraView);
  const camera = view ? describeStageCamera(view) : "";
  if (!camera) {
    return (
      "Recreate the scene from image 2 at exactly the camera angle, subject pose and composition of image 1. " +
      "Image 1 is a rough 3D sketch of the same scene — follow its framing precisely, but take every detail of " +
      "the subject's face, hair, clothing, lighting and background from image 2. Photorealistic cinematic film " +
      "still, same color grade as image 2." +
      (scene ? ` The scene: ${scene}` : "")
    );
  }
  return (
    `${camera} ` +
    "Recreate the scene from image 2 as seen from this new camera position. Image 1 is a rough 3D sketch taken " +
    "from exactly that position — follow its camera angle, the subject's orientation and its framing precisely. " +
    "Image 2 shows the same scene from a different angle: take every detail of the subject's face, hair, " +
    "clothing, lighting and surroundings from it, but never its camera angle or framing. Photorealistic " +
    "cinematic film still, same color grade as image 2." +
    (scene
      ? ` The scene: ${scene} (where these words say where the camera is or which way the subject faces, the camera placement above wins).`
      : "")
  );
}
