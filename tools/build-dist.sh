#!/usr/bin/env bash
# Assemble a clean deploy folder (dist/) with only the runtime files.
# Re-run after any change before re-dragging dist/ to Netlify Drop.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
mkdir -p dist/icons
cp index.html app.js lib.js liquid.js sleep-aid.js wav.js style.css manifest.json sw.js dist/
cp icons/icon-192.png icons/icon-512.png dist/icons/

# Auto-version the service worker cache from a content hash of the runtime assets
# (everything except sw.js, to avoid a circular hash).
HASH=$(cat dist/index.html dist/app.js dist/lib.js dist/liquid.js dist/sleep-aid.js dist/wav.js dist/style.css \
  dist/manifest.json dist/icons/icon-192.png dist/icons/icon-512.png \
  | shasum | cut -c1-10)
# Portable in-place edit (works on both macOS BSD sed and Linux/Netlify GNU sed).
sed "s/sleep-toggle-dev/sleep-toggle-${HASH}/" dist/sw.js > dist/sw.js.tmp && mv dist/sw.js.tmp dist/sw.js

echo "dist/ ready (cache: sleep-toggle-${HASH}):"
find dist -type f | sort
