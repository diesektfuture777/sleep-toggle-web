// Self-contained liquid wave animation on a <canvas>, tuned for a Pillow-like
// luminous gradient body with soft, layered, organic motion.
// Interface: start(canvas), setProgress(fraction 0..1), stop().

let raf = null;
let ctx = null;
let canvasEl = null;
let progress = 0;     // 0..1 target fill (sleep progress)
let shown = 0;        // eased fill actually drawn
let t = 0;

// Always show a substantial body of liquid, even near the start, like Pillow.
const MIN_FILL = 0.30;
const MAX_FILL = 0.92;

function resize() {
  if (!canvasEl) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvasEl.clientWidth || 320;
  const h = canvasEl.clientHeight || 320;
  canvasEl.width = Math.round(w * dpr);
  canvasEl.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Build a wave path across the canvas and close it down to the bottom.
// Each wave is a composite of two sines for an organic, non-repeating feel.
function wavePath(w, h, level, amp, freq, speed, phase) {
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, level);
  for (let x = 0; x <= w; x += 3) {
    const y = level
      + Math.sin(x * freq + t * speed + phase) * amp
      + Math.sin(x * freq * 2.3 + t * speed * 1.6 + phase) * amp * 0.28;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
}

function fillGradient(level, h, stops) {
  const g = ctx.createLinearGradient(0, level - 10, 0, h);
  for (const [pos, color] of stops) g.addColorStop(pos, color);
  return g;
}

function draw() {
  const w = canvasEl.clientWidth || 320;
  const h = canvasEl.clientHeight || 320;
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round';

  shown += (progress - shown) * 0.04;                 // ease toward target
  const fill = MIN_FILL + (MAX_FILL - MIN_FILL) * shown;
  const level = h * (1 - fill);
  t += 0.018;                                         // slow, calm motion

  // Back layer — deep, translucent, large slow swell.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  wavePath(w, h, level + 10, 20, 0.009, -0.45, 2.0);
  ctx.fillStyle = fillGradient(level, h, [
    [0, 'rgba(180, 90, 255, 0.20)'],
    [0.5, 'rgba(90, 70, 220, 0.22)'],
    [1, 'rgba(30, 30, 110, 0.30)'],
  ]);
  ctx.fill();
  ctx.restore();

  // Mid layer — the main luminous body, violet -> indigo -> deep navy.
  wavePath(w, h, level + 4, 15, 0.012, 0.6, 0.0);
  ctx.fillStyle = fillGradient(level, h, [
    [0, 'rgba(220, 130, 255, 0.85)'],
    [0.18, 'rgba(160, 80, 230, 0.85)'],
    [0.6, 'rgba(85, 60, 200, 0.84)'],
    [1, 'rgba(28, 28, 105, 0.90)'],
  ]);
  ctx.fill();

  // Front layer — brighter, faster ripple for surface detail.
  wavePath(w, h, level, 9, 0.016, 0.95, 4.0);
  ctx.fillStyle = fillGradient(level, h, [
    [0, 'rgba(255, 180, 235, 0.55)'],
    [0.4, 'rgba(180, 100, 240, 0.35)'],
    [1, 'rgba(70, 60, 190, 0.25)'],
  ]);
  ctx.fill();

  // Glowing crest highlight along the front waterline.
  ctx.save();
  ctx.shadowColor = 'rgba(190, 150, 255, 0.85)';
  ctx.shadowBlur = 18;
  ctx.strokeStyle = 'rgba(230, 200, 255, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 3) {
    const y = level
      + Math.sin(x * 0.016 + t * 0.95 + 4.0) * 9
      + Math.sin(x * 0.016 * 2.3 + t * 0.95 * 1.6 + 4.0) * 9 * 0.28;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  raf = requestAnimationFrame(draw);
}

export function start(canvas) {
  stop();
  canvasEl = canvas;
  ctx = canvas.getContext('2d');
  window.addEventListener('resize', resize);
  resize();
  raf = requestAnimationFrame(draw);
}

export function setProgress(fraction) {
  progress = Math.min(1, Math.max(0, fraction || 0));
}

export function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  window.removeEventListener('resize', resize);
}
