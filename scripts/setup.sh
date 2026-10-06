#!/bin/bash
# Checks dependencies and downloads a Whisper model if none is found on this Mac.
set -e
cd "$(dirname "$0")/.."
command -v ffmpeg >/dev/null || { echo "Installing ffmpeg"; brew install ffmpeg; }
command -v whisper-cli >/dev/null || { echo "Installing whisper.cpp"; brew install whisper-cpp; }
[ -d node_modules ] || npm install
if npx tsx -e "import {findWhisperModel} from './server/paths.ts'; process.exit(findWhisperModel()?0:1)"; then
  echo "Whisper model found."
else
  mkdir -p models
  echo "Downloading ggml-small.en.bin (~470 MB)…"
  curl -L -o models/ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
fi
echo "Ready. Run: npm start"
