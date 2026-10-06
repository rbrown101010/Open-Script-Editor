import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { Layer, Project } from "../src/core/types.ts";
import { compose, chaptersText } from "../src/core/compose.ts";
import { toSrt, toTranscript } from "../src/core/exporters.ts";
import { cacheDir, exportsDir, mediaDir } from "./paths.ts";
import { run, runOk } from "./media.ts";

export type ExportFormat = "mp4" | "mp3" | "wav" | "srt" | "txt" | "md" | "chapters" | "edl";

export interface Job {
  id: string;
  projectId: string;
  format: ExportFormat;
  state: "running" | "done" | "error";
  progress: number;
  message?: string;
  file?: string;
}

export const jobs = new Map<string, Job>();

export function startExport(project: Project, format: ExportFormat, opts: { height?: number } = {}): Job {
  const job: Job = {
    id: "job_" + Math.random().toString(36).slice(2, 10),
    projectId: project.id,
    format,
    state: "running",
    progress: 0,
  };
  jobs.set(job.id, job);
  doExport(project, job, opts).catch((e) => {
    console.error("[export]", e);
    job.state = "error";
    job.message = (e as Error).message;
  });
  return job;
}

const slug = (s: string) => s.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "export";

async function doExport(p: Project, job: Job, opts: { height?: number }) {
  const outDir = exportsDir(p.id);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const base = `${slug(p.name)}-${stamp}`;
  const comp = compose(p);
  const write = (ext: string, text: string) => {
    const f = `${base}.${ext}`;
    fs.writeFileSync(path.join(outDir, f), text);
    job.file = f;
    job.progress = 1;
    job.state = "done";
  };
  switch (job.format) {
    case "srt":
      return write("srt", toSrt(p, comp));
    case "txt":
      return write("txt", toTranscript(p));
    case "md":
      return write("md", toTranscript(p, { markdown: true }));
    case "chapters":
      return write("chapters.txt", chaptersText(comp) + "\n");
    case "edl":
      return write(
        "edl.json",
        JSON.stringify(
          {
            project: p.name,
            source: p.assets.find((a) => a.id === p.mainAssetId)?.file,
            duration: comp.duration,
            segments: comp.segments.map(({ tokenIds, ...s }) => ({ ...s, tokens: tokenIds.length })),
            layers: comp.layers.map(({ layer, start, end }) => ({ ...layer, start, end })),
            chapters: comp.markers.map((m) => ({ time: m.time, title: m.marker.title })),
          },
          null,
          2,
        ),
      );
  }
  await renderMedia(p, job, comp, base, opts);
}

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Layer styles come from the API; coerce every value that reaches ffmpeg or SVG to a bounded number. */
const num = (v: unknown, def: number, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};
function safeStyle(st: Layer["style"]): Layer["style"] {
  return {
    ...st,
    x: num(st.x, 0, -1, 2),
    y: num(st.y, 0, -1, 2),
    w: num(st.w, 1, 0.01, 3),
    h: num(st.h, 1, 0.01, 3),
    opacity: num(st.opacity, 1, 0, 1),
    fontSize: num(st.fontSize, 0.07, 0.005, 1),
    fontWeight: num(st.fontWeight, 700, 100, 900),
    fit: st.fit === "contain" ? "contain" : "cover",
    align: st.align === "left" || st.align === "right" ? st.align : "center",
  };
}

async function renderMedia(p: Project, job: Job, comp: ReturnType<typeof compose>, base: string, opts: { height?: number }) {
  if (!comp.segments.length) throw new Error("Nothing to export: every word is deleted.");
  const main = p.assets.find((a) => a.id === p.mainAssetId)!;
  const input = path.join(mediaDir(p.id), main.file);
  const work = path.join(cacheDir(p.id), "render-" + job.id);
  fs.mkdirSync(work, { recursive: true });
  const video = job.format === "mp4";
  const withVideo = video && p.hasVideo;
  const fps = p.fps || 30;

  // 1) Cut each kept segment. Boundaries snap to the frame grid so audio and
  //    video stay exactly the same length and never drift across many cuts.
  const segs = comp.segments
    .map((s) => {
      const a = withVideo ? Math.round(s.srcStart * fps) / fps : s.srcStart;
      const b = withVideo ? Math.round(s.srcEnd * fps) / fps : s.srcEnd;
      return { a, d: b - a };
    })
    .filter((s) => s.d > 0.0005);
  const total = segs.reduce((x, s) => x + s.d, 0);
  let done = 0;
  const files: string[] = [];
  await pool(segs, 4, async (s, i) => {
    const f = path.join(work, `seg${String(i).padStart(5, "0")}.mkv`);
    files[i] = f;
    const fade = Math.min(0.006, s.d / 4);
    const args = ["-y", "-v", "error", "-ss", s.a.toFixed(4), "-i", input, "-t", s.d.toFixed(4)];
    if (withVideo) args.push("-map", "0:v:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(fps));
    args.push(
      "-map", "0:a:0?", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
      "-af", `afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, s.d - fade).toFixed(4)}:d=${fade},apad`,
      f,
    );
    await runOk("ffmpeg", args);
    done += s.d;
    job.progress = 0.75 * (done / total);
  });

  // 2) Join them.
  const list = path.join(work, "list.txt");
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const joined = path.join(work, "joined.mkv");
  await runOk("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);

  // 3) Final encode with layers composited on top.
  const ext = video ? "mp4" : job.format;
  const outFile = `${base}.${ext}`;
  const outPath = path.join(exportsDir(p.id), outFile);
  const args = ["-y", "-v", "info", "-i", joined];
  if (!video) {
    args.push("-vn", ...(ext === "mp3" ? ["-c:a", "libmp3lame", "-b:a", "192k"] : ["-c:a", "pcm_s16le"]), outPath);
  } else {
    const H = even(opts.height && opts.height < p.height ? opts.height : p.height || 1080);
    const W = even((p.width || 1920) * (H / (p.height || 1080)));
    const filters: string[] = [];
    if (withVideo) filters.push(`[0:v]scale=${W}:${H},setsar=1,format=yuv420p[v0]`);
    else {
      args.push("-f", "lavfi", "-t", total.toFixed(3), "-i", `color=c=black:s=${W}x${H}:r=${fps}`);
    }
    let inputIdx = withVideo ? 1 : 2;
    let cur = withVideo ? "[v0]" : "[1:v]";
    const audioMix: string[] = [];
    let n = 0;
    for (const { layer: raw, start, end } of comp.layers) {
      const layer = { ...raw, style: safeStyle(raw.style), volume: num(raw.volume, 0, 0, 4) };
      const src = await layerSource(p, layer, W, H, work);
      if (!src) continue;
      const bw = even(layer.style.w * W);
      const bh = even(layer.style.h * H);
      const x = Math.round(layer.style.x * W);
      const y = Math.round(layer.style.y * H);
      const dur = end - start;
      if (src.kind === "image") args.push("-loop", "1", "-t", (end + 0.1).toFixed(3), "-i", src.file);
      else args.push("-i", src.file);
      const k = inputIdx++;
      const fit =
        src.kind === "text"
          ? `scale=${bw}:${bh}`
          : layer.style.fit === "cover"
            ? `scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh}`
            : `scale=${bw}:${bh}:force_original_aspect_ratio=decrease`;
      const timing = src.kind === "video" ? `trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS+${start.toFixed(3)}/TB,` : "";
      filters.push(
        `[${k}:v]${timing}${fit},format=rgba,colorchannelmixer=aa=${layer.style.opacity}[l${n}]`,
        `${cur}[l${n}]overlay=x='${x}+(${bw}-overlay_w)/2':y='${y}+(${bh}-overlay_h)/2':enable='between(t,${start.toFixed(3)},${end.toFixed(3)})':eof_action=pass[v${n + 1}]`,
      );
      if (src.kind === "video" && (layer.volume ?? 0) > 0 && src.hasAudio) {
        const ms = Math.round(start * 1000);
        filters.push(`[${k}:a]atrim=duration=${dur.toFixed(3)},adelay=${ms}|${ms},volume=${layer.volume}[la${n}]`);
        audioMix.push(`[la${n}]`);
      }
      cur = `[v${n + 1}]`;
      n++;
    }
    let audioOut = "0:a";
    if (audioMix.length) {
      filters.push(`[0:a]${audioMix.join("")}amix=inputs=${audioMix.length + 1}:duration=first:normalize=0[aout]`);
      audioOut = "[aout]";
    }
    const script = path.join(work, "filter.txt");
    fs.writeFileSync(script, filters.join(";\n"));
    args.push(
      "-filter_complex_script", script,
      "-map", cur, "-map", audioOut,
      "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(fps),
      "-c:a", "aac", "-b:a", "192k", "-t", total.toFixed(3), "-movflags", "+faststart", outPath,
    );
  }
  const r = await run("ffmpeg", args, {
    onStderr: (s) => {
      const m = [...s.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
      if (m) job.progress = 0.75 + 0.25 * Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / total);
    },
  });
  if (r.code !== 0) throw new Error("ffmpeg failed: " + r.stderr.slice(-1500));
  if (!process.env.KEEP_RENDER) fs.rmSync(work, { recursive: true, force: true });
  job.file = outFile;
  job.progress = 1;
  job.state = "done";
}

async function layerSource(
  p: Project,
  layer: Layer,
  W: number,
  H: number,
  work: string,
): Promise<{ kind: "image" | "video" | "text"; file: string; hasAudio?: boolean } | null> {
  if (layer.type === "text") {
    const file = path.join(work, `text-${layer.id}.png`);
    fs.writeFileSync(file, renderTextPng(layer, W, H));
    return { kind: "image", file };
  }
  const asset = p.assets.find((a) => a.id === layer.assetId);
  if (!asset) return null;
  const file = path.join(mediaDir(p.id), asset.file);
  if (asset.kind === "image") return { kind: "image", file };
  if (asset.kind === "video") {
    const r = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
    return { kind: "video", file, hasAudio: r.stdout.trim().length > 0 };
  }
  return null;
}

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Rasterize a text layer to exactly its box size so preview and export match. */
export function renderTextPng(layer: Layer, W: number, H: number): Buffer {
  const st = safeStyle(layer.style);
  const bw = even(st.w * W);
  const bh = even(st.h * H);
  const fs_ = Math.max(8, (st.fontSize ?? 0.07) * H);
  const lines = wrap(layer.text ?? "", Math.max(4, Math.floor(bw / (fs_ * 0.55))));
  const lh = fs_ * 1.2;
  const top = bh / 2 - (lines.length * lh) / 2 + fs_ * 0.85;
  const anchor = st.align === "left" ? "start" : st.align === "right" ? "end" : "middle";
  const tx = st.align === "left" ? fs_ * 0.5 : st.align === "right" ? bw - fs_ * 0.5 : bw / 2;
  const bg = st.background && st.background !== "transparent"
    ? `<rect x="0" y="0" width="${bw}" height="${bh}" rx="${Math.min(bh / 2, fs_ * 0.35)}" fill="${esc(st.background)}"/>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}">${bg}${lines
    .map(
      (l, i) =>
        `<text x="${tx}" y="${top + i * lh}" text-anchor="${anchor}" font-family="Helvetica Neue, Helvetica, Arial" font-weight="${st.fontWeight ?? 700}" font-size="${fs_}" fill="${esc(st.color ?? "#fff")}">${esc(l)}</text>`,
    )
    .join("")}</svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" } }).render().asPng();
}

export function wrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + " " + w).length > maxChars) {
        out.push(line);
        line = w;
      } else line = line ? line + " " + w : w;
    }
    out.push(line);
  }
  return out;
}
