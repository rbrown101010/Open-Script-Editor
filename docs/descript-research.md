# Descript editor UX research (for cloning the "classic" editor)

Researched 2026-10-06. Primary sources: the current Descript Help Center (help.descript.com, which publishes raw `.md` pages and an index at https://help.descript.com/llms.txt), and Wayback Machine captures of the older Zendesk help center (help.descript.com/hc/en-us/articles/...) from 2021-2024, which describe the classic and Storyboard-era editor.

**Version note:** Descript's UI has gone through roughly three eras:
- **Pre-Storyboard classic (2020-mid 2023).** Script editor with the video "canvas" on top or at the right, a timeline at the bottom, and a Properties panel. Media was added as "tracks" anchored to a word in the script, which showed a media icon inline.
- **Storyboard / scenes era (mid-2023 to 2024).** A `/` in the script makes a scene boundary, scene thumbnails sit in the script's left gutter, layers belong to scenes, and the right sidebar holds Underlord/AI Actions. The "Timeline overview (classic)" article describes this layout.
- **2024-2025 redesign.** Collapsed timeline by default, "Storyboard view" replacing the scene rail, an AI Tools panel, and Underlord as an agent-style co-editor.

Most mechanics below (delete vs ignore, correct mode, markers, filler words, word gaps) are the same across all three eras. The differences are noted where they matter.

---

## 1. Script / document view

**Core model.** The script *is* the edit. Transcribed text is linked to the media word by word. Deleting text removes that media, and cut+paste moves it. Everything is non-destructive: removed media is hidden, not erased.
Source: [Edit like a doc](https://help.descript.com/getting-started/edit-like-a-doc.md)

**There are four ways to "remove" words, and the clone should model each as a distinct state:**

| Action | Shortcut (Mac / Win) | Script shows | Playback / export |
|---|---|---|---|
| Delete | `Delete` / `Backspace` | text disappears; an **edit boundary** marker (gray split bar `¦`) is left behind if boundaries are shown | media removed |
| Ignore | `Cmd+Delete` / `Ctrl+Backspace` | text stays, **struck through** (gray) | media skipped in playback; left out of subtitles and published media; *can* be included in a text-transcript export |
| Remove from transcript | right-click > Remove from transcript | text hidden | audio/video **kept** |
| Correct | `C` on a selection, or Correct mode | text changed | media unchanged |

- **Hovering ignored text** shows a small popover with **Restore** (un-ignore) and **Delete** (turn the ignore into a real delete). Sources: [Delete vs ignore](https://help.descript.com/script-editing/delete-vs-ignore.md), [2023 archived version](https://help.descript.com/hc/en-us/articles/10164872017933).
- **Bulk action.** Quick Actions (Cmd+K) has a **"Remove ignored text"** command that deletes all ignored text in the composition. Source: [Quick actions, archived ~2022](https://web.archive.org/web/2022/https://help.descript.com/hc/en-us/articles/10164095817997-Quick-actions).
- **"Show/Hide ignored" toggle: not found in the docs.** I found no documented View-menu toggle for hiding ignored text. "Hide ignored text" is an open request on Descript's feedback board ([feature request](https://feedback.descript.com/feature-requests/p/hide-ignored-text)). For the clone, a View > "Show ignored text" toggle is a reasonable addition, but it would not be a faithful copy.
- **Restoring deleted media.** Select across an edit boundary, then right-click > **Restore removed media** (`Shift+Cmd+Delete`). This works in bulk across a selection. Source: [Restore removed media](https://help.descript.com/script-editing/restore-removed-media.md).
- **Edit boundaries.** These are vertical gray "colon/divider" marks where two clips meet, toggled with View > Script > Show edit boundaries. With the cursor on a boundary you get **Regenerate** (smooth the cut) and Restore. Source: [Edit boundaries](https://help.descript.com/script-editing/edit-boundaries.md).

**Correct mode vs edit mode**
- **Default (edit) mode.** Typing over or deleting text edits the media.
- **Single fix.** Double-click a word, then press `C` (or click Correct in the hover toolbar), type the fix, and choose **Correct** or **Correct All** (every instance in the project). While Descript re-aligns, the word shows a **dotted gray underline**.
- **Correct mode.** `Opt+C` / `Alt+C` toggles a mode where the script behaves like a plain text doc and edits change only the text. In the classic era the shortcuts were `C` = correction tool, `W` = writing tool, `Esc` = exit.
- **Hold-and-click shortcuts.** Hold `Z` + click a word to cycle capitalization (lowercase > Sentence > UPPER). Hold `X` + click to cycle punctuation (`.` > `?` > `,` > none).
- **Single-letter shortcuts are disabled** while Correct or Write mode is on.
- Sources: [Correct your transcript](https://help.descript.com/script-editing/correct-your-transcript.md), [2023 shortcuts (archived)](https://help.descript.com/hc/en-us/articles/10255582172173).

**Speaker labels**
- **Placement.** Labels sit at the start of a paragraph, as a bold name in the speaker's color above or before the text.
- **Adding a label.** Press `@` at the cursor, or click "Add speaker" at the top of a paragraph. Then type to create a speaker or pick an existing one. Selecting a range and pressing `@` re-labels that range.
- **Moving a label.** Drag the reposition handle to the left of the label. Words highlight as you drag, and the label drops before the target word.
- **Renaming.** Click a label and type, then choose "Rename X to Y" (applies project-wide).
- **⋯ menu on a label:** Replace in project with…, Change label color, Remove from project (that text then goes to the speaker above).
- **Auto speaker detection** runs on import and asks you to name the detected voices.
- Source: [Speaker labels](https://help.descript.com/script-editing/speaker-labels.md)

**Paragraphs and other script elements**
- **Paragraphs** are created by speaker changes or by pressing Enter. Line breaks matter: export has a "**Line breaks**" mode that exports each paragraph block as its own file. Source: [Export video](https://help.descript.com/export-and-share/video-gif.md).
- **Inline notes:** type `(` + text + `)` for non-speech notes like "(laughter)". They are kept in exported transcripts and not aligned to media.
- **Formatting:** bold `Cmd+B`, italic `Cmd+I`, color highlights `Shift+Cmd+H`, comments `Shift+Cmd+M` (classic: `Opt+Cmd+M`).
- **Playhead display:** the playhead is a **blue caret** in the script, and the **current word is highlighted** during playback. During playback the text cursor moves independently, so you can edit while it plays. `Opt+Click` places the caret during playback, and `Esc` re-enables autoscroll. Source: [Playback and navigation](https://help.descript.com/descript-tour/playback-and-navigation.md).
- **Selection toolbar** (appears on highlight): Ask Underlord, Change layout, **+ Add layer**, Add scene, Correct, Regenerate, an edit menu (Ignore / Delete / Replace with gap clip / Correct only), Bold/Italic, Highlight, Duplicate to…, Comment, and ⋯ (the right-click menu). Source: [Selection toolbar](https://help.descript.com/descript-tour/selection-toolbar.md).

## 2. Word gaps, pauses and filler words

**How gaps appear in the script**
- I found no documentation of a `/` glyph for pauses. In Descript, `/` means a **scene boundary**, not a gap.
- Gaps are edited at the caret between two words: right-click > **Edit word gap** > choose a preset, **Set manually…** (type a duration and press Return, which then auto-plays that section), or Shorten all word gaps.
- `Cmd+G` edits the gap at the caret. `Cmd+Shift+G` applies the last-used gap duration.
- Making a gap longer inserts a **gap clip** (room tone on by default). In video this shows as a black frame or freeze frame.
- With the beta **"Show wordless media in script"** setting (Project settings or App settings > Advanced), silences and ambient sections appear in the script as editable inline tokens that can be deleted or ignored like words.
- **Clone suggestion (my own idea, not Descript's):** render gaps above a threshold (for example ≥0.5 s) as a small gray `/` or `⋯` pill showing the duration. That fits Descript's model, but it is not a documented Descript glyph.
- Sources: [Word gaps](https://help.descript.com/script-editing/word-gaps.md), [Trim spaces between words](https://help.descript.com/script-editing/trim-and-adjust-spaces-between-words.md), [Wordless media](https://help.descript.com/script-editing/wordless-media.md), [Gap clips](https://help.descript.com/timeline/using-gap-clips.md)

**Shorten word gaps (the tool)**
- **Opening it.** Launched from AI Actions / Underlord / AI Tools, or from Cmd+K "Shorten word gaps". It opens a **search bar at the top of the script** with a results list in the Properties panel.
- **Controls.** A dropdown with **"more than" / "between"** plus duration fields (example: longer than 750 ms), and a target length field (example: shorten to **200 ms**).
- **Navigation and buttons.** Arrows step through results, with a **Shorten** button (this one, then advance) and **Shorten all**.
- **Settings (gear icon):** **Auto-advance** and **Preview results**, which auto-plays the surrounding audio for each result.
- Sources: [Shorten word gaps](https://help.descript.com/script-editing/shorten-word-gaps.md), [archived Zendesk version](https://help.descript.com/hc/en-us/articles/10164807277453-Shorten-word-gaps)

**Filler words**
- **Underline.** Detected fillers get a **light-blue (dashed) underline** in the script. This is toggled by View > Script > "Underline filler words". A separate "Underline word errors" option marks alignment failures.
- **Detected list** from the 2023 archived article (lower legacy plans got only um/uh/mmm/hm):
  - um, uh, mmm, hm
  - but you know, I guess, I mean, I suppose, kind of, like, or something, so, sort of, well, you know, you know what I mean, you see
  - plus **"Repeated words"** as a detection category
  - Newer docs add "right" and other languages: EN/DE/FR/PT/IT per a search snippet; the current page says English only.
- **Remove filler words panel.** A sidebar (Properties panel) lists every instance with its timestamp, a preview/play button, and a per-item action:
  1. **Delete:** removes the text and the audio.
  2. **Delete and replace with gap:** keeps the timing by inserting a gap clip.
  3. **Ignore:** strikethrough in the script, audio skipped.
  4. **Remove from transcript:** text only; the audio stays.
  - The 2022 version had 3 options: Delete (with an optional "replace with gap clip of the same size"), Ignore, and Correct transcript.
- **Avoid harsh cuts** (newer) is a checkbox that skips fillers which can't be cut cleanly.
- **Scope** is always the whole composition. To clean part of it, duplicate the selection to a new composition, clean it there, and paste it back.
- **Related tool: Remove Retakes.** It detects repeated lines and false starts and marks the earlier takes as **ignored** text.
- Sources: [Filler words (current)](https://help.descript.com/script-editing/filler-words.md), [Filler words, 2023 archived with word list](https://help.descript.com/hc/en-us/articles/10164806394509-Filler-words), [Remove filler words, 2022 archived](https://help.descript.com/hc/en-us/articles/10164806394509-Remove-filler-words), [Sound good tools](https://help.descript.com/descript-tour/sound-good-tools.md), [View menu](https://help.descript.com/descript-tour/view-menu.md)

## 3. Scenes vs markers vs chapters

**Scenes (`/`)**
- **What they are.** A visual segment, "like slides in a presentation". Each scene has its own layers and layout. Scenes exist in video compositions only.
- **Adding one.** Type `/` at the caret to split the current scene there (the new scene inherits the existing media). Type `/` on an empty line to create an empty scene. In the classic era there was also a `/` icon beside the script line, and Enter twice then `/` gave an empty scene. `Cmd+Shift+Enter` = New Scene, and you can also right-click > Add scene, or use the timeline **Split** button.
- **In the script** each scene shows as a **thumbnail in the left gutter** where it starts.
- **Moving a boundary.** Click the thumbnail and drag the handle that appears on the timeline ruler. The script highlights the word the boundary will land before.
- **Deleting a boundary.** Click the thumbnail then Delete (merges into the previous scene), or right-click > Delete boundary. Double-clicking a thumbnail selects the *whole scene*, so Delete would then remove its content too.
- **Navigation:** next/previous scene with `Shift+Cmd+.` / `Shift+Cmd+,` (classic: `Shift+Cmd+]` / `[`).
- Sources: [Scenes](https://help.descript.com/getting-started/scenes.md), [Scene boundaries](https://help.descript.com/visuals/boundaries.md), [Split vs create](https://help.descript.com/visuals/split-vs-create.md), [Working with scenes, 2022 archived](https://help.descript.com/hc/en-us/articles/10119710379917-Working-with-scenes)

**Markers (`#`)**
- **Adding.** Type `#` in the script (classic: `M` or `#` while no script tool is active), click "Add marker" on a blank line, use Cmd+K > Insert > Marker, or use the AI **Add Chapters** tool.
- **Appearance.** In the script a marker renders as a **section header** (an editable title line). In the timeline it is a **purple bookmark** on the ruler.
- **Editing.** Hover to reveal a grabber, then drag; the script highlights the landing spot. Click the label to rename, and select + Delete to remove.
- **Navigating.** The **marker icon in the transport** opens a list of markers to jump to. Next/previous marker is `Opt+Cmd+.` / `Opt+Cmd+,` (classic: `Cmd+]` / `Cmd+[`).
- Sources: [Markers and chapters](https://help.descript.com/script-editing/markers-chapters.md), [Markers, 2022 archived](https://help.descript.com/hc/en-us/articles/10164735239693-Markers)

**Chapters**
- Markers *are* chapters; there is no separate object.
- **Share pages** show markers as chapters automatically.
- **Local MP4/MP3/AAC export** has a metadata option, "Include markers as chapters".
- **YouTube** ignores embedded chapter metadata, so the marker list menu has a **"Copy chapters for YouTube"** item that copies `00:00 Title` lines.
- **Per-marker export:** the Export "Markers" mode creates one file per marker.
- **Text exports** can include markers as headers with timecodes.
- **Add Chapters (AI)** auto-generates markers with titles, or a timestamped list.

## 4. Attaching media and layers to the script

**Pre-Storyboard classic (about 2021)**
- Click a spot in the transcript, then **+ (Edit media) > Track**, or drag media onto the script.
- The clip is **anchored to that word**, and a **small media icon appears inline in the transcript** at the anchor.
- In the timeline the layer clip has a **dark-pink header strip**. Dragging that strip slides the clip relative to its anchor word.
- Clicking the inline icon selects the clip in the timeline, and selecting in one panel highlights the item in the other.
- Because layers are anchored, they **move with the text when you cut/paste or delete** around them.
- Source: [RJI, Feb 2021](https://rjionline.org/news/descript-video-tips-and-tricks/)

**Storyboard and current eras**
- **Selection-based add.** Select a script range, then **+ Add Layer** in the hover toolbar and pick image, video, text/title, shape, captions, stock media, or recording.
- **Range-based add.** With the **Range tool** (`R`), select a section of the script track and drop media on it. Descript **creates scene boundaries at the selection's start and end** and puts the layer in that new scene, so the layer spans exactly those words.
- **Dropping media** on a scene thumbnail, the script, the canvas, or the timeline adds it to that scene.
- **Script display.** The layer is not underlined in the script. It is represented by the **scene thumbnail(s) in the gutter** at the scene start.
- **Timeline display.** The layer shows in the **layer lane above the script track**. Descript auto-stacks lanes ("practically infinite layers", each taking only the space it needs).
- **Scope and following edits.** A layer lives within its scene and is trimmed to the scene's boundaries. Scene boundaries are tied to words, so **deleting or moving text resizes or moves the layers with it**.
- **Extending a layer across scenes:** drag its edge across boundaries, or use "Apply to all scenes".
- **Attaching to a scene:** drag the layer's left edge to the scene start until a red or dashed snap line appears.
- **Transcription:** layers are never transcribed; only the script track is.
- Sources: [Add layer](https://help.descript.com/visuals/add-layer.md), [Scenes & layers](https://help.descript.com/visuals/scenes-layers.md), [Attach layer](https://help.descript.com/visuals/attach-layer.md), [Elements of a composition, archived](https://help.descript.com/hc/en-us/articles/10164598392973-Elements-of-a-composition)

**Clone recommendation.** Combine the two eras: an **inline colored bracket or underline over the spanned words** plus a gutter thumbnail. Store each layer as `{startWordId, endWordId}` so it follows edits automatically. This is what users intuitively expect, and it is closest to the 2021 anchor model.

## 5. Timeline, shortcuts and Underlord

**Timeline layout, top to bottom (classic article)**
1. **Transport:** previous/next scene (classic: previous/next marker), play/pause, a playback-speed menu (up to 3×), and the markers list.
2. **Time ruler:** timecode, scene boundaries, purple markers, comments, audio pins.
3. **Layer lane:** b-roll, titles, music, SFX. In 2024 audio was green and video blue.
4. **Wordbar:** each word as a block aligned over the waveform. Drag a word left to tighten the gap, or right to add a gap/freeze frame. `Cmd`+drag a word edge to fix its alignment.
5. **Script track:** the transcribed media with its waveform.

- The **playhead** is a blue vertical line.
- Resize the timeline by dragging the divider. `Shift+Cmd+S` toggles it, and newer versions use `Ctrl+Opt+T` to expand it.
- **Zoom** with `Cmd+=` / `Cmd+-` or `Cmd`+scroll. `Opt+Cmd+3` zooms to the playhead, `Opt+Cmd+4` fits the selection.
- **Tools:** Select `A`, Range `R`, Blade `B`, Slip `Y` (`S` in some docs), Hand `H`. Holding the key makes the tool temporary.
- Sources: [Timeline overview (classic), archived](https://help.descript.com/hc/en-us/articles/10249275208717-Timeline-overview-classic), [Timeline overview](https://help.descript.com/timeline/timeline-overview.md), [Timeline tools](https://help.descript.com/timeline/timeline-tools.md)

**Playback**

| Action | Mac shortcut |
|---|---|
| Play/pause | `Space` (when no script tool is active); also `Cmd+S` or `Opt+Click` |
| Play from cursor | `Shift+Space` |
| Play selection | select a range, then `Space` |
| Spot audition | `Shift+Cmd+Space` |
| Frame step | `←` / `→` (timeline focused) |
| Go to start | `Home` |
| Playback speed | **`Shift+J` / `Shift+K` / `Shift+L`** = slower / reset / faster (2023: `Opt+J/K/L`) |
| Next/previous clip | `Opt+Shift+Cmd+.` / `,` |

Descript has **no documented plain J/K/L shuttle**.

**Editing**

| Action | Mac shortcut |
|---|---|
| Ignore | `Cmd+Delete` |
| Restore removed media | `Shift+Cmd+Delete` |
| Replace with gap clip | `Shift+Delete` |
| Split clip at playhead | `S` |
| Insert speaker / marker / scene | `@` / `#` / `/` |
| Regenerate | `D` |
| Text layer / shape | `Opt+Cmd+T` / `Opt+Cmd+S` |
| Write mode | `Cmd+E` (classic: `W`) |
| Correct mode | `Opt+C` |
| Find / find in project | `Cmd+F` / `Shift+Cmd+F` |
| Command palette | `Cmd+K` |
| Export / publish | `Shift+Cmd+E` / `Shift+Cmd+P` |
| Shortcut sheet | `Opt+/` or `Opt+Cmd+K` |
| Show/hide video | `Opt+Cmd+V` |
| Move video between top and right | `Opt+Shift+Cmd+V` |
| Z-order | `]` / `[` |

Sources: [Keyboard shortcuts (current)](https://help.descript.com/descript-tour/keyboard-shortcuts.md), [2023 shortcuts, archived](https://help.descript.com/hc/en-us/articles/10255582172173)

**Cmd+K Quick Actions (classic):** Enter Correct/Write mode, Remove filler words…, **Remove ignored text**, Replace with gap clip, Shorten word gaps, Split clip at playhead, Export subtitles/text/timeline, Insert (marker, scene, speaker label, text, shapes, waveform, progress bar, captions, file), Jump to marker/time/composition. Source: [Quick actions, archived](https://help.descript.com/hc/en-us/articles/10164095817997-Quick-actions).

**Underlord / AI Tools** (right-sidebar panel, grouped by category):
- **Sound good:** Edit for Clarity, Studio Sound, Remove Filler Words, Remove Retakes, Shorten Word Gaps, Add Chapters
- **Look good:** Quick Design, Eye Contact, Center Active Speaker, Green Screen, Automatic Multicam, Generate media
- **Repurpose:** Create clips, Highlight reel, Find highlights, Translate/Dub
- **Publish:** Draft a title, Summarize, Show notes, YouTube description, Social post, Blog post
- **Write:** Brainstorm, Write a script, Outline, Rewrite

Underlord is now also a chat co-editor ("Ask Underlord" on any selection). Sources: [AI tools overview](https://help.descript.com/descript-tour/ai-tools-overview.md), [Sound good](https://help.descript.com/descript-tour/sound-good-tools.md), [Publish tools](https://help.descript.com/descript-tour/publish-tools.md)

## 6. Visual design and layout

**Classic layout (2022 "Descript's interface")**
- **Script editor:** the large central or left document column.
- **Canvas:** the video preview, at the **top or right**, moved with `Opt+Shift+Cmd+V`.
- **Timeline:** across the bottom.
- **Properties panel:** on the right; context-sensitive for the composition, scene, layer or track.
- **App bar:** across the top, with add shape/text, Media Library, recorder, templates, Publish/Export, project access and settings.
- Source: [Descript's interface, 2022 archived](https://help.descript.com/hc/en-us/articles/10164599097485-Descript-s-interface)

**2024 layout**
- Scene thumbnails in the left gutter, transcript in the centre, canvas on the right.
- A right sidebar with tabs: Underlord, Project, Scene, Layout, Captions, Elements.
- **Layout presets:** Side-by-side (default), Stacked (canvas above script), or full-screen video (`Cmd+.`).
- Sources: [Customize the editor](https://help.descript.com/descript-tour/customize-the-editor.md), [Descript Mastery, Sept 2024](https://www.descriptmastery.com/blog/sept2024tutorial)

**Theme.** View > Appearance > Theme offers Light / Dark / System. Source: [View menu](https://help.descript.com/descript-tour/view-menu.md).

**Colors described in the docs**

| Element | Color / look |
|---|---|
| Playhead and caret | blue |
| Filler words | light-blue dashed underline |
| Markers | purple bookmark |
| Ignored text | gray strikethrough |
| Words being re-aligned | dotted gray underline |
| Edit boundary | gray `¦` |
| Layer clip header (2021) | dark pink |
| Audio vs video layers (2024) | green vs blue |
| Speaker labels | user-assignable label colors |

**Dark-mode palette (my estimate; Descript has not published one).**
- Backgrounds: app ≈ `#1a1a1a`, panels ≈ `#222`/`#262626`, timeline ≈ `#141414`, dividers ≈ `#333`.
- Text: primary ≈ `#e8e8e8`, secondary ≈ `#9a9a9a`, ignored text ≈ `#6b6b6b` with strikethrough.
- Accent: blue ≈ `#3b82f6`-ish.
- Typography: a sans-serif UI font (system-like, Inter-style). The script uses a larger reading size (about 16-18 px, generous line height), with text size adjustable via `Cmd+Shift+=` / `Cmd+Shift+-`.

## 7. Export options

Opened with the Export/Publish button at the top right (`Shift+Cmd+E`). There are **Destination** tabs (Descript web link / YouTube / podcast hosts) and **Local export**. Classic UI: a "Publish" button with Export and Publish tabs.

**Export scope** (applies to video and audio):
- Current composition
- Current selection
- Current scene
- **Scenes** (one file each)
- **Markers** (one file each)
- **Line breaks** (one file per paragraph block)
- All compositions

**Video**
- MP4 or GIF at 480p / 720p / 1080p / 4K; quality Low / Med / High.
- Audio: channels, 44.1 or 48 kHz, 32-256 kbps, normalize (Off / Peak / -14 / -16 / -18 / -23 / -24 LUFS).
- Metadata, including markers as chapters.
- Subtitles are **embedded (soft)**. Burned-in captions require a captions layer.
- Source: [Video/GIF](https://help.descript.com/export-and-share/video-gif.md)

**Audio**
- MP3 / WAV / M4A, with the same audio settings plus artwork and chapters. WAV has no chapters.
- Source: [Audio](https://help.descript.com/export-and-share/audio.md)

**Subtitles**
- **SRT / VTT**, with options for show speakers, max characters per line, and max lines per card.
- Ignored text is excluded.
- Source: [Subtitles](https://help.descript.com/export-and-share/subtitles.md)

**Transcript**
- `.docx` / `.txt` / `.rtf` / `.md` / `.html`.
- Include options: composition name, markers, **ignored text**, speaker labels, speaker on every paragraph.
- Timecode options: offset, interval, at paragraph breaks, speaker labels, markers.
- Scene boundaries and wordless media are not included.
- Source: [Transcript](https://help.descript.com/export-and-share/transcript.md)

**Timeline**
- Premiere XML, DaVinci Resolve XML, Final Cut FCPXML, Reaper EDL, Audition SESX, Pro Tools/Logic AAF.
- Options: include media, comments as markers, each file on its own track, frame rate (snap vs source).
- What carries over: cuts, **ignored script**, markers, and Studio Sound.
- What does not: titles, images, scenes, transitions, and effects.
- Source: [Timeline exports](https://help.descript.com/export-and-share/timeline-exports.md)

---

## Gaps and uncertainties

- **No documented `/` word-gap glyph.** `/` is the scene boundary. Pause display in the script is limited to the beta wordless-media tokens.
- **No documented Show/Hide ignored toggle.** It is a user feature request; the bulk action "Remove ignored text" does exist.
- **The exact dark-mode hex colors and fonts are not published.** The values above are estimates.
- **The pre-2023 behaviour for layers is described in only one third-party source** (RJI 2021): an inline media icon anchored to a word, with a pink header in the timeline. Screenshots or video from about 2021 would be needed for pixel-level fidelity.
