# Background-Safe Sleep Audio + Lock-Screen Controls — Design

**Date:** 2026-06-03
**Status:** Approved, pending spec review
**File touched:** `sleep-aid.js` (plus minor `manifest`/icon reuse for artwork)

## Problem

The sleep aid uses the Web Audio API to synthesize sound in real time (oscillators
+ noise buffers routed through a master gain into `AudioContext.destination`). On
mobile — **iOS Safari especially** — the OS **suspends the `AudioContext` when the
phone locks**, so the sound stops. Synthesized Web Audio is not treated as
backgroundable "media," so iOS will not keep it alive on a locked screen.

Target platforms: **iOS Safari (binding constraint)** and Android Chrome.

## Goal

Audio keeps playing when the phone is locked, on iOS and Android, with a
lock-screen / Control Center now-playing control (play/pause + label).

## Decisions (from brainstorming)

- **Timer behavior while locked: best-effort (option B).** JavaScript timers freeze
  on a locked iPhone, so the auto-fade countdown is not guaranteed to fire while the
  screen is off. Audio keeps playing when locked; the timer fades/stops when the
  phone is next woken, or per whatever the OS allows. We do NOT bake fixed-length
  fade audio.
- **Lock-screen controls: yes (option A).** Provide MediaSession metadata + play/pause
  handlers so iOS/Android draw a now-playing card ("Sleep Aid · <sound>").
- **Approach A: pre-render synth → looping WAV blob → `<audio loop>`.** No shipped
  audio assets; stays pure-synthesis and offline/PWA-friendly; reuses all five
  existing generators unchanged. (Approach B = ship audio files; Approach C =
  MediaStream bridge, rejected because it still dies on iOS lock.)

## Architecture change

**Before:** generators → live `AudioContext` → `destination` → speakers (dies on lock).

**After:** generators → `OfflineAudioContext` (render once per sound) → **WAV blob** →
hidden **`<audio loop>`** element → speakers (survives lock).

The live playback `AudioContext` is dropped entirely. `OfflineAudioContext` is used
only to render buffers — it needs no user gesture and no suspend/resume handling. The
existing user gesture (tapping a sound tile) starts `<audio>` playback, which iOS
permits.

## New internal pieces (all inside `sleep-aid.js`)

- **`encodeWAV(audioBuffer) -> Blob`** — dependency-free interleaved PCM → 16-bit WAV
  encoder. Supports stereo (needed for binaural / panned sounds).
- **`renderLoop(soundDef) -> Promise<AudioBuffer>`** — creates
  `new OfflineAudioContext(2, sampleRate * seconds, sampleRate)`, runs the existing
  `fn(ctx, ctx.destination)` against it, returns `startRendering()`. Generators are
  reused **unchanged** — they only use APIs `OfflineAudioContext` supports
  (`createOscillator`, `createBufferSource`, `createBiquadFilter`,
  `createStereoPanner`, `createGain`).
- **`_blobCache` `{ soundId -> objectURL }`** — each sound renders once per session;
  switching back to a previously played sound is instant.
- **One hidden `<audio>` element** — created once in `initSleepAid`, `loop = true`,
  `playsinline`, appended to `document.body`. This is the single output device.

## Loop lengths (seamlessness)

- **binaural** — 0.5s: exactly 100 and 101 cycles of 200/202 Hz → zero seam, one full
  2 Hz beat per loop.
- **432 Hz** — short length that is a whole number of 432 Hz cycles.
- **brown / rain / ocean (noise + slow LFO)** — render ~20–30s, with loop length a
  whole multiple of the sound's LFO period (ocean LFO 0.08 Hz, rain LFO 4 Hz), plus a
  short (~50 ms) equal-power crossfade baked at the seam to kill residual click from
  the noise wrap. Implementation detail; exact lengths tuned during build.

## Playback / control flow

- **Play a sound:** ensure blob (render+cache if first time) → set `audio.src` to the
  object URL → `audio.loop = true` → `audio.volume = 1` → `audio.play()` → update
  sheet UI + MediaSession metadata + start best-effort countdown.
- **Switch sound:** same path; swap `audio.src`, replay. Cached sounds are instant.
- **Fade / stop (manual, tile re-tap, or timer-done):** ramp `audio.volume` to 0 over
  ~3s via `setInterval` (works while unlocked), then `audio.pause()`,
  `audio.removeAttribute('src')` / clear, reset UI, clear MediaSession. The `_isFading`
  guard from the current code is preserved to prevent double-fade / ghost state.
- **Timer (best-effort):** keep the existing `setInterval` countdown driving
  `doFadeStop` on expiry. Accept that it freezes while locked and resolves on wake.

## MediaSession (lock-screen card)

- On play: `navigator.mediaSession.metadata = new MediaMetadata({ title: sound.label,
  artist: 'Sleep Aid', artwork: [{ src: <existing app icon>, sizes, type }] })`.
- `navigator.mediaSession.playbackState = 'playing' | 'paused' | 'none'`.
- Action handlers: `play` → resume audio element; `pause` → pause (without tearing
  down, so it can resume); `stop` → `doFadeStop`. Feature-detected
  (`if ('mediaSession' in navigator)`), so unsupported browsers degrade silently.
- Artwork reuses an existing icon from `icons/` (referenced in `manifest.json`); no new
  asset.

## Public API / integration

- `initSleepAid(nightEl)` keeps the same signature and still returns `{ stop }`.
- `app.js` integration (import, init, `stopNight` calling `stop()`) is **unchanged**.
- `stop()` (session-end) tears down: clear countdown, fade-skip hard stop of the audio
  element, clear MediaSession, reset UI, close sheet.

## What does NOT change

- The bottom-sheet UI, sound tiles, timer buttons, CSS — all unchanged.
- The five generator functions — unchanged.
- `app.js`, `sw.js` cache list (no new assets), `manifest.json`.

## Error handling / edge cases

- **Render failure** (`OfflineAudioContext` unsupported / throws): catch, surface a
  silent no-op or minimal console warning; sheet stays usable.
- **`audio.play()` rejection** (autoplay policy): only ever called from the tile-tap
  gesture, so it should resolve; on rejection, reset UI rather than show a fake playing
  state.
- **Switching sounds mid-fade:** `_isFading` guard + cancel of the volume-ramp interval
  before starting a new sound.
- **MediaSession absent:** feature-detected; no-op.

## Testing

- **Unit-ish (desktop, `test/`):** `encodeWAV` produces a valid WAV header for a known
  buffer; `renderLoop` resolves to a 2-channel buffer of expected length per sound.
- **Functional (desktop localhost):** each sound plays through the `<audio>` element,
  switch/stop/timer-fade behave, MediaSession metadata is set (visible in browser
  media UI).
- **On-device (the real test):** open over HTTPS on an iPhone (Netlify deploy or local
  HTTPS), play a sound, **lock the phone — audio must continue**, lock-screen card shows
  with working pause/play. Repeat on Android Chrome.

### Serving for preview (decide at implementation time)

- **Desktop localhost** (`http://localhost:PORT`) — quick visual/functional check;
  MediaSession works; cannot truly test phone-lock.
- **Existing Netlify deploy** — real HTTPS on the iPhone; the genuine lock test.
- **Local HTTPS to phone** (`mkcert` self-signed or a tunnel) — test the local build
  on-device before deploying.

Note: plain `http://<lan-ip>:port` from the phone is not a secure context and will not
reliably enable MediaSession / background audio — HTTPS is required on-device.

## Out of scope

- Baking fixed-length fade audio for guaranteed locked-screen timer cutoff (rejected
  per decision B).
- New sounds, new UI, shipped audio files, volume slider.
