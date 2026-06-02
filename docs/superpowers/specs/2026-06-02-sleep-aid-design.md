# Sleep Aid — Design Spec

**Date:** 2026-06-02
**Status:** Approved
**Owner:** PJ
**Builds on:** v7 (network-first SW, shipped 2026-06-01)

## Goal

Add an in-app Sleep Aid feature to the night screen: a set of Web Audio API–generated sounds (binaural beats, brown noise, rain, 432 Hz tone, ocean waves) accessible via a bottom sheet while a sleep session is active. Fully offline, zero new dependencies, zero new files except `sleep-aid.js`.

## Constraints

- Vanilla JS only — no frameworks, no TypeScript, no installed packages.
- Web Audio API only — no audio files, no external URLs. Fully offline.
- Only available on the night screen (active session). Not a new tab.
- Additive: all existing behaviour unchanged.
- Dark theme, purple (#7c5cff) accent, system font.

## Architecture

New file `sleep-aid.js` is self-contained — mirrors the pattern of `liquid.js`. It owns:
- All audio generation logic (Web Audio API)
- Bottom sheet HTML (injected into `#night` on init)
- Timer countdown and auto-stop logic

`app.js` adds one call: `initSleepAid(nightEl)` on page load.
`index.html` adds one `<script src="sleep-aid.js">` and one `🎵 Sleep Aid` button inside `#night`.
`lib.js`, `liquid.js`, `style.css` — untouched.

### Public API

```js
initSleepAid(nightEl)
// Injects sheet HTML into nightEl, wires all listeners.
// Safe to call before the night section is visible.
// Returns nothing; no further calls needed from app.js.
```

## Feature: Night Screen Button

A `🎵 Sleep Aid` button is added to the night screen alongside the existing `I'm Awake` button. Tapping it opens the bottom sheet. While a sound is playing, the button label changes to `🎵 Playing…` (purple tint) so state is visible at a glance.

## Feature: Bottom Sheet

Slides up from the bottom of the night screen on button tap. Night clock and countdown remain visible behind it. Dismissed by tapping the backdrop or the ✕ close button.

### Sheet contents

1. **Sound tiles** — 5 pill-style buttons in a row (wrapping on small screens):
   - Brown Noise
   - Binaural Beats *(headphones note)*
   - Rain
   - 432 Hz
   - Ocean Waves
   - Active tile: filled purple. Inactive: dark outline. Tap active tile to stop.

2. **Timer selector** — four options inline: `15m · 30m · 45m · 60m`. Default: `30m`. Selectable while idle or while playing (resets timer to new value if playing).

3. **Countdown** — shown only while playing: `Stops in 28:45`. Updates every second.

4. **Stop button** — `■ Stop` — triggers 3s fade-out and resets sheet to idle.

### Sheet states

| State | Description |
|-------|-------------|
| Idle | No sound active. Tiles unlit. Timer selector shown, no countdown. |
| Playing | One tile lit purple. Countdown running. Stop button visible. |
| Fading | Last 3s of timer or manual stop. Tiles disabled. "Fading…" label. |

## Feature: Audio Engine

One shared `AudioContext` (created lazily on first tap — satisfies browser autoplay policy). One sound plays at a time.

**Switching sounds:** fade old `GainNode` to 0 over 0.5s, disconnect old nodes, start new generator, fade new gain from 0 to target over 0.5s. No clicks or pops.

**Sound generators:**

| Sound | Recipe |
|-------|--------|
| Brown Noise | White noise buffer → `BiquadFilterNode` lowpass (cutoff 200 Hz, Q 0.5) |
| Binaural Beats | Two `OscillatorNode` sines: 200 Hz (L pan −1) + 202 Hz (R pan +1) via `StereoPannerNode`. Delta = 2 Hz. |
| Rain | White noise → bandpass (800–2000 Hz) + second noise layer with LFO modulating gain (0.3–1.0 @ ~4 Hz) |
| 432 Hz Tone | `OscillatorNode` sine at 432 Hz, gain ≈ 0.12 |
| Ocean Waves | White noise → lowpass (400 Hz) → gain modulated by slow sine LFO (~0.08 Hz, ~12s cycle) |

**Master gain:** all generators route through a master `GainNode` → `destination`. Auto-stop fade and manual stop both target the master gain.

## Feature: Auto-stop Timer

- Options: 15 / 30 / 45 / 60 min. Default: 30 min.
- Countdown shown in sheet as `Stops in MM:SS`.
- At T−3s: `masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 3)`.
- At T=0: nodes disconnected, `AudioContext` suspended, sheet resets to idle.
- Manual stop: same 3s fade then reset.
- Session end (I'm Awake tapped): immediate stop (`AudioContext.suspend()`), no fade.

## Data / Persistence

No localStorage. Sound state is ephemeral — a fresh sheet every time the night screen opens. Timer selection is not persisted.

## Testing

- `sleep-aid.js` audio generators are browser-API-dependent — not unit-testable in Node.
- Verification via Playwright MCP: open night screen, tap Sleep Aid, confirm sheet appears, confirm sound tiles selectable, confirm countdown runs, confirm auto-stop resets sheet.
- No changes to `lib.js` → existing 62 unit tests unaffected.

## Out of scope

- Volume slider (can add later as a sheet enhancement)
- Persisting last-used sound or timer
- Multiple simultaneous sounds
- Any sound content requiring audio files or network
