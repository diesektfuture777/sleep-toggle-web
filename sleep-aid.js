// sleep-aid.js — Web Audio API sound generators + bottom sheet UI
import { encodeWAV, crossfadeLoop } from './wav.js';

// ---------- audio utilities ----------

function makeNoiseBuffer(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function startBrownNoise(ctx, dest) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5; // scale up to audible level
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0.8;
  src.connect(gain);
  gain.connect(dest);
  src.start();
  return [src, gain];
}

function startBinaural(ctx, dest) {
  const oscL = ctx.createOscillator();
  oscL.type = 'sine';
  oscL.frequency.value = 200;
  const oscR = ctx.createOscillator();
  oscR.type = 'sine';
  oscR.frequency.value = 202;
  const panL = ctx.createStereoPanner();
  panL.pan.value = -1;
  const panR = ctx.createStereoPanner();
  panR.pan.value = 1;
  oscL.connect(panL); panL.connect(dest);
  oscR.connect(panR); panR.connect(dest);
  oscL.start();
  oscR.start();
  return [oscL, oscR, panL, panR];
}

function startRain(ctx, dest) {
  const buf1 = makeNoiseBuffer(ctx);
  const src1 = ctx.createBufferSource();
  src1.buffer = buf1;
  src1.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1200;
  bp.Q.value = 0.8;
  src1.connect(bp);
  bp.connect(dest);
  src1.start();

  const buf2 = makeNoiseBuffer(ctx);
  const src2 = ctx.createBufferSource();
  src2.buffer = buf2;
  src2.loop = true;
  const gainNode = ctx.createGain();
  gainNode.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 4;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.3;
  lfo.connect(lfoGain);
  lfoGain.connect(gainNode.gain);
  src2.connect(gainNode);
  gainNode.connect(dest);
  src2.start();
  lfo.start();

  return [src1, bp, src2, gainNode, lfo, lfoGain];
}

function start432Hz(ctx, dest) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 432;
  const gain = ctx.createGain();
  gain.gain.value = 0.12;
  osc.connect(gain);
  gain.connect(dest);
  osc.start();
  return [osc, gain];
}

function startOcean(ctx, dest) {
  const buf = makeNoiseBuffer(ctx);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 400;
  const gainNode = ctx.createGain();
  gainNode.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.08;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.4;
  lfo.connect(lfoGain);
  lfoGain.connect(gainNode.gain);
  src.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(dest);
  src.start();
  lfo.start();
  return [src, filter, gainNode, lfo, lfoGain];
}

function startWhiteNoise(ctx, dest) {
  const len = ctx.length || ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0.45;
  src.connect(gain);
  gain.connect(dest);
  src.start();
  return [src, gain];
}

function startPinkNoise(ctx, dest) {
  // Paul Kellet's refined pink-noise filter, baked straight into the buffer.
  const len = ctx.length || ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0.7;
  src.connect(gain);
  gain.connect(dest);
  src.start();
  return [src, gain];
}

function startWind(ctx, dest) {
  // Filtered noise with a slowly sweeping lowpass cutoff + amplitude swell.
  // LFO rates are whole cycles per 30s loop so the envelope wraps seamlessly.
  const len = ctx.length || ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  lp.Q.value = 0.5;
  const cutoffLfo = ctx.createOscillator();
  cutoffLfo.type = 'sine';
  cutoffLfo.frequency.value = 0.1;      // 3 cycles / 30s
  const cutoffDepth = ctx.createGain();
  cutoffDepth.gain.value = 300;
  cutoffLfo.connect(cutoffDepth);
  cutoffDepth.connect(lp.frequency);

  const gain = ctx.createGain();
  gain.gain.value = 0.9;
  const ampLfo = ctx.createOscillator();
  ampLfo.type = 'sine';
  ampLfo.frequency.value = 2 / 30;      // 2 cycles / 30s
  const ampDepth = ctx.createGain();
  ampDepth.gain.value = 0.25;
  ampLfo.connect(ampDepth);
  ampDepth.connect(gain.gain);

  src.connect(lp);
  lp.connect(gain);
  gain.connect(dest);
  src.start();
  cutoffLfo.start();
  ampLfo.start();
  return [src, lp, cutoffLfo, cutoffDepth, gain, ampLfo, ampDepth];
}

// ---------- sound catalog ----------

const SOUNDS = [
  { id: 'brown',    label: 'Brown Noise',    note: null,            fn: startBrownNoise },
  { id: 'white',    label: 'White Noise',    note: null,            fn: startWhiteNoise },
  { id: 'pink',     label: 'Pink Noise',     note: null,            fn: startPinkNoise  },
  { id: 'binaural', label: 'Binaural Beats', note: '🎧 headphones', fn: startBinaural   },
  { id: 'rain',     label: 'Rain',           note: null,            fn: startRain       },
  { id: 'ocean',    label: 'Ocean Waves',    note: null,            fn: startOcean      },
  { id: 'wind',     label: 'Wind',           note: null,            fn: startWind       },
  { id: 'hz432',    label: '432 Hz',         note: null,            fn: start432Hz      },
];

// ---------- module state ----------

let _audioEl = null;
let _activeSoundId = null;
let _timerMins = 30;
let _timerEnd = null;
let _countdownHandle = null;
let _fadeHandle = null;
let _isFading = false;
const _blobCache = {}; // soundId -> object URL

// Per-sound loop config. Lengths chosen so the loop wraps cleanly AND the
// loop boundary is hit rarely — HTML <audio loop> is not gapless, so a short
// loop injects an audible transient at every wrap (a 0.5s binaural loop ticked
// twice a second = a 2Hz "blink"). Pure tones therefore use a long 30s loop:
// binaural 30s = 6000 & 6060 whole cycles of 200/202 Hz; hz432 30s = 12960
// whole cycles — both seamless, no crossfade. Noise/LFO sounds use a whole
// number of LFO periods plus a short crossfade to hide the noise wrap.
const LOOP_CFG = {
  brown:    { sec: 30,  fade: 0.05 },
  white:    { sec: 30,  fade: 0.05 },
  pink:     { sec: 30,  fade: 0.05 },
  binaural: { sec: 30,  fade: 0    },
  rain:     { sec: 30,  fade: 0.05 },
  ocean:    { sec: 25,  fade: 0.05 },
  wind:     { sec: 30,  fade: 0.05 },
  hz432:    { sec: 30,  fade: 0    },
};
const SAMPLE_RATE = 44100;

// ---------- audio rendering ----------

async function renderLoop(sound) {
  const cfg = LOOP_CFG[sound.id] || { sec: 20, fade: 0.05 };
  const frames = Math.ceil(SAMPLE_RATE * (cfg.sec + cfg.fade));
  const oac = new OfflineAudioContext(2, frames, SAMPLE_RATE);
  sound.fn(oac, oac.destination); // generators reused unchanged
  const buf = await oac.startRendering();
  let channels = [buf.getChannelData(0), buf.getChannelData(1)];
  if (cfg.fade > 0) channels = crossfadeLoop(channels, SAMPLE_RATE, cfg.fade);
  const bytes = encodeWAV(channels, SAMPLE_RATE);
  const blob = new Blob([bytes], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

async function getBlobUrl(sound) {
  if (!_blobCache[sound.id]) _blobCache[sound.id] = await renderLoop(sound);
  return _blobCache[sound.id];
}

// ---------- audio helpers ----------

function clearFadeInterval() {
  clearInterval(_fadeHandle);
  _fadeHandle = null;
}

function hardStopAudio() {
  if (_audioEl) {
    _audioEl.pause();
    _audioEl.removeAttribute('src');
    _audioEl.load();
    _audioEl.volume = 1;
  }
  _activeSoundId = null;
}

function clearCountdown() {
  clearInterval(_countdownHandle);
  _countdownHandle = null;
  _timerEnd = null;
}

function fmtCountdown(ms) {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------- sheet DOM ----------

function buildSheet() {
  const backdrop = document.createElement('div');
  backdrop.className = 'sa-backdrop';

  const sheet = document.createElement('div');
  sheet.className = 'sa-sheet';

  const soundsHTML = SOUNDS.map((s) => `
    <button class="sa-sound" data-id="${s.id}" type="button">
      ${s.label}${s.note ? `<span class="sa-sound-note">${s.note}</span>` : ''}
    </button>
  `).join('');

  sheet.innerHTML = `
    <div class="sa-handle"></div>
    <div class="sa-header">
      <h3 class="sa-title">Sleep Aid</h3>
      <button class="sa-close" type="button" aria-label="Close">✕</button>
    </div>
    <div class="sa-sounds">${soundsHTML}</div>
    <div class="sa-timer-row">
      <button class="sa-timer" data-mins="15" type="button">15m</button>
      <button class="sa-timer active" data-mins="30" type="button">30m</button>
      <button class="sa-timer" data-mins="45" type="button">45m</button>
      <button class="sa-timer" data-mins="60" type="button">60m</button>
    </div>
    <p class="sa-countdown" hidden></p>
    <button class="sa-stop" type="button" hidden>■ Stop</button>
  `;

  document.body.append(backdrop, sheet);
  return { backdrop, sheet };
}

function openSheet(backdrop, sheet) {
  backdrop.classList.add('open');
  void backdrop.offsetHeight; // force reflow so transition fires
  sheet.classList.add('open');
}

function closeSheet(backdrop, sheet) {
  backdrop.classList.remove('open');
  sheet.classList.remove('open');
}

function resetSheetUI(sheet, triggerBtn) {
  sheet.querySelectorAll('.sa-sound').forEach((b) => {
    b.classList.remove('active');
    b.disabled = false;
  });
  sheet.querySelector('.sa-countdown').hidden = true;
  sheet.querySelector('.sa-stop').hidden = true;
  if (triggerBtn) {
    triggerBtn.textContent = '🎵 Sleep Aid';
    triggerBtn.classList.remove('playing');
  }
}

function setPlaying(sheet, soundId, triggerBtn) {
  sheet.querySelectorAll('.sa-sound').forEach((b) => {
    b.classList.toggle('active', b.dataset.id === soundId);
  });
  sheet.querySelector('.sa-stop').hidden = false;
  if (triggerBtn) {
    triggerBtn.textContent = '🎵 Playing…';
    triggerBtn.classList.add('playing');
  }
}

function startCountdown(sheet, onDone) {
  _timerEnd = Date.now() + _timerMins * 60 * 1000;
  const countdown = sheet.querySelector('.sa-countdown');
  countdown.hidden = false;

  const tick = () => {
    const remaining = _timerEnd - Date.now();
    if (remaining <= 0) {
      countdown.textContent = 'Fading…';
      sheet.querySelectorAll('.sa-sound').forEach((b) => { b.disabled = true; });
      clearInterval(_countdownHandle);
      _countdownHandle = null;
      onDone();
      return;
    }
    countdown.textContent = `Stops in ${fmtCountdown(remaining)}`;
  };
  tick();
  _countdownHandle = setInterval(tick, 1000);
}

// ---------- public API ----------

export function initSleepAid(nightEl) {
  const triggerBtn = nightEl.querySelector('#sleepAidBtn');
  const { backdrop, sheet } = buildSheet();

  _audioEl = document.createElement('audio');
  _audioEl.loop = true;
  _audioEl.setAttribute('playsinline', '');
  _audioEl.hidden = true;
  document.body.appendChild(_audioEl);

  const saClose = sheet.querySelector('.sa-close');
  const saStop = sheet.querySelector('.sa-stop');
  const saSoundsEl = sheet.querySelector('.sa-sounds');
  const saTimerRow = sheet.querySelector('.sa-timer-row');

  function setupMediaSession(sound) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: sound.label,
      artist: 'Sleep Aid',
      artwork: [
        { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
    navigator.mediaSession.playbackState = 'playing';
    navigator.mediaSession.setActionHandler('play', () => {
      _audioEl.play();
      navigator.mediaSession.playbackState = 'playing';
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      _audioEl.pause();
      navigator.mediaSession.playbackState = 'paused';
    });
    navigator.mediaSession.setActionHandler('stop', () => doFadeStop());
  }

  function clearMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = 'none';
    navigator.mediaSession.metadata = null;
    try {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('stop', null);
    } catch (_) {}
  }

  function doFadeStop() {
    if (_isFading) return;
    _isFading = true;
    clearFadeInterval();
    const steps = 30;
    const durMs = 3000;
    const startVol = _audioEl ? _audioEl.volume : 0;
    let i = 0;
    _fadeHandle = setInterval(() => {
      i++;
      if (_audioEl) _audioEl.volume = Math.max(0, startVol * (1 - i / steps));
      if (i >= steps) {
        clearFadeInterval();
        hardStopAudio();
        _isFading = false;
        clearCountdown();
        clearMediaSession();
        resetSheetUI(sheet, triggerBtn);
        closeSheet(backdrop, sheet);
      }
    }, durMs / steps);
  }

  async function playSound(soundId) {
    _isFading = false;
    clearFadeInterval();
    clearCountdown();
    const sound = SOUNDS.find((s) => s.id === soundId);
    if (!sound) return;

    let url;
    try {
      url = await getBlobUrl(sound);
    } catch (e) {
      console.warn('sleep-aid: render failed', e);
      resetSheetUI(sheet, triggerBtn);
      return;
    }

    _audioEl.src = url;
    _audioEl.loop = true;
    _audioEl.volume = 1;
    try {
      await _audioEl.play();
    } catch (e) {
      console.warn('sleep-aid: play rejected', e);
      resetSheetUI(sheet, triggerBtn);
      return;
    }

    _activeSoundId = soundId;
    setPlaying(sheet, soundId, triggerBtn);
    setupMediaSession(sound);
    startCountdown(sheet, doFadeStop);
  }

  // Sound tile clicks
  saSoundsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.sa-sound');
    if (!btn || btn.disabled) return;
    const id = btn.dataset.id;
    if (id === _activeSoundId) {
      doFadeStop();
    } else {
      playSound(id);
    }
  });

  // Timer selector
  saTimerRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.sa-timer');
    if (!btn) return;
    _timerMins = Number(btn.dataset.mins);
    saTimerRow.querySelectorAll('.sa-timer').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    if (_activeSoundId) {
      clearCountdown();
      startCountdown(sheet, doFadeStop);
    }
  });

  // Manual stop
  saStop.addEventListener('click', () => doFadeStop());

  // Open/close
  triggerBtn.addEventListener('click', () => openSheet(backdrop, sheet));
  backdrop.addEventListener('click', () => closeSheet(backdrop, sheet));
  saClose.addEventListener('click', () => closeSheet(backdrop, sheet));

  // Session-end stop (called from app.js stopNight)
  function stop() {
    _isFading = false;
    clearFadeInterval();
    clearCountdown();
    hardStopAudio();
    clearMediaSession();
    resetSheetUI(sheet, triggerBtn);
    closeSheet(backdrop, sheet);
  }

  return { stop };
}
