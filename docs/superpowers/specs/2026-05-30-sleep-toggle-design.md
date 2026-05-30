# Sleep Toggle — MVP Design Spec

**Date:** 2026-05-30
**Status:** Approved (design), pending implementation plan
**Owner:** PJ

## Goal

Ship a today-finishable, mobile-first web sleep tracker. Manual start/stop only.
Works well when added to the iOS Home Screen (PWA-lite, offline-friendly). No backend, no auth.

## Constraints

- Vanilla JS only — no frameworks, no TypeScript.
- Mobile-first.
- Works as Safari "Add to Home Screen" with offline support.
- No Apple Health, no Watch, no sleep stages (v1).
- No backend, no auth, no multi-device sync (v1).
- Hosted on a static HTTPS host (Netlify Drop recommended) so the service worker registers.

## Architecture

Single-screen vanilla-JS app. All state in `localStorage`. Service worker caches only the
static shell for offline cold-launch; data persistence is independent of the SW.

```
sleep-toggle-web/
  index.html      — markup + iOS meta tags
  style.css       — mobile-first dark UI
  app.js          — state, storage, rendering
  manifest.json   — PWA metadata
  sw.js           — offline asset cache
  icons/          — 192px + 512px app icons
  README.md       — run + deploy + data model
```

## Data model

One localStorage key: `sleepToggle.sessions.v1` → JSON array of session objects.

```js
{
  id:        string,        // unique (e.g. crypto.randomUUID())
  startTs:   number,        // ms epoch
  endTs:     number | null, // ms epoch; null === running
  tz:        string,        // IANA tz if available, else "UTC+HH:MM" offset label
  rating:    number | null, // 1-5
  note:      string,        // may be ""
  createdAt: number,        // ms epoch
  updatedAt: number         // ms epoch
}
```

**Invariant:** at most ONE session may have `endTs === null` (the running session).
This invariant drives all guard logic.

### Duration

- Computed in minutes from `endTs - startTs`.
- Displayed as `Xh Ym` (rounded to nearest minute).
- Also show exact local start/end times with the device's timezone label (no hardcoded SGT).

## Core flows

1. **Start Sleep** — create a session with `startTs = now`, `endTs = null`.
   - If a session is already running: show a clear warning, do NOT create a duplicate.
2. **I'm Awake** — confirm dialog (easy to mis-tap) → set `endTs = now`.
   - Guard: if `endTs <= startTs`, reject (no negative/zero durations).
   - After ending, prompt for rating (1–5) + optional note (wake check-in).
3. **Reload mid-sleep** — on load, detect the open session and render the "sleeping" UI
   state, including a live elapsed timer.
4. **Double-tap guard** — primary button briefly disables on tap and re-checks current
   state before acting, so users can't create dupes or end twice.
5. **Edit last session** — adjust start/end of the most recent session; recompute and
   re-render duration immediately.
6. **Export** — CSV including all sessions. Stable column format including timezone.
   "Download CSV" + "Copy CSV" (Clipboard API with a fallback message if unsupported).

## UI

- One big primary button that flips **Start Sleep ↔ I'm Awake** based on state.
- Last session card (duration + start/end times).
- Last-7-days list + average duration.
- Secondary actions: **Edit last**, **Export**.
- Dark theme, mobile-first spacing, clear button states (idle / disabled / sleeping).

## PWA + offline

- `manifest.json`: `name`, `short_name`, dark `theme_color` / `background_color`,
  `display: standalone`, 192 + 512 icons.
- iOS meta tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`,
  `apple-touch-icon`, viewport.
- `sw.js`: precache the static shell (index.html, style.css, app.js, manifest.json, icons)
  so the app cold-launches offline. Cache-first for the shell.

## CSV format

Stable header row, one row per session. Columns:
`id, startISO, endISO, durationMin, tz, rating, note`
- Timestamps exported as ISO 8601.
- `note` is CSV-escaped (quotes doubled, wrapped in quotes if it contains comma/quote/newline).

## Out of scope (v1)

Apple Health, Watch, sleep stages, backend, auth, multi-device sync, reminders/alarms,
charts beyond the 7-day list/average.

## Verification (done = )

Test the 5 flows in desktop browser mobile-emulation:
1. New session start
2. Reload mid-session (state preserved, timer live)
3. End session + rating/note captured
4. Edit last session (duration recomputes)
5. Export (download + copy)

Then deploy to Netlify (HTTPS) and confirm on the real iPhone:
- Add to Home Screen launches standalone
- Offline launch works (airplane mode)
