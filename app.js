import {
  FaceLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const resetBtn = document.getElementById('reset-btn');
const thresholdEl = document.getElementById('threshold');
const thresholdVal = document.getElementById('threshold-val');

let BLINK_THRESHOLD = parseFloat(thresholdEl.value);
thresholdEl.addEventListener('input', () => {
  BLINK_THRESHOLD = parseFloat(thresholdEl.value);
  thresholdVal.textContent = BLINK_THRESHOLD.toFixed(2);
});

const CONSEC_FRAMES = 1;

let blinkCount = 0;
let leftClosed = 0;
let rightClosed = 0;
let blinkRegistered = false;

function drawCounter(lm) {
  const minY = Math.min(...lm.map((point) => point.y));
  // Nose tip x raw; after counter-flip transform, tx = canvas.width - cx lands at correct screen x
  const cx = lm[1].x * canvas.width;
  const cy = (minY * canvas.height) - 18;

  const text = `Blinks: ${blinkCount}`;
  ctx.save();
  // Counter-flip the context so text renders readable (canvas CSS is scaleX(-1))
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  // After this transform, draw at (canvas.width - cx) to land at cx on screen
  const tx = canvas.width - cx;

  ctx.font = 'bold 28px Courier New';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const metrics = ctx.measureText(text);
  const pw = metrics.width + 28;
  const ph = 40;
  const px = tx - pw / 2;
  const py = cy - ph;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 10);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,200,255,0.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 10);
  ctx.stroke();

  ctx.fillStyle = '#00c8ff';
  ctx.shadowColor = '#00c8ff';
  ctx.shadowBlur = 10;
  ctx.fillText(text, tx, cy);
  ctx.restore();
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' }
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

async function main() {
  await startCamera();
  status.textContent = 'Initializing face detector…';

  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  );

  const landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU'
    },
    outputFaceBlendshapes: true,
    runningMode: 'VIDEO',
    numFaces: 1
  });

  status.textContent = 'Tracking — blink away!';

  const drawUtils = new DrawingUtils(ctx);
  let lastVideoTime = -1;

  function detect() {
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = landmarker.detectForVideo(video, performance.now());

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (result.faceLandmarks && result.faceLandmarks.length > 0) {
        const lm = result.faceLandmarks[0];

        drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
          { color: 'rgba(0,200,255,0.85)', lineWidth: 1.5 });
        drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
          { color: 'rgba(0,200,255,0.85)', lineWidth: 1.5 });

        const shapes = result.faceBlendshapes?.[0]?.categories ?? [];

        if (shapes.length && !window._shapesDumped) {
          window._shapesDumped = true;
          console.log('Blendshape categories:', shapes.map((category) => category.categoryName));
        }

        const leftScore = shapes.find((category) => category.categoryName === 'eyeBlinkLeft')?.score ?? 0;
        const rightScore = shapes.find((category) => category.categoryName === 'eyeBlinkRight')?.score ?? 0;

        status.textContent = `shapes:${shapes.length} L:${leftScore.toFixed(2)} R:${rightScore.toFixed(2)} | blinks:${blinkCount}`;

        if (leftScore > BLINK_THRESHOLD) {
          leftClosed++;
        } else {
          leftClosed = 0;
        }

        if (rightScore > BLINK_THRESHOLD) {
          rightClosed++;
        } else {
          rightClosed = 0;
        }

        const bothClosed = leftClosed >= CONSEC_FRAMES && rightClosed >= CONSEC_FRAMES;

        if (bothClosed && !blinkRegistered) {
          blinkCount++;
          blinkRegistered = true;
        }

        if (!bothClosed) {
          blinkRegistered = false;
        }

        drawCounter(lm);
      }
    }

    requestAnimationFrame(detect);
  }

  detect();
}

resetBtn.addEventListener('click', () => {
  blinkCount = 0;
});

main().catch((err) => {
  status.textContent = `Error: ${err.message}`;
  console.error(err);
});