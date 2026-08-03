import {
  FaceLandmarker,
  FilesetResolver,
  DrawingUtils,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

export { FaceLandmarker, DrawingUtils };

const MOUTH_OPEN_SCALE = 1.0; // 2.2;
export const CONSEC_FRAMES = 1;

export async function startCamera(video, canvas) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
  });
  video.srcObject = stream;
  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      resolve();
    };
  });
}

export async function createFaceLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  );

  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU',
    },
    outputFaceBlendshapes: true,
    runningMode: 'VIDEO',
    numFaces: 1,
  });
}

export function runDetectionLoop(video, landmarker, onResult) {
  let lastVideoTime = -1;

  function detect() {
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = landmarker.detectForVideo(video, performance.now());
      onResult(result);
    }
    requestAnimationFrame(detect);
  }

  detect();
}

export function mouthOpenScore(lm) {
  const eyeDist = Math.hypot(lm[263].x - lm[33].x, lm[263].y - lm[33].y);
  if (eyeDist === 0) return 0;
  const lipGap = Math.hypot(lm[14].x - lm[13].x, lm[14].y - lm[13].y);
  return Math.min(1, (lipGap / eyeDist) * MOUTH_OPEN_SCALE);
}

export function createBlinkState() {
  return {
    blinkCount: 0,
    leftClosed: 0,
    rightClosed: 0,
    blinkRegistered: false,
    counterColorIndex: 0,
    lastBlinkTime: null,
    blinkIntervalTotal: 0,
    blinkIntervalCount: 0,
  };
}

// Mutates `state` in place, returns whether both eyes are currently closed.
export function updateBlinkState(state, leftScore, rightScore, threshold, numColors) {
  state.leftClosed = leftScore > threshold ? state.leftClosed + 1 : 0;
  state.rightClosed = rightScore > threshold ? state.rightClosed + 1 : 0;

  const bothClosed = state.leftClosed >= CONSEC_FRAMES && state.rightClosed >= CONSEC_FRAMES;

  if (bothClosed && !state.blinkRegistered) {
    const now = performance.now();
    if (state.lastBlinkTime !== null) {
      state.blinkIntervalTotal += now - state.lastBlinkTime;
      state.blinkIntervalCount++;
    }
    state.lastBlinkTime = now;

    state.counterColorIndex = (state.blinkCount + numColors - 1) % numColors;
    state.blinkCount++;
    state.blinkRegistered = true;
  }

  if (!bothClosed) {
    state.blinkRegistered = false;
  }

  return bothClosed;
}
