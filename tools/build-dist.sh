#!/usr/bin/env bash
# Assemble a clean deploy folder (dist/) with only the runtime files.
# Re-run after any change before re-dragging dist/ to Netlify Drop.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
mkdir -p dist/icons
cp index.html app.js lib.js liquid.js style.css manifest.json sw.js dist/
cp icons/icon-192.png icons/icon-512.png dist/icons/

echo "dist/ ready:"
find dist -type f | sort
