import { FaceLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

export const COUNTER_COLORS = ['#ff4d4d', '#32cd32', '#d4af37'];
export const GRAPH_WIDTH = 640;
export const GRAPH_HEIGHT = 160;
export const GRAPH_HISTORY_SIZE = 160;

const LEFT_GRAPH_COLOR = '#ff6b6b';
const RIGHT_GRAPH_COLOR = '#4ddf83';
const MOUTH_GRAPH_COLOR = '#ffd166';
const THRESHOLD_GRAPH_COLOR = 'rgba(0, 200, 255, 0.8)';
const ZOOM_PADDING = 1.6;
const ZOOM_MAX_SCALE = 4;
const ZOOM_LERP = 0.12;

let smoothedZoomOx = 50;
let smoothedZoomOy = 50;
let smoothedZoomScale = 1;
let graphSampleCountdown = 0;

export function createScoreHistories() {
  return {
    left: Array(GRAPH_HISTORY_SIZE).fill(0),
    right: Array(GRAPH_HISTORY_SIZE).fill(0),
    mouth: Array(GRAPH_HISTORY_SIZE).fill(0),
  };
}

export function drawCounter(ctx, canvas, lm, blinkCount, counterColor) {
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

  ctx.fillStyle = counterColor;
  ctx.shadowColor = counterColor;
  ctx.shadowBlur = 10;
  ctx.fillText(text, tx, cy);
  ctx.restore();
}

export function drawFaceMeshOverlay(drawUtils, lm) {
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
}

export function drawBlinkOutline(drawUtils, lm, counterColor) {
  drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {
    color: counterColor,
    lineWidth: 2,
  });
  drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_LIPS, {
    color: counterColor,
    lineWidth: 2,
  });
}

function pushGraphValue(history, score) {
  history.push(score);
  if (history.length > GRAPH_HISTORY_SIZE) {
    history.shift();
  }
}

function drawGraphLine(graphCtx, history, color) {
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

export function drawScoreGraph(graphCtx, histories, threshold) {
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

  const thresholdY = GRAPH_HEIGHT - threshold * (GRAPH_HEIGHT - 1);
  graphCtx.beginPath();
  graphCtx.moveTo(0, thresholdY);
  graphCtx.lineTo(GRAPH_WIDTH, thresholdY);
  graphCtx.strokeStyle = THRESHOLD_GRAPH_COLOR;
  graphCtx.lineWidth = 1.5;
  graphCtx.setLineDash([6, 6]);
  graphCtx.stroke();
  graphCtx.setLineDash([]);

  drawGraphLine(graphCtx, histories.left, LEFT_GRAPH_COLOR);
  drawGraphLine(graphCtx, histories.right, RIGHT_GRAPH_COLOR);
  drawGraphLine(graphCtx, histories.mouth, MOUTH_GRAPH_COLOR);
}

export function updateScoreGraph(graphCtx, histories, threshold, sampleInterval, leftScore, rightScore, mouthScore) {
  graphSampleCountdown = (graphSampleCountdown + 1) % sampleInterval;
  if (graphSampleCountdown !== 0) {
    return;
  }

  pushGraphValue(histories.left, leftScore);
  pushGraphValue(histories.right, rightScore);
  pushGraphValue(histories.mouth, mouthScore);
  drawScoreGraph(graphCtx, histories, threshold);
}

export function resetScoreGraphState() {
  graphSampleCountdown = 0;
}

export function updateZoomTransform(container, lm, zoomEnabled) {
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

export function resetZoom(container) {
  smoothedZoomOx = 50;
  smoothedZoomOy = 50;
  smoothedZoomScale = 1;
  container.style.setProperty('--zoom-ox', '50%');
  container.style.setProperty('--zoom-oy', '50%');
  container.style.setProperty('--zoom-scale', '1');
}
