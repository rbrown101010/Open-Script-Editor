import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.OPEN_DESCRIPT_DATA ?? path.join(APP_ROOT, "projects");
/** Bind to loopback only by default: this server has no auth and can read local files. */
export const HOST = process.env.HOST ?? "127.0.0.1";
export const PORT = Number(process.env.PORT ?? 4317);
fs.mkdirSync(DATA_DIR, { recursive: true });

export const projectDir = (id: string) => path.join(DATA_DIR, safeId(id));
export const mediaDir = (id: string) => path.join(projectDir(id), "media");
export const exportsDir = (id: string) => path.join(projectDir(id), "exports");
export const cacheDir = (id: string) => path.join(projectDir(id), "cache");

export function safeId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Bad id");
  return id;
}

export function safeFileName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, "_").slice(-120);
  return base || "file";
}

/** Whisper model: $WHISPER_MODEL, else the first ggml model in ./models or ~/.cache/whisper. */
export function findWhisperModel(): string | null {
  if (process.env.WHISPER_MODEL && fs.existsSync(process.env.WHISPER_MODEL)) return process.env.WHISPER_MODEL;
  const prefer = ["ggml-small.en.bin", "ggml-base.en.bin", "ggml-medium.en.bin", "ggml-large-v3-turbo.bin"];
  for (const dir of [path.join(APP_ROOT, "models"), path.join(os.homedir(), ".cache", "whisper")]) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((n) => /^ggml-.*\.bin$/.test(n) && !n.includes("encoder"));
    const pick = prefer.find((p) => files.includes(p)) ?? files[0];
    if (pick) return path.join(dir, pick);
  }
  return null;
}

export function whisperBin(): string {
  return process.env.WHISPER_CLI ?? "whisper-cli";
}
