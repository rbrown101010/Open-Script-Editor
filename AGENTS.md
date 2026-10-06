# Editing videos as an agent

The editor is a JSON document plus operations. Anything the UI does, an agent
can do over HTTP at `http://localhost:4317` (start it with `npm start`).

## Workflow

1. **Find or create a project**
   - `GET /api/projects`
   - `POST /api/projects/from-path` with `{ "path": "/abs/file.mp4" }`, then poll
     `GET /api/projects/:id` until `transcription.state` is `"done"`.
2. **Read the script with ids:** `GET /api/projects/:id/script` returns
   paragraphs of `[tokenId, text, removed]`. Pauses look like `[pause 1.4s]`.
3. **Edit:** `POST /api/projects/:id/ops` with `{ "ops": [...], "rev"?: n }`.
   - Ops apply in order as one undo step.
   - Pass `rev` to get a 409 if someone else edited since you read.
4. **Check the result:** `GET /api/projects/:id/composition` returns the edited
   duration, segments, layer timings, chapters and filler counts.
5. **Export:**
   - `POST /api/projects/:id/export` with `{ "format": "mp4" | "mp3" | "wav" | "srt" | "md" | "chapters" | "edl", "height"?: 1080 }`
   - Poll `GET /api/jobs/:jobId` until it's done; the response's `path` is the file on disk.
   - `POST /api/projects/:id/undo` and `/redo` are also available.

CLI shortcut: `npm run agent -- script <id>`, `npm run agent -- ops <id> '<json>'`,
`npm run agent -- export <id> mp4`.

## Operations

Ranges are inclusive and given as token ids in script order (`fromId`..`toId`).

| op | fields | effect |
| --- | --- | --- |
| `deleteRange` | `fromId, toId` | Strike out words/pauses (skipped in playback and export). |
| `deleteTokens` | `ids[]` | Same, for a list of tokens. |
| `restoreRange` / `restoreTokens` | same | Bring removed tokens back. |
| `correctText` | `id, text` | Fix a transcription error; the media is unchanged. |
| `moveRange` | `fromId, toId, beforeId \| null` | Reorder: move the range before `beforeId` (null = end). |
| `splitParagraph` / `joinParagraph` | `tokenId` | Start (or stop) a paragraph at this token. |
| `setGapTrim` | `ids[], trimTo \| null` | Keep at most `trimTo` seconds of these pauses. |
| `shortenGaps` | `longerThan, trimTo` | Every pause longer than X → Y seconds. |
| `removeFillers` | `words?[], includeRepeats?` | Remove um/uh/like/you know/… and repeated words. |
| `addMarker` | `tokenId, title, id?` | Chapter marker before a token. |
| `updateMarker` / `removeMarker` | `id, title?, tokenId?` | Change or remove a marker. |
| `addLayer` | `layerType: image\|video\|text, fromId, toId, assetId?, text?, style?, track?, volume?, id?` | Overlay that's visible while those words play. |
| `updateLayer` | `id, fromId?, toId?, text?, style?, track?, volume?` | Change a layer. |
| `removeLayer` | `id` | Remove a layer. |
| `renameProject` / `renameSpeaker` / `setSpeaker` | | Metadata. |

`style` is normalized to the frame (0–1):
`{ x, y, w, h, fit: "cover"|"contain", opacity, fontSize, color, background, fontWeight, align }`.
`fontSize` is a fraction of the frame height.

Media for image/video layers: `POST /api/projects/:id/assets/from-path` with
`{ "path": "/abs/broll.mp4" }` returns `{ asset }`; use `asset.id` as the `assetId`.

## Tips

- Prefer `removeFillers` and `shortenGaps` over hand-picking tokens. They're
  idempotent and the result is easy to review.
- Layers and markers follow later edits, so add them in any order.
- Every op is appended to `projects/<id>/ops.log.jsonl`.
