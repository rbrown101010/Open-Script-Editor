import fs from "node:fs";
import path from "node:path";
import type { EditState, Project } from "../src/core/types.ts";
import { applyOps, type EditOp } from "../src/core/ops.ts";
import { DATA_DIR, projectDir } from "./paths.ts";

const HISTORY_LIMIT = 300;

interface History {
  undo: EditState[];
  redo: EditState[];
}

const cache = new Map<string, Project>();
const histories = new Map<string, History>();
const locks = new Map<string, Promise<unknown>>();

/** Serialize all mutations of one project. */
export function withLock<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(id, next.catch(() => {}));
  return next;
}

const file = (id: string) => path.join(projectDir(id), "project.json");

export function exists(id: string): boolean {
  try {
    return fs.existsSync(file(id));
  } catch {
    return false;
  }
}

export function load(id: string): Project {
  const hit = cache.get(id);
  if (hit) return hit;
  const p = JSON.parse(fs.readFileSync(file(id), "utf8")) as Project;
  p.rev ??= 0;
  cache.set(id, p);
  return p;
}

export function save(p: Project): Project {
  p.updatedAt = new Date().toISOString();
  fs.mkdirSync(projectDir(p.id), { recursive: true });
  const tmp = file(p.id) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(p));
  fs.renameSync(tmp, file(p.id));
  cache.set(p.id, p);
  return p;
}

export function update(id: string, patch: Partial<Project>): Project {
  return save({ ...load(id), ...patch });
}

export function list(): Project[] {
  return fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(DATA_DIR, d.name, "project.json")))
    .map((d) => {
      try {
        return load(d.name);
      } catch {
        return null;
      }
    })
    .filter((p): p is Project => !!p)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function remove(id: string): void {
  cache.delete(id);
  histories.delete(id);
  fs.rmSync(projectDir(id), { recursive: true, force: true });
}

function editState(p: Project): EditState {
  return { name: p.name, speakers: p.speakers, tokens: p.tokens, markers: p.markers, layers: p.layers };
}

function history(id: string): History {
  let h = histories.get(id);
  if (!h) {
    h = { undo: [], redo: [] };
    histories.set(id, h);
  }
  return h;
}

export function applyEdit(id: string, ops: EditOp[]): Project {
  const p = load(id);
  const before = editState(p);
  const after = applyOps(before, ops);
  const h = history(id);
  h.undo.push(before);
  if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
  h.redo = [];
  appendLog(id, ops);
  return save({ ...p, ...after, rev: p.rev + 1 });
}

export function undo(id: string): Project {
  const p = load(id);
  const h = history(id);
  const prev = h.undo.pop();
  if (!prev) return p;
  h.redo.push(editState(p));
  appendLog(id, [{ type: "undo" } as never]);
  return save({ ...p, ...prev, rev: p.rev + 1 });
}

export function redo(id: string): Project {
  const p = load(id);
  const h = history(id);
  const next = h.redo.pop();
  if (!next) return p;
  h.undo.push(editState(p));
  appendLog(id, [{ type: "redo" } as never]);
  return save({ ...p, ...next, rev: p.rev + 1 });
}

export function historyInfo(id: string) {
  const h = history(id);
  return { canUndo: h.undo.length > 0, canRedo: h.redo.length > 0 };
}

/** Append-only log of every op: an audit trail of how the edit was made. */
function appendLog(id: string, ops: EditOp[]) {
  const line = JSON.stringify({ at: new Date().toISOString(), ops }) + "\n";
  fs.appendFile(path.join(projectDir(id), "ops.log.jsonl"), line, () => {});
}
