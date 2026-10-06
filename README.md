# Open Descript

An open-source, local, **text-based video editor** in the style of Descript's classic editor.
Drop in a video and it's transcribed on your machine with Whisper. Then you edit the video by editing the text.

- **Delete words → delete video.** Removed words stay visible as strikethrough (toggle to hide).
- **Filler words** (um, uh, like, you know, repeated words) are detected and removed in one click.
- **Shorten word gaps** across the whole video.
- **Markers → chapters**, with "Copy chapters for YouTube".
- **Attach media to text:** select words, then add an image, video or title layer that follows every edit.
- **Rearrange** by cut and paste, **correct** typos without touching the media, and full undo/redo.
- **Export** MP4 (layers burned in), MP3, WAV, SRT, Markdown transcript, chapters or a JSON edit list.
- **Agent-ready:** every edit is a JSON operation over a local HTTP API (see [AGENTS.md](AGENTS.md)).

Everything runs locally. No account, no API keys, no uploads.

## Quick start (macOS)

```bash
brew install ffmpeg whisper-cpp
git clone https://github.com/rbrown101010/open-descript.git
cd open-descript
npm install
npm run setup     # downloads a Whisper model (ggml-small.en, ~470 MB) if you don't have one
npm start         # http://localhost:4317
```

Or double-click **Start Open Descript.command**. For development, `npm run dev` serves the UI with
hot reload on http://localhost:5173.

Linux works too if `ffmpeg` and whisper.cpp's `whisper-cli` are on your PATH.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WHISPER_MODEL` | first `ggml-*.bin` in `./models` or `~/.cache/whisper` | Whisper model file |
| `WHISPER_CLI` | `whisper-cli` | whisper.cpp binary |
| `OPEN_DESCRIPT_DATA` | `./projects` | Where projects and exports are stored |
| `PORT` / `HOST` | `4317` / `127.0.0.1` | Server address (keep it on loopback; see [SECURITY.md](SECURITY.md)) |

## Keyboard

| Do this | How |
| --- | --- |
| Remove / restore words | `⌫` / `⇧⌘⌫` |
| Correct a word's text | Double-click, or `C` |
| Reorder | `⌘X` a selection, click a destination, `⌘V` |
| New paragraph / join | `Enter` / `⌫` at the start of a paragraph |
| Marker (chapter) | `#` |
| Play / speed | `Space`, `⇧J` / `⇧K` / `⇧L` |
| Undo / redo / export | `⌘Z` / `⇧⌘Z` / `⌘E` |

## How it works

Transcribed words and detected pauses become **tokens that tile the entire source file**, so a
text range is always an exact media range. Token order is playback order. Layers and markers are
anchored to token ids, so they survive every edit. `compose()` compiles the document into an
edit decision list that drives the in-browser player (it skips removed ranges live, with no render)
and the ffmpeg export. More detail in [PLAN.md](PLAN.md).

```
src/core/     pure TS edit model: types, ops reducer, compose (EDL), fillers, transcript builder
server/       Express API, persistence + undo, whisper.cpp transcription, ffmpeg export
src/client/   React UI: script editor, preview, canvas timeline, inspector
scripts/      agent CLI, setup, dev runner
```

## Contributing

Issues and PRs are welcome. Run `npm run typecheck && npm test` before opening a PR.

## Disclaimer

Open Descript is an independent open-source project. It is not affiliated with, endorsed by, or
connected to Descript, Inc. "Descript" is a trademark of its owner and is used here only to describe
the editing style this project is inspired by.

## License

[MIT](LICENSE)
