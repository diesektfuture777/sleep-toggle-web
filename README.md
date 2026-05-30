# Sleep Toggle

Mobile-first, offline-capable web sleep tracker. Manual start/stop. No backend, no auth.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Service workers only register over HTTPS or `localhost` — use `localhost`, not the LAN IP, for local PWA testing.

## Tests

```bash
node --test
```

Covers the pure logic in `lib.js` (formatting, CSV, stats, the single-running-session invariant). No dependencies — uses Node's built-in test runner.

## Deploy (Netlify Drop)

1. Go to https://app.netlify.com/drop
2. Drag the whole `sleep-toggle-web` folder onto the page.
3. Open the generated HTTPS URL on your iPhone in Safari.
4. Share → **Add to Home Screen**. Launches standalone; works offline after first load.

When you change files, bump `CACHE` in `sw.js` (e.g. `sleep-toggle-v2` → `v3`) so clients pick up the new version.

## Data model

All data is in `localStorage` under the single key `sleepToggle.sessions.v1` — a JSON array of:

| field | type | notes |
|-------|------|-------|
| `id` | string | unique id |
| `startTs` | number | ms epoch |
| `endTs` | number \| null | `null` while sleeping |
| `tz` | string | IANA tz (e.g. `Asia/Singapore`) or `UTC±HH:MM` |
| `rating` | number \| null | 1–5 wake rating |
| `note` | string | wake note, may be empty |
| `createdAt` / `updatedAt` | number | ms epoch |

**Invariant:** at most one session has `endTs === null` (the running session).

## CSV export

Columns: `id,startISO,endISO,durationMin,tz,rating,note`. Timestamps are ISO 8601; timezone is included per row. Export downloads a file and also copies to the clipboard (with a fallback message where the Clipboard API is unavailable).

## Files

| file | responsibility |
|------|----------------|
| `index.html` | markup + iOS/PWA meta tags |
| `style.css` | mobile-first dark theme |
| `lib.js` | pure logic (no DOM/storage) — unit-tested |
| `app.js` | state machine, localStorage, rendering, events |
| `manifest.json` | PWA metadata |
| `sw.js` | offline precache of the static shell |
| `tools/make-icons.py` | regenerates the app icons (stdlib only) |

## Scope (v1)

Manual toggle only. No Apple Health, Watch, sleep stages, backend, auth, or sync.
