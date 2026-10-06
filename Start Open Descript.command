#!/bin/bash
# Double-click to launch. Opens http://localhost:4317 when ready.
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
(sleep 4 && open http://localhost:4317) &
npm start
