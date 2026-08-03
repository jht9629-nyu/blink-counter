import {
  COUNTER_COLORS,
  createScoreHistories,
  drawCounter,
  drawFaceMeshOverlay,
  drawBlinkOutline,
  drawScoreGraph,
  updateScoreGraph,
  resetScoreGraphState,
  updateZoomTransform,
  resetZoom,
} from './draw.js';
import {
  DrawingUtils,
  startCamera,
  createFaceLandmarker,
  runDetectionLoop,
  mouthOpenScore,
  createBlinkState,
  updateBlinkState,
} from './detect.js';

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
    resetZoom(container);
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

let blinkState = createBlinkState();
let scoreHistories = createScoreHistories();

async function main() {
  await startCamera(video, canvas);
  status.textContent = 'Initializing face detector…';

  const landmarker = await createFaceLandmarker();

  status.textContent = 'Tracking — blink away!';

  const drawUtils = new DrawingUtils(ctx);

  runDetectionLoop(video, landmarker, (result) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (result.faceLandmarks && result.faceLandmarks.length > 0) {
      const lm = result.faceLandmarks[0];

      updateZoomTransform(container, lm, zoomEnabled);
      drawFaceMeshOverlay(drawUtils, lm);

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

      updateScoreGraph(graphCtx, scoreHistories, BLINK_THRESHOLD, graphSampleInterval, leftScore, rightScore, mouthScore);

      updateBlinkState(blinkState, leftScore, rightScore, BLINK_THRESHOLD, COUNTER_COLORS.length);

      const avgBlinkSeconds =
        blinkState.blinkIntervalCount > 0
          ? (blinkState.blinkIntervalTotal / blinkState.blinkIntervalCount / 1000).toFixed(1)
          : '—';
      status.textContent = `shapes:${shapes.length} L:${leftScore.toFixed(2)} R:${rightScore.toFixed(2)} | blinks:${blinkState.blinkCount} | avg:${avgBlinkSeconds}s`;

      const counterColor = COUNTER_COLORS[blinkState.counterColorIndex];
      drawBlinkOutline(drawUtils, lm, counterColor);
      drawCounter(ctx, canvas, lm, blinkState.blinkCount, counterColor);
    } else {
      updateZoomTransform(container, null, zoomEnabled);
      updateScoreGraph(graphCtx, scoreHistories, BLINK_THRESHOLD, graphSampleInterval, 0, 0, 0);
    }
  });
}

resetBtn.addEventListener('click', () => {
  blinkState = createBlinkState();
  scoreHistories = createScoreHistories();
  resetScoreGraphState();
  drawScoreGraph(graphCtx, scoreHistories, BLINK_THRESHOLD);
});

drawScoreGraph(graphCtx, scoreHistories, BLINK_THRESHOLD);

main().catch((err) => {
  status.textContent = `Error: ${err.message}`;
  console.error(err);
});
