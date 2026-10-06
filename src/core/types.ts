// The project document. Everything an editor (human or AI agent) can change
// lives here, and every change goes through an EditOp (see ops.ts).
//
// Core idea (same as Descript): the transcript IS the timeline. The source
// media is partitioned into contiguous tokens (words and gaps). The order of
// `tokens` is playback order; deleting a token removes its media range;
// moving tokens reorders media. Layers and markers are anchored to token ids,
// so they follow every edit automatically.

export type TokenKind = "word" | "gap";

export interface Token {
  id: string;
  kind: TokenKind;
  /** Display text. For words this is what the user sees (and can correct). */
  text: string;
  /** Source media range in seconds. Tokens tile the source with no overlap. */
  start: number;
  end: number;
  /** Struck through in the script, skipped in playback and export. */
  deleted?: boolean;
  /** Gap only: keep at most this many seconds of the pause ("shorten gaps"). */
  trimTo?: number;
  /** This token begins a new paragraph. */
  para?: boolean;
  /** Speaker id (paragraph-level, read from the first token of a paragraph). */
  speaker?: string;
  /** Whisper confidence 0..1 when available. */
  confidence?: number;
}

export interface Marker {
  id: string;
  /** Marker sits right before this token in the script. */
  tokenId: string;
  title: string;
}

export type LayerType = "image" | "video" | "text";

export interface LayerStyle {
  /** Normalized rect on the canvas, 0..1. */
  x: number;
  y: number;
  w: number;
  h: number;
  fit: "cover" | "contain";
  opacity: number;
  // text layers
  fontSize?: number; // in canvas-height fractions (0.08 = 8% of frame height)
  color?: string;
  background?: string; // css color or "transparent"
  fontWeight?: number;
  align?: "left" | "center" | "right";
}

export interface Layer {
  id: string;
  type: LayerType;
  /** Anchored to a range of tokens: visible while those words play. */
  startTokenId: string;
  endTokenId: string;
  assetId?: string;
  text?: string;
  /** Higher tracks draw on top. */
  track: number;
  style: LayerStyle;
  /** Video layers: play the layer's own audio (0 = muted). */
  volume?: number;
}

export interface Asset {
  id: string;
  name: string;
  /** File name inside the project's media folder. */
  file: string;
  kind: "video" | "audio" | "image";
  duration?: number;
  width?: number;
  height?: number;
}

export interface Speaker {
  id: string;
  name: string;
}

export interface TranscriptionStatus {
  state: "none" | "running" | "done" | "error";
  progress: number; // 0..1
  message?: string;
}

export interface Project {
  version: 1;
  id: string;
  /** Increments on every edit; lets agents detect concurrent changes. */
  rev: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** The main ("composition") media that the transcript was made from. */
  mainAssetId: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  hasVideo: boolean;
  assets: Asset[];
  speakers: Speaker[];
  tokens: Token[];
  markers: Marker[];
  layers: Layer[];
  transcription: TranscriptionStatus;
}

/** The part of a project that edit ops touch, and that undo/redo snapshots. */
export type EditState = Pick<Project, "name" | "speakers" | "tokens" | "markers" | "layers">;

/** A contiguous piece of source media in the composed output. */
export interface Segment {
  srcStart: number;
  srcEnd: number;
  outStart: number;
  outEnd: number;
  tokenIds: string[];
}

export interface Composition {
  segments: Segment[];
  duration: number;
  /** Output-time range for every kept token. */
  tokenOut: Map<string, { start: number; end: number }>;
  /** Resolved layer timings in output time (only layers with kept words). */
  layers: { layer: Layer; start: number; end: number }[];
  /** Markers in output time. */
  markers: { marker: Marker; time: number }[];
}
