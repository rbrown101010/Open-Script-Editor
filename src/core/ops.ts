import type { EditState, Layer, LayerStyle, Token } from "./types.ts";
import { detectFillers, FILLER_WORDS } from "./fillers.ts";

// Every edit, from a keystroke in the UI or from an AI agent, is one of these
// JSON-serializable operations. applyOps is pure: (state, ops) -> new state.
// Token ranges are given as ids (fromId..toId inclusive, in script order) so
// ops stay valid while other edits happen around them.

export type EditOp =
  | { type: "deleteRange"; fromId: string; toId: string }
  | { type: "deleteTokens"; ids: string[] }
  | { type: "restoreRange"; fromId: string; toId: string }
  | { type: "restoreTokens"; ids: string[] }
  | { type: "correctText"; id: string; text: string }
  | { type: "moveRange"; fromId: string; toId: string; beforeId: string | null }
  | { type: "splitParagraph"; tokenId: string }
  | { type: "joinParagraph"; tokenId: string }
  | { type: "setGapTrim"; ids: string[]; trimTo: number | null }
  | { type: "shortenGaps"; longerThan: number; trimTo: number }
  | { type: "removeFillers"; words?: string[]; includeRepeats?: boolean }
  | { type: "addMarker"; id?: string; tokenId: string; title: string }
  | { type: "updateMarker"; id: string; title?: string; tokenId?: string }
  | { type: "removeMarker"; id: string }
  | {
      type: "addLayer";
      id?: string;
      layerType: Layer["type"];
      fromId: string;
      toId: string;
      assetId?: string;
      text?: string;
      track?: number;
      style?: Partial<LayerStyle>;
      volume?: number;
    }
  | {
      type: "updateLayer";
      id: string;
      fromId?: string;
      toId?: string;
      text?: string;
      track?: number;
      style?: Partial<LayerStyle>;
      volume?: number;
    }
  | { type: "removeLayer"; id: string }
  | { type: "renameProject"; name: string }
  | { type: "renameSpeaker"; id: string; name: string }
  | { type: "setSpeaker"; tokenId: string; speakerId: string };

export class OpError extends Error {}

export function newId(prefix: string): string {
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

export function indexOfToken(tokens: Token[], id: string): number {
  const i = tokens.findIndex((t) => t.id === id);
  if (i < 0) throw new OpError(`Unknown token id: ${id}`);
  return i;
}

/** Inclusive index range for fromId..toId, normalized so a <= b. */
export function rangeIdx(tokens: Token[], fromId: string, toId: string): [number, number] {
  const a = indexOfToken(tokens, fromId);
  const b = indexOfToken(tokens, toId);
  return a <= b ? [a, b] : [b, a];
}

export const DEFAULT_STYLE: Record<Layer["type"], LayerStyle> = {
  image: { x: 0, y: 0, w: 1, h: 1, fit: "cover", opacity: 1 },
  video: { x: 0, y: 0, w: 1, h: 1, fit: "cover", opacity: 1 },
  text: {
    x: 0.08,
    y: 0.72,
    w: 0.84,
    h: 0.16,
    fit: "contain",
    opacity: 1,
    fontSize: 0.075,
    color: "#ffffff",
    background: "rgba(0,0,0,0.55)",
    fontWeight: 700,
    align: "center",
  },
};

function mapTokens(state: EditState, idxs: Iterable<number>, fn: (t: Token) => Token): Token[] {
  const tokens = state.tokens.slice();
  for (const i of idxs) tokens[i] = fn(tokens[i]);
  return tokens;
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export function applyOp(state: EditState, op: EditOp): EditState {
  const { tokens } = state;
  switch (op.type) {
    case "deleteRange":
    case "restoreRange": {
      const [a, b] = rangeIdx(tokens, op.fromId, op.toId);
      const deleted = op.type === "deleteRange";
      return { ...state, tokens: mapTokens(state, range(a, b), (t) => ({ ...t, deleted })) };
    }
    case "deleteTokens":
    case "restoreTokens": {
      const deleted = op.type === "deleteTokens";
      const idx = op.ids.map((id) => indexOfToken(tokens, id));
      return { ...state, tokens: mapTokens(state, idx, (t) => ({ ...t, deleted })) };
    }
    case "correctText": {
      const i = indexOfToken(tokens, op.id);
      const text = op.text.trim();
      if (!text) throw new OpError("correctText needs non-empty text (delete the word instead)");
      return { ...state, tokens: mapTokens(state, [i], (t) => ({ ...t, text })) };
    }
    case "moveRange": {
      const [a, b] = rangeIdx(tokens, op.fromId, op.toId);
      if (op.beforeId) {
        const t = indexOfToken(tokens, op.beforeId);
        if (t > a && t <= b) throw new OpError("Cannot move a range into itself");
      }
      const moving = tokens.slice(a, b + 1);
      const rest = tokens.slice(0, a).concat(tokens.slice(b + 1));
      const at = op.beforeId ? rest.findIndex((t) => t.id === op.beforeId) : rest.length;
      const next = rest.slice(0, at).concat(moving, rest.slice(at));
      return { ...state, tokens: next };
    }
    case "splitParagraph":
    case "joinParagraph": {
      const i = indexOfToken(tokens, op.tokenId);
      const para = op.type === "splitParagraph";
      if (i === 0) return state;
      return { ...state, tokens: mapTokens(state, [i], (t) => ({ ...t, para })) };
    }
    case "setGapTrim": {
      const idx = op.ids.map((id) => indexOfToken(tokens, id)).filter((i) => tokens[i].kind === "gap");
      return {
        ...state,
        tokens: mapTokens(state, idx, (t) => ({ ...t, trimTo: op.trimTo ?? undefined })),
      };
    }
    case "shortenGaps": {
      const idx = tokens
        .map((t, i) => (t.kind === "gap" && t.end - t.start > op.longerThan ? i : -1))
        .filter((i) => i >= 0);
      return { ...state, tokens: mapTokens(state, idx, (t) => ({ ...t, trimTo: op.trimTo })) };
    }
    case "removeFillers": {
      const words = new Set((op.words ?? FILLER_WORDS).map((w) => w.toLowerCase()));
      const found = detectFillers(tokens);
      const idx: number[] = [];
      tokens.forEach((t, i) => {
        const f = found.get(t.id);
        if (!f) return;
        if (f === "repeat" ? op.includeRepeats !== false : words.has(f)) idx.push(i);
      });
      return { ...state, tokens: mapTokens(state, idx, (t) => ({ ...t, deleted: true })) };
    }
    case "addMarker": {
      indexOfToken(tokens, op.tokenId);
      const marker = { id: op.id ?? newId("mk"), tokenId: op.tokenId, title: op.title || "Chapter" };
      return { ...state, markers: state.markers.filter((m) => m.tokenId !== op.tokenId).concat(marker) };
    }
    case "updateMarker": {
      if (op.tokenId) indexOfToken(tokens, op.tokenId);
      return {
        ...state,
        markers: state.markers.map((m) =>
          m.id === op.id ? { ...m, title: op.title ?? m.title, tokenId: op.tokenId ?? m.tokenId } : m,
        ),
      };
    }
    case "removeMarker":
      return { ...state, markers: state.markers.filter((m) => m.id !== op.id) };
    case "addLayer": {
      const [a, b] = rangeIdx(tokens, op.fromId, op.toId);
      if ((op.layerType === "image" || op.layerType === "video") && !op.assetId)
        throw new OpError(`${op.layerType} layers need an assetId`);
      const track = op.track ?? Math.max(0, ...state.layers.map((l) => l.track)) + 1;
      const layer: Layer = {
        id: op.id ?? newId("ly"),
        type: op.layerType,
        startTokenId: tokens[a].id,
        endTokenId: tokens[b].id,
        assetId: op.assetId,
        text: op.layerType === "text" ? op.text ?? "Title" : undefined,
        track,
        style: { ...DEFAULT_STYLE[op.layerType], ...op.style },
        volume: op.layerType === "video" ? op.volume ?? 0 : undefined,
      };
      return { ...state, layers: state.layers.concat(layer) };
    }
    case "updateLayer": {
      const layer = state.layers.find((l) => l.id === op.id);
      if (!layer) throw new OpError(`Unknown layer id: ${op.id}`);
      let { startTokenId, endTokenId } = layer;
      if (op.fromId || op.toId) {
        const [a, b] = rangeIdx(tokens, op.fromId ?? startTokenId, op.toId ?? endTokenId);
        startTokenId = tokens[a].id;
        endTokenId = tokens[b].id;
      }
      const next: Layer = {
        ...layer,
        startTokenId,
        endTokenId,
        text: op.text ?? layer.text,
        track: op.track ?? layer.track,
        volume: op.volume ?? layer.volume,
        style: { ...layer.style, ...op.style },
      };
      return { ...state, layers: state.layers.map((l) => (l.id === op.id ? next : l)) };
    }
    case "removeLayer":
      return { ...state, layers: state.layers.filter((l) => l.id !== op.id) };
    case "renameProject":
      return { ...state, name: op.name.trim() || state.name };
    case "renameSpeaker":
      return { ...state, speakers: state.speakers.map((s) => (s.id === op.id ? { ...s, name: op.name } : s)) };
    case "setSpeaker": {
      const i = indexOfToken(tokens, op.tokenId);
      let speakers = state.speakers;
      if (!speakers.some((s) => s.id === op.speakerId))
        speakers = speakers.concat({ id: op.speakerId, name: `Speaker ${speakers.length + 1}` });
      return { ...state, speakers, tokens: mapTokens(state, [i], (t) => ({ ...t, speaker: op.speakerId })) };
    }
    default: {
      const never: never = op;
      throw new OpError(`Unknown op: ${JSON.stringify(never)}`);
    }
  }
}

export function applyOps(state: EditState, ops: EditOp[]): EditState {
  return ops.reduce(applyOp, state);
}
