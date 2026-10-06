# Open Descript: Plan

A local, dark-mode, text-based video editor modeled on Descript's classic editor:
you edit the video by editing its transcript. Everything runs on this Mac
(Whisper for transcription, ffmpeg for export), with no accounts or API keys.
The edit model is a small JSON document plus a list of operations, so AI agents
can edit videos through the same path the UI uses.

## 1. What we're cloning (research summary)

These notes come from Descript's help center (help.descript.com, current and archived
2021–2024 pages). The full notes with sources are in `docs/descript-research.md`.

| Descript concept | How it works in Descript | Our version |
| --- | --- | --- |
| Script = timeline | Words are the edit surface. Deleting text deletes media. | Same. Tokens (words + pauses) tile the whole source file, so a text range always equals an exact media range. |
| Delete vs Ignore | **Delete** hides the text and leaves a `¦` mark. **Ignore** (`⌘⌫`) keeps it as gray strikethrough and skips it on playback. Restore with `⇧⌘⌫`. | Removed words show as red strikethrough by default. A **Show removed** toggle collapses them to `¦` marks, like Delete. `⇧⌘⌫` or the toolbar's Restore button brings them back. |
| Correct mode | `C` on a selection fixes the text without touching the media. | `C` or double-click a word, type the fix, press Enter (`correctText` op). |
| Word gaps | Pauses can be edited. **Shorten word gaps** finds pauses longer than X and trims them to Y. | Pauses are first-class tokens shown as `/ 1.4s` pills. You can select or delete them, shorten them per selection, or bulk-shorten (`shortenGaps`). |
| Filler words | Dashed underline. A Remove filler words panel offers per-type counts, a list of instances, and repeated words. | Same: light-blue dashed underline, per-type chips, a clickable instance list and one-click removal. Detects um, uh, er, ah, hmm, mm, comma-bounded "like", "you know," "I mean," and repeated words. |
| Markers / chapters | `#` inserts a marker, shown as a purple section header in the script and a bookmark on the ruler. Markers become chapters, with "Copy chapters for YouTube". | Same: `#` or toolbar → editable purple heading, ruler flag, Chapters tab with YouTube copy, and a chapters export. |
| Attach media to text | Select words, then **+ Add layer** or drop media on them. The layer spans exactly those words and follows edits. | Same: select words → Media / Title, or drop a file onto the selection. Layers anchor to start/end token ids, show as a colored underline plus a chip in the script, and get their own lane in the timeline. |
| Rearrange | Cut and paste text to reorder. | `⌘X` a range, click a new spot, `⌘V` (`moveRange` op). |
| Timeline | Ruler with markers, then layer lanes, then a word bar over the waveform. Playhead is blue. | Same layout on a canvas: edit points, purple markers, layer lanes, word chips over the waveform of the edited program, and scrub/zoom. |
| Playback | Space plays; `⇧J` / `⇧K` / `⇧L` set speed; the current word is highlighted and the view autoscrolls. | Same. |
| Export | Video, audio, SRT/VTT, transcript, chapters, timeline XML. | MP4 (layers burned in, 480p up to the original resolution), MP3, WAV, SRT, Markdown transcript, YouTube chapters, JSON edit list. |

## 2. Architecture

```
src/core/      pure TypeScript, shared by UI + server (no I/O)
  types.ts     Project / Token / Layer / Marker document
  ops.ts       EditOp union + applyOps(state, ops) reducer
  compose.ts   compile tokens → segments (EDL), layer + marker timings
  fillers.ts   filler-word / repeat detection
  transcript.ts  Whisper words + silences → tokens that tile the source
  exporters.ts SRT / transcript text
server/        Express on :4317
  store.ts     project.json persistence, undo/redo snapshots, ops.log.jsonl audit trail
  transcribe.ts  ffmpeg → 16 kHz wav, silencedetect, chunked whisper-cli
  render.ts    export: per-segment cuts → concat → overlay pass (resvg for titles)
src/client/    React + Vite UI
  Editor / Script / Preview / Timeline / Inspector / ExportDialog
  player.ts    plays the edited program straight from the source file by
               jumping over removed ranges (no render needed to preview)
scripts/agent.ts  CLI over the HTTP API
```

**Key decisions**

- **Tokens tile the source.** Whisper's word times plus ffmpeg `silencedetect`
  are merged so there are no holes: every moment of the file belongs to exactly
  one word or pause. That makes delete-text = delete-media exact, and lets each
  source moment map to a single place in the output, which keeps the player
  simple.
- **Token order = playback order.** Reordering is just moving tokens; `compose()`
  merges contiguous source ranges into segments.
- **Anchor everything to token ids.** Layers and markers reference ids, never
  times, so they survive every other edit (deletes, reorders, gap trims).
- **Chunked transcription.** whisper.cpp word timestamps drift on long files,
  so we cut the audio at real silences into chunks of roughly 4–15 s and
  transcribe each chunk. In testing this fixed a ~1.5 s drift.
- **Frame-snapped export.** Cut points snap to the video frame grid, so audio
  and video stay the same length across hundreds of cuts with no sync drift.
- **Optimistic UI.** The client applies the same reducer locally for instant
  feedback, then the server applies it authoritatively and records undo history.

## 3. The edit model (for agents)

A project is `project.json`. Agents read the script with token ids, then POST
operations. All of the operations are listed in `AGENTS.md`. Examples:

```json
[
  { "type": "removeFillers" },
  { "type": "shortenGaps", "longerThan": 0.75, "trimTo": 0.3 },
  { "type": "deleteRange", "fromId": "t1a", "toId": "t1f" },
  { "type": "addMarker", "tokenId": "t2c", "title": "The demo" },
  { "type": "addLayer", "layerType": "text", "fromId": "t30", "toId": "t38", "text": "Step 1: import" },
  { "type": "moveRange", "fromId": "t90", "toId": "t9f", "beforeId": "t00" }
]
```

Each POST is one undo step and gets a `rev`. Agents can pass `rev` for
optimistic concurrency, and get a 409 if a human edited in between. Every op
is appended to `ops.log.jsonl`, an audit trail of how a cut was made.

## 4. Status

**Built and working (v0.1)**

- Import by drag-drop or file picker; local Whisper transcription with progress
- Script editing: select, remove, restore, correct, split/join paragraphs, cut/paste to reorder
- Strikethrough removed words, with a "Show removed" toggle
- Filler-word detection and bulk removal; shorten word gaps
- Markers → chapters, with YouTube copy
- Image, video and title layers attached to words; drag and resize on the canvas; position presets
- Edited-program playback with current-word highlight and autoscroll
- Canvas timeline: waveform, words, layers, markers, zoom, scrub
- Undo/redo, rename project and speakers
- Exports: MP4, MP3, WAV, SRT, Markdown, chapters, JSON EDL
- HTTP API and CLI for agents

**Next (roughly in priority order)**

1. **Speaker diarization.** Whisper gives one speaker. Add a local diarizer
   (pyannote or sherpa-onnx) and `@` speaker labels.
2. **Better word alignment.** Optionally use mlx-whisper (large-v3-turbo is
   already cached on this Mac) or a wav2vec2 forced aligner for tighter cuts.
3. **Command palette (`⌘K`)** and a richer right-click menu on words.
4. **MCP server** wrapping the ops API so Claude can edit directly; also an
   "Underlord"-style AI panel that sends a prompt plus the `/script` view to
   Claude and applies the returned ops (with a diff preview before applying).
5. **Scenes (`/`)** with per-scene layouts, and multiple compositions per project.
6. **Multitrack / multicam:** extra audio tracks, music bed with ducking.
7. **Studio Sound**-style cleanup (ffmpeg `afftdn` / RNNoise) and loudness
   normalization on export (`loudnorm`, a -14 LUFS preset).
8. **Timeline XML export** (FCPXML / Premiere XML) from the same EDL.
9. **Word-level timeline editing:** drag word edges to fix alignment, and a
   blade tool.
10. **Captions layer** (animated burned-in subtitles) from the SRT data.

## 5. Known limitations

- Word timing comes from whisper.cpp, which can be ~100–200 ms off. Cuts are
  clean on pauses and can clip fast speech. See item 2 above.
- Title text is rendered with system Helvetica in both preview and export;
  line wrapping can differ slightly between the two.
- Preview of video layers seeks the B-roll file per layer, so very short
  B-roll clips may stutter in preview (export is exact).
