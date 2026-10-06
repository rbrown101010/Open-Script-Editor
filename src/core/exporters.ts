import type { Composition, EditState, Project } from "./types.ts";
import { chaptersText, compose } from "./compose.ts";

function srtTime(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

/** Captions for the edited output (times are output time, not source time). */
export function toSrt(state: EditState, comp: Composition = compose(state), maxChars = 42, maxDur = 4): string {
  const cues: { start: number; end: number; text: string }[] = [];
  let cur: { start: number; end: number; words: string[] } | null = null;
  const flush = () => {
    if (cur && cur.words.length) cues.push({ start: cur.start, end: cur.end, text: cur.words.join(" ") });
    cur = null;
  };
  for (const t of state.tokens) {
    if (t.kind !== "word") continue;
    const r = comp.tokenOut.get(t.id);
    if (!r) continue;
    if (cur) {
      const c: { start: number; end: number; words: string[] } = cur;
      const len = c.words.join(" ").length + 1 + t.text.length;
      if (len > maxChars || r.end - c.start > maxDur || r.start - c.end > 0.8 || t.para) flush();
    }
    if (!cur) cur = { start: r.start, end: r.end, words: [] };
    cur.words.push(t.text);
    cur.end = r.end;
    if (/[.?!]$/.test(t.text)) flush();
  }
  flush();
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

/** Plain-text script of the edit, with speaker labels and chapter headings. */
export function toTranscript(project: Project, opts: { markdown?: boolean } = {}): string {
  const md = !!opts.markdown;
  const markersAt = new Map(project.markers.map((m) => [m.tokenId, m]));
  const speakers = new Map(project.speakers.map((s) => [s.id, s.name]));
  const lines: string[] = [];
  let para: string[] = [];
  let speaker = "";
  const flush = () => {
    if (para.length) lines.push((speaker ? (md ? `**${speaker}:** ` : `${speaker}: `) : "") + para.join(" "));
    para = [];
  };
  for (const t of project.tokens) {
    const mk = markersAt.get(t.id);
    if (mk) {
      flush();
      lines.push(md ? `## ${mk.title}` : `[${mk.title}]`);
    }
    if (t.para) flush();
    if (t.speaker) speaker = speakers.get(t.speaker) ?? speaker;
    if (t.deleted || t.kind !== "word") continue;
    para.push(t.text);
  }
  flush();
  return (md ? `# ${project.name}\n\n` : "") + lines.join("\n\n") + "\n";
}

export { chaptersText };
