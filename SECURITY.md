# Security

Open Script Editor is a **local, single-user app**. Its API has no login and can read
media files from your disk, so it is built to be reachable only from your own machine.

## How it protects you

- **Loopback only.** The server binds to `127.0.0.1`. Don't set `HOST=0.0.0.0` or put it behind a public proxy.
- **DNS-rebinding guard.** Requests whose `Host` header isn't `localhost`, `127.0.0.1` or `[::1]` get a 403.
- **Cross-site guard.** Write requests that carry a non-local `Origin` get a 403, so a web page you visit can't drive the editor.
- **Input validation.**
  - Project and file ids are checked against a strict pattern.
  - Uploaded file names are reduced to a safe basename.
  - Import-from-path only accepts existing audio, video and image files.
  - Layer styles are coerced to bounded numbers before they reach ffmpeg or the SVG title renderer.
- **No shell.** ffmpeg and whisper-cli run with argument arrays, never through a shell.
- **No telemetry, no cloud.** Transcription (whisper.cpp) and rendering (ffmpeg) run locally. Nothing is uploaded anywhere.
- **No secrets.** The app needs no API keys. Keep any future keys in environment variables; `.env*` is git-ignored.

## Reporting a vulnerability

Please report it privately through **GitHub → Security → Report a vulnerability** on this
repository rather than in a public issue. We'll acknowledge it within a few days.
