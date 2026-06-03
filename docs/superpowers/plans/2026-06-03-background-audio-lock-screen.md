# Background-Safe Sleep Audio + Lock-Screen Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the sleep-aid sound playing while the phone is locked (iOS Safari + Android) and show a lock-screen now-playing control.

**Architecture:** Drop the live `AudioContext` from the output path. Render each existing generator once into a short seamless loop via `OfflineAudioContext`, encode it to a WAV blob, and play it through one hidden `<audio loop>` element — which iOS keeps alive on lock. Add MediaSession metadata + play/pause/stop handlers for the lock-screen card.

**Tech Stack:** Vanilla JS (ES modules), Web Audio (`OfflineAudioContext`), HTML `<audio>`, MediaSession API. Tests: `node --test`. Local serve: `python3 -m http.server`. Build: `tools/build-dist.sh`.

**Spec:** `docs/superpowers/specs/2026-06-03-background-audio-lock-screen-design.md`

---

## File Structure

- **Create `wav.js`** — pure, dependency-free, node-testable. Two functions: `encodeWAV(channels, sampleRate)` (PCM→16-bit WAV bytes) and `crossfadeLoop(channels, sampleRate, fadeSec)` (seamless-wrap helper). No browser globals, so `node --test` can import it.
- **Create `test/wav.test.mjs`** — unit tests for the two pure functions.
- **Modify `sleep-aid.js`** — replace the live-context output path with: a hidden `<audio>` element, `renderLoop`/blob cache built on `OfflineAudioContext`, volume-based fade, and MediaSession wiring. Generators (`startBrownNoise` … `startOcean`) and the sheet UI stay unchanged.
- **Modify `sw.js`** — add `./wav.js` to the precache list.
- **Modify `tools/build-dist.sh`** — copy `wav.js` into `dist/` and include it in the cache hash.

Browser-only code (audio element, `OfflineAudioContext`, MediaSession) is verified functionally on localhost and on-device, not via `node --test`. Only `wav.js` is unit-tested.

---

### Task 1: WAV encoder (`encodeWAV`)

**Files:**
- Create: `wav.js`
- Test: `test/wav.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/wav.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWAV } from '../wav.js';

const str = (bytes, off, len) =>
  String.fromCharCode(...bytes.subarray(off, off + len));
const u32 = (bytes, off) =>
  bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24);
const u16 = (bytes, off) => bytes[off] | (bytes[off + 1] << 8);

test('encodeWAV writes a valid stereo 16-bit PCM header', () => {
  const left = new Float32Array([0, 0.5, -0.5, 1]);
  const right = new Float32Array([0, -0.5, 0.5, -1]);
  const bytes = encodeWAV([left, right], 44100);

  assert.equal(str(bytes, 0, 4), 'RIFF');
  assert.equal(str(bytes, 8, 4), 'WAVE');
  assert.equal(str(bytes, 12, 4), 'fmt ');
  assert.equal(u16(bytes, 20), 1, 'format = PCM');
  assert.equal(u16(bytes, 22), 2, 'channels = 2');
  assert.equal(u32(bytes, 24), 44100, 'sample rate');
  assert.equal(u16(bytes, 34), 16, 'bits per sample');
  assert.equal(str(bytes, 36, 4), 'data');
  // 4 frames * 2 channels * 2 bytes = 16 bytes of data
  assert.equal(u32(bytes, 40), 16);
  assert.equal(bytes.length, 44 + 16);
});

test('encodeWAV clamps and quantizes a full-scale sample', () => {
  const bytes = encodeWAV([new Float32Array([1])], 8000); // mono, one frame
  // last 2 bytes = first sample, little-endian signed 16-bit ~ 0x7fff
  const lo = bytes[44], hi = bytes[45];
  const val = (hi << 8) | lo;
  assert.equal(val, 0x7fff);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/wav.test.mjs`
Expected: FAIL — `Cannot find module '../wav.js'` (file not created yet).

- [ ] **Step 3: Write minimal implementation**

```js
// wav.js — pure, dependency-free audio helpers (node-testable, no browser globals)

// channels: array of Float32Array (one per channel), all the same length.
// Returns a Uint8Array of 16-bit PCM WAV bytes.
export function encodeWAV(channels, sampleRate) {
  const numCh = channels.length;
  const numFrames = channels[0].length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataLen = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);

  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);            // fmt chunk size
  view.setUint16(20, 1, true);             // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);

  let off = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][i]));
      s = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(off, s, true);
      off += 2;
    }
  }
  return new Uint8Array(buffer);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/wav.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add wav.js test/wav.test.mjs
git commit -m "feat: add dependency-free WAV encoder (wav.js)"
```

---

### Task 2: Seamless-loop crossfade (`crossfadeLoop`)

**Files:**
- Modify: `wav.js`
- Test: `test/wav.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// append to test/wav.test.mjs
import { crossfadeLoop } from '../wav.js';

test('crossfadeLoop trims the fade region and stays in range', () => {
  const sr = 1000;
  const fadeSec = 0.01; // 10 samples
  const total = 100;
  const data = new Float32Array(total);
  for (let i = 0; i < total; i++) data[i] = Math.sin(i / 5);

  const [out] = crossfadeLoop([data], sr, fadeSec);
  assert.equal(out.length, total - 10, 'output is shortened by the fade length');
  for (const v of out) assert.ok(v >= -1 && v <= 1, 'samples stay in [-1, 1]');
});

test('crossfadeLoop with zero fade returns channels unchanged', () => {
  const data = new Float32Array([0.1, 0.2, 0.3]);
  const [out] = crossfadeLoop([data], 1000, 0);
  assert.deepEqual([...out], [0.1, 0.2, 0.3]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/wav.test.mjs`
Expected: FAIL — `crossfadeLoop` is not exported.

- [ ] **Step 3: Write minimal implementation**

```js
// append to wav.js

// Render the source as (loop + fade) seconds, then equal-power crossfade the
// tail `fade` region back over the head. Returns channels of length
// (input length - fade samples) that loop seamlessly.
export function crossfadeLoop(channels, sampleRate, fadeSec) {
  const fade = Math.floor(fadeSec * sampleRate);
  if (fade <= 0) return channels;
  const total = channels[0].length;
  const outLen = total - fade;
  return channels.map((data) => {
    const out = new Float32Array(outLen);
    out.set(data.subarray(0, outLen));
    for (let i = 0; i < fade; i++) {
      const t = i / fade;                      // 0..1
      const wHead = Math.cos((t * Math.PI) / 2); // 1 -> 0
      const wTail = Math.sin((t * Math.PI) / 2); // 0 -> 1
      out[i] = out[i] * wHead + data[outLen + i] * wTail;
    }
    return out;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/wav.test.mjs`
Expected: PASS (4 tests total).

- [ ] **Step 5: Commit**

```bash
git add wav.js test/wav.test.mjs
git commit -m "feat: add seamless-loop crossfade helper (crossfadeLoop)"
```

---

### Task 3: Render generators to cached blob URLs in `sleep-aid.js`

**Files:**
- Modify: `sleep-aid.js`

This task adds the offline-render path and the hidden `<audio>` element. It does
not yet rewire playback (Task 4) — but after this task the module still imports
and `node --test` for `wav.js` stays green.

- [ ] **Step 1: Add the import at the top of `sleep-aid.js`**

At the very top of the file (line 1, above the existing comment is fine), add:

```js
import { encodeWAV, crossfadeLoop } from './wav.js';
```

- [ ] **Step 2: Replace the module-state + audio-helpers block**

Replace the block from `// ---------- module state ----------` through the end of
`async function getCtx() { ... }` (current lines 133–155) with:

```js
// ---------- module state ----------

let _audioEl = null;
let _activeSoundId = null;
let _timerMins = 30;
let _timerEnd = null;
let _countdownHandle = null;
let _fadeHandle = null;
let _isFading = false;
const _blobCache = {}; // soundId -> object URL

// Per-sound loop config. Lengths chosen so the loop wraps cleanly:
// binaural 0.5s = 100 & 101 cycles of 200/202 Hz (seamless, no crossfade);
// hz432 1.0s = 432 whole cycles (seamless); noise/LFO sounds use a whole
// number of LFO periods plus a short crossfade to hide the noise wrap.
const LOOP_CFG = {
  brown:    { sec: 30,  fade: 0.05 },
  binaural: { sec: 0.5, fade: 0    },
  rain:     { sec: 30,  fade: 0.05 },
  hz432:    { sec: 1.0, fade: 0    },
  ocean:    { sec: 25,  fade: 0.05 },
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
```

- [ ] **Step 3: Replace `stopActiveNodes` with audio-element teardown + fade helper**

Replace the current `stopActiveNodes` function (current lines 157–161) with:

```js
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
```

- [ ] **Step 4: Verify the module still parses and wav tests pass**

Run: `node --test test/wav.test.mjs`
Expected: PASS (4 tests). (`sleep-aid.js` is browser-only; this just confirms we
did not break the shared `wav.js` import.)

- [ ] **Step 5: Commit**

```bash
git add sleep-aid.js
git commit -m "feat: offline-render sleep-aid loops to cached WAV blobs"
```

---

### Task 4: Play through the `<audio>` element + volume fade

**Files:**
- Modify: `sleep-aid.js`

- [ ] **Step 1: Create the hidden `<audio>` element in `initSleepAid`**

In `initSleepAid`, immediately after `const { backdrop, sheet } = buildSheet();`,
add:

```js
  _audioEl = document.createElement('audio');
  _audioEl.loop = true;
  _audioEl.setAttribute('playsinline', '');
  _audioEl.hidden = true;
  document.body.appendChild(_audioEl);
```

- [ ] **Step 2: Replace `doFadeStop` with a volume-ramp fade**

Replace the entire current `doFadeStop` function (current lines 280–306) with:

```js
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
```

- [ ] **Step 3: Replace `playSound` with the audio-element path**

Replace the entire current `playSound` function (current lines 308–325) with:

```js
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
```

- [ ] **Step 4: Replace the session-end `stop` function**

Replace the entire current `stop` function (current lines 362–373) with:

```js
  function stop() {
    _isFading = false;
    clearFadeInterval();
    clearCountdown();
    hardStopAudio();
    clearMediaSession();
    resetSheetUI(sheet, triggerBtn);
    closeSheet(backdrop, sheet);
  }
```

- [ ] **Step 5: Functional check on localhost**

Run: `python3 -m http.server 8000` then open `http://localhost:8000` in Chrome,
start a night, open Sleep Aid, tap each sound.
Expected: each sound plays through the `<audio>` element (check DevTools → Elements
for a `<audio>` with a `blob:` src), tapping the active tile fades it out over ~3s,
the Stop button works, switching sounds is instant on the second play. No console
errors (MediaSession functions arrive in Task 5 — if `setupMediaSession` is
undefined here, do Task 5 before this check, or temporarily expect that one
ReferenceError).

- [ ] **Step 6: Commit**

```bash
git add sleep-aid.js
git commit -m "feat: play sleep aid via <audio> element with volume fade"
```

---

### Task 5: MediaSession lock-screen card

**Files:**
- Modify: `sleep-aid.js`

- [ ] **Step 1: Add MediaSession helpers inside `initSleepAid`**

Inside `initSleepAid`, just above the `function doFadeStop()` definition, add:

```js
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
```

- [ ] **Step 2: Functional check on localhost (desktop media UI)**

Run: `python3 -m http.server 8000`, open `http://localhost:8000` in Chrome, play a
sound, then check the OS / browser media UI (macOS: Now Playing in Control Center,
or `chrome://media-internals`). 
Expected: shows "Sleep Aid · <sound label>" with artwork; pause/play from that UI
controls the sound; no console errors.

- [ ] **Step 3: Commit**

```bash
git add sleep-aid.js
git commit -m "feat: MediaSession lock-screen metadata + play/pause/stop handlers"
```

---

### Task 6: Add `wav.js` to service worker + build

**Files:**
- Modify: `sw.js:2-13`
- Modify: `tools/build-dist.sh`

- [ ] **Step 1: Add `./wav.js` to the SW precache list**

In `sw.js`, in the `ASSETS` array, add `'./wav.js',` right after the `'./sleep-aid.js',`
line:

```js
  './sleep-aid.js',
  './wav.js',
```

- [ ] **Step 2: Copy `wav.js` in the build script**

In `tools/build-dist.sh`, add `wav.js` to the `cp` line so it reads:

```bash
cp index.html app.js lib.js liquid.js sleep-aid.js wav.js style.css manifest.json sw.js dist/
```

- [ ] **Step 3: Include `wav.js` in the cache hash**

In `tools/build-dist.sh`, add `dist/wav.js` to the `cat` for the hash:

```bash
HASH=$(cat dist/index.html dist/app.js dist/lib.js dist/liquid.js dist/sleep-aid.js dist/wav.js dist/style.css \
  dist/manifest.json dist/icons/icon-192.png dist/icons/icon-512.png \
  | shasum | cut -c1-10)
```

- [ ] **Step 4: Run the build to verify**

Run: `bash tools/build-dist.sh`
Expected: prints `dist/ ready (cache: sleep-toggle-XXXXXXXXXX):` and the file list
includes `dist/wav.js` and `dist/sleep-aid.js`.

- [ ] **Step 5: Run all tests**

Run: `node --test`
Expected: all `lib` and `wav` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add sw.js tools/build-dist.sh dist
git commit -m "build: include wav.js in service worker precache and dist build"
```

---

### Task 7: On-device verification (the real lock test)

**Files:** none (manual verification).

- [ ] **Step 1: Serve over HTTPS reachable by the phone.** Either deploy `dist/` to
  Netlify (existing flow) or run a local HTTPS server / tunnel. Plain
  `http://<lan-ip>:port` will NOT work — iOS needs a secure context for MediaSession
  and reliable background audio.

- [ ] **Step 2: iPhone (Safari).** Open the URL, start a night, open Sleep Aid, play
  a sound. **Lock the phone.** 
  Expected: audio keeps playing while locked; the lock screen shows a "Sleep Aid"
  now-playing card with working pause/play.

- [ ] **Step 3: iPhone — timer best-effort.** Set a 15m timer, lock, leave it.
  Expected (per spec decision B): audio continues; the fade is best-effort and may
  only resolve when the phone is next woken. This is acceptable, not a bug.

- [ ] **Step 4: Android (Chrome).** Repeat Step 2.
  Expected: audio continues when locked; notification/lock-screen media card present.

- [ ] **Step 5: Mark the plan complete / note any device-specific follow-ups.**

---

## Self-Review Notes

- **Spec coverage:** offline-render→blob→`<audio>` (Tasks 3–4), seamless loops
  (Tasks 1–2 + `LOOP_CFG`), volume fade (Task 4), best-effort timer (reuses existing
  countdown, Task 4), MediaSession card (Task 5), no new assets / unchanged UI &
  generators & `app.js` (verified by leaving those files untouched), SW + build
  (Task 6), on-device test (Task 7). All covered.
- **Removed dead code:** `_ctx`, `_masterGain`, `getCtx`, `stopActiveNodes` are
  replaced; no remaining references (`playSound`, `doFadeStop`, `stop` all rewritten
  in Task 4; sheet/timer/generator code untouched).
- **Naming consistency:** `clearFadeInterval`, `hardStopAudio`, `getBlobUrl`,
  `renderLoop`, `setupMediaSession`, `clearMediaSession`, `_audioEl`, `_blobCache`,
  `LOOP_CFG`, `SAMPLE_RATE` used consistently across tasks.
