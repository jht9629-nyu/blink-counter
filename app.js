import {
  FaceLandmarker,
  FilesetResolver,
  DrawingUtils,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const container = document.getElementById('container');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const graph = document.getElementById('graph');
const graphCtx = graph.getContext('2d');
const status = document.getElementById('status');
const resetBtn = document.getElementById('reset-btn');
const thresholdEl = document.getElementById('threshold');
const thresholdVal = document.getElementById('threshold-val');
const graphSpeedEl = document.getElementById('graph-speed');
const graphSpeedVal = document.getElementById('graph-speed-val');
const zoomToggleEl = document.getElementById('zoom-toggle');

let zoomEnabled = false;
zoomToggleEl.addEventListener('change', () => {
  zoomEnabled = zoomToggleEl.checked;
  container.classList.toggle('zoomed', zoomEnabled);
  if (!zoomEnabled) {
    smoothedZoomOx = 50;
    smoothedZoomOy = 50;
    smoothedZoomScale = 1;
    container.style.setProperty('--zoom-ox', '50%');
    container.style.setProperty('--zoom-oy', '50%');
    container.style.setProperty('--zoom-scale', '1');
  }
});

let BLINK_THRESHOLD = parseFloat(thresholdEl.value);
thresholdEl.addEventListener('input', () => {
  BLINK_THRESHOLD = parseFloat(thresholdEl.value);
  thresholdVal.textContent = BLINK_THRESHOLD.toFixed(2);
});

let graphSampleInterval = parseInt(graphSpeedEl.value, 10);
graphSpeedEl.addEventListener('input', () => {
  graphSampleInterval = parseInt(graphSpeedEl.value, 10);
  graphSpeedVal.textContent = String(graphSampleInterval);
});

const CONSEC_FRAMES = 1;
const COUNTER_COLORS = ['#ff4d4d', '#32cd32', '#d4af37'];
const GRAPH_WIDTH = 640;
const GRAPH_HEIGHT = 160;
const GRAPH_HISTORY_SIZE = 160;
const LEFT_GRAPH_COLOR = '#ff6b6b';
const RIGHT_GRAPH_COLOR = '#4ddf83';
const MOUTH_GRAPH_COLOR = '#ffd166';
const THRESHOLD_GRAPH_COLOR = 'rgba(0, 200, 255, 0.8)';
const MOUTH_OPEN_SCALE = 1.0; // 2.2;
const ZOOM_PADDING = 1.6;
const ZOOM_MAX_SCALE = 4;
const ZOOM_LERP = 0.12;

let smoothedZoomOx = 50;
let smoothedZoomOy = 50;
let smoothedZoomScale = 1;

let blinkCount = 0;
let leftClosed = 0;
let rightClosed = 0;
let blinkRegistered = false;
let counterColorIndex = 0;
let lastBlinkTime = null;
let blinkIntervalTotal = 0;
let blinkIntervalCount = 0;
let leftScoreHistory = Array(GRAPH_HISTORY_SIZE).fill(0);
let rightScoreHistory = Array(GRAPH_HISTORY_SIZE).fill(0);
let mouthScoreHistory = Array(GRAPH_HISTORY_SIZE).fill(0);
let graphSampleCountdown = 0;

function mouthOpenScore(lm) {
  const eyeDist = Math.hypot(lm[263].x - lm[33].x, lm[263].y - lm[33].y);
  if (eyeDist === 0) return 0;
  const lipGap = Math.hypot(lm[14].x - lm[13].x, lm[14].y - lm[13].y);
  return Math.min(1, (lipGap / eyeDist) * MOUTH_OPEN_SCALE);
}

function drawCounter(lm) {
  const minY = Math.min(...lm.map((point) => point.y));
  // Nose tip x raw; after counter-flip transform, tx = canvas.width - cx lands at correct screen x
  const cx = lm[1].x * canvas.width;
  const cy = minY * canvas.height - 18;

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

  const counterColor = COUNTER_COLORS[counterColorIndex];
  ctx.fillStyle = counterColor;
  ctx.shadowColor = counterColor;
  ctx.shadowBlur = 10;
  ctx.fillText(text, tx, cy);
  ctx.restore();
}

function pushGraphValue(history, score) {
  history.push(score);
  if (history.length > GRAPH_HISTORY_SIZE) {
    history.shift();
  }
}

function drawGraphLine(history, color) {
  graphCtx.beginPath();
  history.forEach((score, index) => {
    const x = GRAPH_WIDTH - (index / (GRAPH_HISTORY_SIZE - 1)) * GRAPH_WIDTH;
    const y = GRAPH_HEIGHT - score * (GRAPH_HEIGHT - 1);
    if (index === 0) {
      graphCtx.moveTo(x, y);
    } else {
      graphCtx.lineTo(x, y);
    }
  });
  graphCtx.strokeStyle = color;
  graphCtx.lineWidth = 2;
  graphCtx.stroke();
}

function drawScoreGraph() {
  graphCtx.clearRect(0, 0, GRAPH_WIDTH, GRAPH_HEIGHT);

  graphCtx.strokeStyle = 'rgba(255,255,255,0.08)';
  graphCtx.lineWidth = 1;
  for (let lineIndex = 1; lineIndex < 4; lineIndex++) {
    const y = (GRAPH_HEIGHT / 4) * lineIndex;
    graphCtx.beginPath();
    graphCtx.moveTo(0, y);
    graphCtx.lineTo(GRAPH_WIDTH, y);
    graphCtx.stroke();
  }

  const thresholdY = GRAPH_HEIGHT - BLINK_THRESHOLD * (GRAPH_HEIGHT - 1);
  graphCtx.beginPath();
  graphCtx.moveTo(0, thresholdY);
  graphCtx.lineTo(GRAPH_WIDTH, thresholdY);
  graphCtx.strokeStyle = THRESHOLD_GRAPH_COLOR;
  graphCtx.lineWidth = 1.5;
  graphCtx.setLineDash([6, 6]);
  graphCtx.stroke();
  graphCtx.setLineDash([]);

  drawGraphLine(leftScoreHistory, LEFT_GRAPH_COLOR);
  drawGraphLine(rightScoreHistory, RIGHT_GRAPH_COLOR);
  drawGraphLine(mouthScoreHistory, MOUTH_GRAPH_COLOR);
}

function updateScoreGraph(leftScore, rightScore, mouthScore) {
  graphSampleCountdown = (graphSampleCountdown + 1) % graphSampleInterval;
  if (graphSampleCountdown !== 0) {
    return;
  }

  pushGraphValue(leftScoreHistory, leftScore);
  pushGraphValue(rightScoreHistory, rightScore);
  pushGraphValue(mouthScoreHistory, mouthScore);
  drawScoreGraph();
}

function updateZoomTransform(lm) {
  if (!zoomEnabled) {
    return;
  }

  let targetOx = 50;
  let targetOy = 50;
  let targetScale = 1;

  if (lm) {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const point of lm) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }

    const boxSize = Math.max(maxX - minX, maxY - minY);
    targetOx = ((minX + maxX) / 2) * 100;
    targetOy = ((minY + maxY) / 2) * 100;
    targetScale = Math.min(ZOOM_MAX_SCALE, Math.max(1, 1 / (boxSize * ZOOM_PADDING)));
  }

  smoothedZoomOx += (targetOx - smoothedZoomOx) * ZOOM_LERP;
  smoothedZoomOy += (targetOy - smoothedZoomOy) * ZOOM_LERP;
  smoothedZoomScale += (targetScale - smoothedZoomScale) * ZOOM_LERP;

  container.style.setProperty('--zoom-ox', `${smoothedZoomOx}%`);
  container.style.setProperty('--zoom-oy', `${smoothedZoomOy}%`);
  container.style.setProperty('--zoom-scale', smoothedZoomScale.toFixed(3));
}

async function startCamera() {
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

async function main() {
  await startCamera();
  status.textContent = 'Initializing face detector…';

  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  );

  const landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU',
    },
    outputFaceBlendshapes: true,
    runningMode: 'VIDEO',
    numFaces: 1,
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

        updateZoomTransform(lm);

        drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
          color: 'rgba(255,255,255,0.25)',
          lineWidth: 0.5,
        });

        drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, {
          color: 'rgba(0,200,255,0.85)',
          lineWidth: 1.5,
        });
        drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, {
          color: 'rgba(0,200,255,0.85)',
          lineWidth: 1.5,
        });

        const shapes = result.faceBlendshapes?.[0]?.categories ?? [];

        if (shapes.length && !window._shapesDumped) {
          window._shapesDumped = true;
          console.log(
            'Blendshape categories:',
            shapes.map((category) => category.categoryName),
          );
        }

        const leftScore = shapes.find((category) => category.categoryName === 'eyeBlinkLeft')?.score ?? 0;
        const rightScore = shapes.find((category) => category.categoryName === 'eyeBlinkRight')?.score ?? 0;
        const mouthScore = mouthOpenScore(lm);

        updateScoreGraph(leftScore, rightScore, mouthScore);

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
          const now = performance.now();
          if (lastBlinkTime !== null) {
            blinkIntervalTotal += now - lastBlinkTime;
            blinkIntervalCount++;
          }
          lastBlinkTime = now;

          counterColorIndex = (blinkCount + COUNTER_COLORS.length - 1) % COUNTER_COLORS.length;
          blinkCount++;
          blinkRegistered = true;
        }

        if (!bothClosed) {
          blinkRegistered = false;
        }

        const avgBlinkSeconds =
          blinkIntervalCount > 0 ? (blinkIntervalTotal / blinkIntervalCount / 1000).toFixed(1) : '—';
        status.textContent = `shapes:${shapes.length} L:${leftScore.toFixed(2)} R:${rightScore.toFixed(2)} | blinks:${blinkCount} | avg:${avgBlinkSeconds}s`;

        drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {
          color: COUNTER_COLORS[counterColorIndex],
          lineWidth: 2,
        });
        drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_LIPS, {
          color: COUNTER_COLORS[counterColorIndex],
          lineWidth: 2,
        });

        drawCounter(lm);
      } else {
        updateZoomTransform(null);
        updateScoreGraph(0, 0, 0);
      }
    }
    requestAnimationFrame(detect);
  }

  detect();
}

resetBtn.addEventListener('click', () => {
  blinkCount = 0;
  counterColorIndex = 0;
  lastBlinkTime = null;
  blinkIntervalTotal = 0;
  blinkIntervalCount = 0;
  leftScoreHistory = Array(GRAPH_HISTORY_SIZE).fill(0);
  rightScoreHistory = Array(GRAPH_HISTORY_SIZE).fill(0);
  mouthScoreHistory = Array(GRAPH_HISTORY_SIZE).fill(0);
  graphSampleCountdown = 0;
  drawScoreGraph();
});

drawScoreGraph();

main().catch((err) => {
  status.textContent = `Error: ${err.message}`;
  console.error(err);
});
