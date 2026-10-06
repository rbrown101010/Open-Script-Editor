import type { Token } from "./types.ts";

export interface RawWord {
  text: string;
  start: number;
  end: number;
  p?: number;
}

const PAD = 0.06; // keep a little air around words when carving out silences
const MIN_GAP = 0.25; // pauses shorter than this stay attached to the next word
const MIN_WORD = 0.08;

/**
 * Turn Whisper word timings + ffmpeg silencedetect output into tokens that
 * tile the whole source [0, duration] with no holes, which is what makes
 * "delete text = delete media" exact.
 */
export function buildTokens(raw: RawWord[], silences: { start: number; end: number }[], duration: number): Token[] {
  const words = raw
    .map((w) => ({ ...w, text: w.text.trim() }))
    .filter((w) => w.text.length > 0 && !/^\[.*\]$/.test(w.text))
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < words.length; i++) {
    const prevEnd = i ? words[i - 1].end : 0;
    words[i].start = Math.max(words[i].start, prevEnd);
    words[i].end = Math.min(Math.max(words[i].end, words[i].start + 0.02), duration);
  }

  // Carve real silences out of Whisper's (contiguous) word boundaries.
  for (const sil of silences) {
    if (sil.end - sil.start < 0.3 || !words.length) continue;
    const first = words[0];
    const last = words[words.length - 1];
    if (sil.start <= first.start + 0.15 && sil.end > first.start) {
      first.start = Math.min(Math.max(first.start, sil.end - PAD), first.end - MIN_WORD);
      continue;
    }
    if (sil.end >= last.end - 0.15 && sil.start < last.end && sil.start > last.start) {
      last.end = Math.max(Math.min(last.end, sil.start + PAD), last.start + MIN_WORD);
      continue;
    }
    const mid = (sil.start + sil.end) / 2;
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < words.length - 1; i++) {
      const b = words[i].end;
      if (b < sil.start - 0.2 || b > sil.end + 0.2) continue;
      const d = Math.abs(b - mid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best < 0) continue;
    const a = words[best];
    const b = words[best + 1];
    a.end = Math.max(Math.min(a.end, sil.start + PAD), a.start + MIN_WORD);
    b.start = Math.min(Math.max(b.start, sil.end - PAD), b.end - MIN_WORD);
    if (b.start < a.end) b.start = a.end;
  }

  const tokens: Token[] = [];
  let n = 0;
  const id = () => "t" + (n++).toString(36);
  let cursor = 0;
  let wordsInPara = 0;
  let lastGap = Infinity;
  for (const w of words) {
    const gap = w.start - cursor;
    let start = w.start;
    if (gap > MIN_GAP) {
      tokens.push({ id: id(), kind: "gap", text: "", start: cursor, end: w.start });
    } else {
      start = cursor;
    }
    const prevWord = [...tokens].reverse().find((t) => t.kind === "word");
    const sentenceEnd = !prevWord || /[.?!]["')\]]?$/.test(prevWord.text);
    const para = !prevWord || (sentenceEnd && (gap > 1.2 || wordsInPara > 70 || (lastGap > 0.7 && wordsInPara > 40)));
    if (para) wordsInPara = 0;
    tokens.push({
      id: id(),
      kind: "word",
      text: w.text,
      start,
      end: w.end,
      para: para || undefined,
      speaker: !prevWord ? "s1" : undefined,
      confidence: w.p,
    });
    wordsInPara++;
    lastGap = gap;
    cursor = w.end;
  }
  if (duration - cursor > MIN_GAP || !tokens.length) {
    tokens.push({ id: id(), kind: "gap", text: "", start: cursor, end: duration });
  } else if (tokens.length) {
    tokens[tokens.length - 1].end = duration;
  }
  return tokens;
}
