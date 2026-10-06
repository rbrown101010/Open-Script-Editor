import type { Composition, EditState, Segment, Token } from "./types.ts";

const EPS = 0.002;

/** Media range a token contributes to the output (gaps may be shortened). */
export function keptRange(t: Token): [number, number] | null {
  if (t.deleted) return null;
  let end = t.end;
  if (t.kind === "gap" && t.trimTo != null) end = Math.min(t.end, t.start + Math.max(0, t.trimTo));
  return end - t.start > EPS ? [t.start, end] : null;
}

/**
 * Compile the edit state into an edit decision list: the ordered source
 * ranges that make up the output, plus output-time positions for tokens,
 * layers and markers. This is the single source of truth for playback,
 * the timeline UI and export.
 */
export function compose(state: Pick<EditState, "tokens" | "layers" | "markers">): Composition {
  const segments: Segment[] = [];
  const tokenOut = new Map<string, { start: number; end: number }>();
  let out = 0;
  for (const t of state.tokens) {
    const r = keptRange(t);
    if (!r) continue;
    const [s, e] = r;
    const last = segments[segments.length - 1];
    if (last && Math.abs(last.srcEnd - s) < EPS) {
      last.srcEnd = e;
      last.outEnd = out + (e - s);
      last.tokenIds.push(t.id);
    } else {
      segments.push({ srcStart: s, srcEnd: e, outStart: out, outEnd: out + (e - s), tokenIds: [t.id] });
    }
    tokenOut.set(t.id, { start: out, end: out + (e - s) });
    out += e - s;
  }

  const index = new Map(state.tokens.map((t, i) => [t.id, i]));

  const layers: Composition["layers"] = [];
  for (const layer of state.layers) {
    const a = index.get(layer.startTokenId);
    const b = index.get(layer.endTokenId);
    if (a == null || b == null) continue;
    let start = Infinity;
    let end = -Infinity;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
      const r = tokenOut.get(state.tokens[i].id);
      if (!r) continue;
      start = Math.min(start, r.start);
      end = Math.max(end, r.end);
    }
    if (end > start) layers.push({ layer, start, end });
  }
  layers.sort((x, y) => x.layer.track - y.layer.track);

  const markers: Composition["markers"] = [];
  for (const marker of state.markers) {
    const i = index.get(marker.tokenId);
    if (i == null) continue;
    // a marker on a deleted word lands on the next kept token
    let time = out;
    for (let j = i; j < state.tokens.length; j++) {
      const r = tokenOut.get(state.tokens[j].id);
      if (r) {
        time = r.start;
        break;
      }
    }
    markers.push({ marker, time });
  }
  markers.sort((x, y) => x.time - y.time);

  return { segments, duration: out, tokenOut, layers, markers };
}

/** Find the segment playing at output time t. */
export function segmentAt(comp: Composition, t: number): number {
  const segs = comp.segments;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t < segs[mid].outStart) hi = mid - 1;
    else if (t >= segs[mid].outEnd) lo = mid + 1;
    else return mid;
  }
  return Math.min(lo, segs.length - 1);
}

export function outToSrc(comp: Composition, t: number): { seg: number; src: number } | null {
  if (!comp.segments.length) return null;
  const i = segmentAt(comp, t);
  const s = comp.segments[i];
  return { seg: i, src: s.srcStart + Math.min(Math.max(0, t - s.outStart), s.srcEnd - s.srcStart) };
}

export function srcToOut(comp: Composition, seg: number, src: number): number {
  const s = comp.segments[seg];
  return s.outStart + (src - s.srcStart);
}

export function fmtTime(sec: number, withMs = false): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  const base = h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return withMs ? `${base}.${String(Math.floor((sec % 1) * 10))}` : base;
}

/** YouTube-style chapter list. YouTube requires the first chapter at 0:00. */
export function chaptersText(comp: Composition): string {
  const lines = comp.markers.map((m) => `${fmtTime(m.time)} ${m.marker.title}`);
  if (comp.markers.length && comp.markers[0].time > 0.5) lines.unshift("0:00 Intro");
  return lines.join("\n");
}
