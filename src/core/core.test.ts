import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps } from "./ops.ts";
import { compose } from "./compose.ts";
import { buildTokens } from "./transcript.ts";
import { detectFillers } from "./fillers.ts";
import type { EditState } from "./types.ts";

const words = [
  { text: "Um,", start: 0.5, end: 0.8 },
  { text: "hello", start: 0.8, end: 1.2 },
  { text: "the", start: 1.2, end: 1.4 },
  { text: "the", start: 1.4, end: 1.6 },
  { text: "world.", start: 1.6, end: 2.0 },
  { text: "Bye.", start: 3.5, end: 4.0 },
];
const tokens = buildTokens(words, [{ start: 0, end: 0.5 }, { start: 2.0, end: 3.5 }], 4.5);
const state = (): EditState => ({ name: "t", speakers: [], tokens, markers: [], layers: [] });
const w = (text: string, n = 0) => tokens.filter((t) => t.text === text)[n].id;

test("tokens tile the whole source", () => {
  assert.equal(tokens[0].start, 0);
  assert.equal(tokens[tokens.length - 1].end, 4.5);
  for (let i = 1; i < tokens.length; i++) assert.ok(Math.abs(tokens[i].start - tokens[i - 1].end) < 1e-9);
  assert.equal(compose(state()).duration, 4.5);
});

test("deleting words removes their media", () => {
  const s = applyOps(state(), [{ type: "deleteRange", fromId: w("hello"), toId: w("the", 1) }]);
  const c = compose(s);
  assert.equal(c.segments.length, 2);
  assert.ok(Math.abs(c.duration - (4.5 - 0.8)) < 1e-9);
});

test("fillers and repeats are detected and removable", () => {
  const f = detectFillers(tokens);
  assert.equal(f.get(w("Um,")), "um");
  assert.equal(f.get(w("the", 0)), "repeat");
  const s = applyOps(state(), [{ type: "removeFillers" }]);
  assert.ok(s.tokens.find((t) => t.id === w("Um,"))!.deleted);
  assert.ok(s.tokens.find((t) => t.id === w("the", 0))!.deleted);
});

test("shortening gaps, moving text, and layers follow edits", () => {
  let s = applyOps(state(), [
    { type: "shortenGaps", longerThan: 0.4, trimTo: 0.2 },
    { type: "addLayer", id: "L", layerType: "text", fromId: w("hello"), toId: w("world."), text: "Hi" },
    { type: "addMarker", id: "M", tokenId: w("Bye."), title: "End" },
  ]);
  let c = compose(s);
  assert.ok(Math.abs(c.duration - (4.5 - 0.3 - 1.3 - 0.3)) < 1e-6);
  s = applyOps(s, [{ type: "moveRange", fromId: w("Bye."), toId: w("Bye."), beforeId: tokens[0].id }]);
  c = compose(s);
  assert.equal(c.markers[0].time, 0);
  const layer = c.layers[0];
  assert.ok(layer.start > 0.4 && layer.end - layer.start > 1);
});
