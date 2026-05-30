// Self-contained liquid wave animation on a <canvas>.
// Interface: start(canvas), setProgress(fraction 0..1), stop().

let raf = null;
let ctx = null;
let canvasEl = null;
let progress = 0;     // 0..1 target fill
let shown = 0;        // eased fill actually drawn
let t = 0;

function resize() {
  if (!canvasEl) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvasEl.clientWidth || 320;
  const h = canvasEl.clientHeight || 320;
  canvasEl.width = Math.round(w * dpr);
  canvasEl.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw() {
  const w = canvasEl.clientWidth || 320;
  const h = canvasEl.clientHeight || 320;
  ctx.clearRect(0, 0, w, h);

  shown += (progress - shown) * 0.05;            // ease toward target
  const level = h * (1 - shown);                 // y of the waterline
  t += 0.03;

  const layers = [
    { amp: 10, len: 1.2, speed: 1.0, alpha: 0.85, color: '255,106,0' },
    { amp: 14, len: 0.8, speed: -0.7, alpha: 0.45, color: '255,140,60' },
  ];

  for (const L of layers) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) {
      const y = level + Math.sin(x * 0.01 * L.len + t * L.speed) * L.amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = `rgba(${L.color},${L.alpha})`;
    ctx.fill();
  }

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
