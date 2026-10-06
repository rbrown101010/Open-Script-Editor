import express, { type Request, type Response, type NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Asset, Project } from "../src/core/types.ts";
import { compose } from "../src/core/compose.ts";
import { OpError, type EditOp } from "../src/core/ops.ts";
import { fillerCounts } from "../src/core/fillers.ts";
import { APP_ROOT, DATA_DIR, HOST, PORT, cacheDir, exportsDir, findWhisperModel, mediaDir, projectDir, safeFileName, safeId } from "./paths.ts";
import { probe, thumbnail } from "./media.ts";
import * as store from "./store.ts";
import { processProject } from "./transcribe.ts";
import { jobs, startExport, type ExportFormat } from "./render.ts";

const app = express();
app.disable("x-powered-by");

// ---------- local-only security ----------
// The API has no accounts and can read media files from disk, so it must only
// ever be driven by this machine. Two guards on top of binding to 127.0.0.1:
//  1. Host check: defeats DNS-rebinding (evil.com resolving to 127.0.0.1).
//  2. Origin check on writes: a web page you visit can't POST to this API.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const hostname = (h: string) => h.replace(/:\d+$/, "").toLowerCase();
app.use((req, res, next) => {
  const host = hostname(req.headers.host ?? "");
  if (!LOCAL_HOSTS.has(host) && !host.endsWith(".localhost")) return res.status(403).json({ error: "Forbidden host" });
  const origin = req.headers.origin;
  if (origin && req.method !== "GET" && req.method !== "HEAD") {
    let ok = false;
    try {
      ok = LOCAL_HOSTS.has(hostname(new URL(origin).host)) || new URL(origin).hostname.endsWith(".localhost");
    } catch {}
    if (!ok) return res.status(403).json({ error: "Cross-origin request blocked" });
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.json({ limit: "20mb" }));

const wrap =
  (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

const newId = (prefix: string) => prefix + "_" + Math.random().toString(36).slice(2, 10);
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i;
const MEDIA_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|mp3|wav|m4a|aac|flac|ogg|opus|aiff?|png|jpe?g|gif|webp|bmp|tiff?|heic)$/i;

/** Only accept absolute paths to existing regular media files. */
function localMediaPath(p: unknown): string {
  const src = typeof p === "string" ? path.resolve(p) : "";
  if (!src || !MEDIA_EXT.test(src) || !fs.existsSync(src) || !fs.statSync(src).isFile())
    throw Object.assign(new Error("Expected a path to an existing audio, video or image file"), { status: 400 });
  return src;
}
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|opus|aiff?)$/i;

function getProject(req: Request): Project {
  const id = safeId(String(req.params.id));
  if (!store.exists(id)) throw Object.assign(new Error("Project not found"), { status: 404 });
  return store.load(id);
}

/** Project JSON plus derived info the UI and agents usually want. */
function view(p: Project) {
  return { ...p, history: store.historyInfo(p.id) };
}

async function receiveUpload(req: Request, dir: string, name: string): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  let file = safeFileName(name);
  if (fs.existsSync(path.join(dir, file))) file = Date.now() + "-" + file;
  await pipeline(req, fs.createWriteStream(path.join(dir, file)));
  return file;
}

async function makeAsset(projectId: string, file: string, name: string): Promise<Asset> {
  const full = path.join(mediaDir(projectId), file);
  const isImage = IMAGE_EXT.test(file);
  const info = await probe(full);
  return {
    id: newId("as"),
    name,
    file,
    kind: isImage ? "image" : info.hasVideo && !AUDIO_EXT.test(file) ? "video" : "audio",
    duration: info.duration || undefined,
    width: info.width,
    height: info.height,
  };
}

async function createProject(id: string, file: string, name: string): Promise<Project> {
  const full = path.join(mediaDir(id), file);
  const info = await probe(full);
  if (!info.hasAudio) {
    fs.rmSync(projectDir(id), { recursive: true, force: true });
    throw Object.assign(new Error("That file has no audio track to transcribe."), { status: 400 });
  }
  const asset: Asset = {
    id: newId("as"),
    name,
    file,
    kind: info.hasVideo ? "video" : "audio",
    duration: info.duration,
    width: info.width,
    height: info.height,
  };
  const now = new Date().toISOString();
  const project: Project = {
    version: 1,
    id,
    rev: 0,
    name: name.replace(/\.[^.]+$/, ""),
    createdAt: now,
    updatedAt: now,
    mainAssetId: asset.id,
    width: info.hasVideo ? info.width : 1920,
    height: info.hasVideo ? info.height : 1080,
    fps: info.fps,
    duration: info.duration,
    hasVideo: info.hasVideo,
    assets: [asset],
    speakers: [{ id: "s1", name: "Speaker 1" }],
    tokens: [],
    markers: [],
    layers: [],
    transcription: { state: "running", progress: 0, message: "Queued" },
  };
  store.save(project);
  if (info.hasVideo) void thumbnail(full, path.join(projectDir(id), "thumb.jpg"), Math.min(1, info.duration / 2));
  void processProject(id);
  return project;
}

// ---------- projects ----------

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, whisperModel: findWhisperModel(), dataDir: DATA_DIR });
});

app.get(
  "/api/projects",
  wrap((_req, res) => {
    res.json(
      store.list().map((p) => ({
        id: p.id,
        name: p.name,
        duration: p.duration,
        updatedAt: p.updatedAt,
        hasVideo: p.hasVideo,
        transcription: p.transcription,
        thumb: fs.existsSync(path.join(projectDir(p.id), "thumb.jpg")) ? `/media/${p.id}/thumb.jpg` : null,
      })),
    );
  }),
);

/** Upload a media file as the raw request body: POST /api/projects?name=clip.mp4 */
app.post(
  "/api/projects",
  wrap(async (req, res) => {
    const name = String(req.query.name ?? "Untitled.mp4");
    if (!MEDIA_EXT.test(name)) throw Object.assign(new Error("Unsupported file type"), { status: 400 });
    const id = newId("p");
    const file = await receiveUpload(req, mediaDir(id), name);
    res.json(view(await createProject(id, file, name)));
  }),
);

/** For agents/CLI: create a project from a file already on disk. Body: { path, name? } */
app.post(
  "/api/projects/from-path",
  wrap(async (req, res) => {
    const src = localMediaPath(req.body?.path);
    const id = newId("p");
    const name = req.body?.name ?? path.basename(src);
    fs.mkdirSync(mediaDir(id), { recursive: true });
    const file = safeFileName(path.basename(src));
    fs.copyFileSync(src, path.join(mediaDir(id), file));
    res.json(view(await createProject(id, file, name)));
  }),
);

app.get("/api/projects/:id", wrap((req, res) => res.json(view(getProject(req)))));

app.delete(
  "/api/projects/:id",
  wrap((req, res) => {
    store.remove(getProject(req).id);
    res.json({ ok: true });
  }),
);

/** The compiled edit: segments, layer timings and chapters in output time. */
app.get(
  "/api/projects/:id/composition",
  wrap((req, res) => {
    const p = getProject(req);
    const c = compose(p);
    res.json({
      duration: c.duration,
      segments: c.segments,
      layers: c.layers.map(({ layer, start, end }) => ({ id: layer.id, type: layer.type, start, end })),
      chapters: c.markers.map((m) => ({ id: m.marker.id, title: m.marker.title, time: m.time })),
      fillers: fillerCounts(p.tokens),
    });
  }),
);

/**
 * Compact, agent-friendly script: one line per paragraph, every token tagged
 * with its id so an agent can reference exact ranges in ops.
 */
app.get(
  "/api/projects/:id/script",
  wrap((req, res) => {
    const p = getProject(req);
    const c = compose(p);
    const paragraphs: { start: number; text: string; tokens: [string, string, boolean][] }[] = [];
    for (const t of p.tokens) {
      if (t.para || !paragraphs.length) paragraphs.push({ start: c.tokenOut.get(t.id)?.start ?? -1, text: "", tokens: [] });
      const para = paragraphs[paragraphs.length - 1];
      const label = t.kind === "gap" ? `[pause ${(t.end - t.start).toFixed(1)}s]` : t.text;
      para.tokens.push([t.id, label, !!t.deleted]);
      if (!t.deleted && t.kind === "word") para.text += (para.text ? " " : "") + t.text;
    }
    res.json({ rev: p.rev, duration: c.duration, paragraphs });
  }),
);

app.post(
  "/api/projects/:id/ops",
  wrap(async (req, res) => {
    const p = getProject(req);
    const ops = (Array.isArray(req.body) ? req.body : req.body?.ops) as EditOp[];
    if (!Array.isArray(ops) || !ops.length) throw Object.assign(new Error("Body must be { ops: EditOp[] }"), { status: 400 });
    if (req.body?.rev != null && req.body.rev !== p.rev)
      throw Object.assign(new Error(`Stale rev ${req.body.rev}; project is at ${p.rev}`), { status: 409 });
    const next = await store.withLock(p.id, () => store.applyEdit(p.id, ops));
    res.json(view(next));
  }),
);

app.post("/api/projects/:id/undo", wrap(async (req, res) => res.json(view(await store.withLock(getProject(req).id, () => store.undo(req.params.id as string))))));
app.post("/api/projects/:id/redo", wrap(async (req, res) => res.json(view(await store.withLock(getProject(req).id, () => store.redo(req.params.id as string))))));

app.post(
  "/api/projects/:id/transcribe",
  wrap(async (req, res) => {
    const p = getProject(req);
    store.update(p.id, { transcription: { state: "running", progress: 0, message: "Queued" } });
    void processProject(p.id);
    res.json(view(store.load(p.id)));
  }),
);

app.get(
  "/api/projects/:id/peaks",
  wrap((req, res) => {
    const f = path.join(cacheDir(getProject(req).id), "peaks.json");
    if (!fs.existsSync(f)) return res.json({ rate: 100, data: [] });
    res.type("json").send(fs.readFileSync(f));
  }),
);

// ---------- assets (media for layers) ----------

app.post(
  "/api/projects/:id/assets",
  wrap(async (req, res) => {
    const p = getProject(req);
    const name = String(req.query.name ?? "asset");
    if (!MEDIA_EXT.test(name)) throw Object.assign(new Error("Unsupported file type"), { status: 400 });
    const file = await receiveUpload(req, mediaDir(p.id), name);
    const asset = await makeAsset(p.id, file, name);
    const next = await store.withLock(p.id, () => {
      const cur = store.load(p.id);
      return store.save({ ...cur, assets: cur.assets.concat(asset) });
    });
    res.json({ asset, project: view(next) });
  }),
);

app.post(
  "/api/projects/:id/assets/from-path",
  wrap(async (req, res) => {
    const p = getProject(req);
    const src = localMediaPath(req.body?.path);
    let file = safeFileName(path.basename(src));
    if (fs.existsSync(path.join(mediaDir(p.id), file))) file = Date.now() + "-" + file;
    fs.copyFileSync(src, path.join(mediaDir(p.id), file));
    const asset = await makeAsset(p.id, file, req.body?.name ?? path.basename(src));
    const next = await store.withLock(p.id, () => {
      const cur = store.load(p.id);
      return store.save({ ...cur, assets: cur.assets.concat(asset) });
    });
    res.json({ asset, project: view(next) });
  }),
);

// ---------- export ----------

app.post(
  "/api/projects/:id/export",
  wrap((req, res) => {
    const p = getProject(req);
    const format = String(req.body?.format ?? "mp4") as ExportFormat;
    if (!["mp4", "mp3", "wav", "srt", "txt", "md", "chapters", "edl"].includes(format))
      throw Object.assign(new Error("Unknown format " + format), { status: 400 });
    res.json(startExport(p, format, { height: Number(req.body?.height) || undefined }));
  }),
);

app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "No such job" });
  res.json({
    ...job,
    url: job.file ? `/api/projects/${job.projectId}/exports/${encodeURIComponent(job.file)}` : undefined,
    path: job.file ? path.join(exportsDir(job.projectId), job.file) : undefined,
  });
});

app.get(
  "/api/projects/:id/exports/:file",
  wrap((req, res) => {
    const p = getProject(req);
    const f = path.join(exportsDir(p.id), safeFileName(String(req.params.file)));
    if (!fs.existsSync(f)) return res.status(404).end();
    res.download(f);
  }),
);

// Media with HTTP range support (needed for video seeking).
app.get(
  "/media/:id/:file",
  wrap((req, res) => {
    const id = safeId(String(req.params.id));
    const name = safeFileName(String(req.params.file));
    const f = name === "thumb.jpg" ? path.join(projectDir(id), name) : path.join(mediaDir(id), name);
    if (!fs.existsSync(f)) return res.status(404).end();
    res.sendFile(f, { acceptRanges: true });
  }),
);

// Production: serve the built UI from the same port.
const dist = path.join(APP_ROOT, "dist");
if (process.env.NODE_ENV === "production" && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|media).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof OpError ? 400 : err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? "Internal error (see server log)" : err.message ?? String(err) });
});

// Resume anything that was mid-transcription when the server stopped.
for (const p of store.list()) {
  if (p.transcription.state === "running") void processProject(p.id);
}

app.listen(PORT, HOST, () => {
  const model = findWhisperModel();
  console.log(`\n  Open Script Editor server  http://localhost:${PORT}`);
  console.log(`  Data:    ${DATA_DIR}`);
  console.log(`  Whisper: ${model ?? "NO MODEL FOUND (run npm run setup)"}\n`);
});
