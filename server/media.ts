import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(
  cmd: string,
  args: string[],
  opts: { onStderr?: (chunk: string) => void; onStdoutData?: (b: Buffer) => void } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (b: Buffer) => {
      if (opts.onStdoutData) opts.onStdoutData(b);
      else stdout += b.toString();
    });
    p.stderr.on("data", (b: Buffer) => {
      const s = b.toString();
      stderr += s;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
      opts.onStderr?.(s);
    });
    p.on("error", reject);
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function runOk(cmd: string, args: string[], opts?: Parameters<typeof run>[2]): Promise<RunResult> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${cmd} failed (${r.code}): ${r.stderr.slice(-1500)}`);
  return r;
}

export interface Probe {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  fps: number;
}

export async function probe(file: string): Promise<Probe> {
  const r = await runOk("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
  const j = JSON.parse(r.stdout);
  const streams: any[] = j.streams ?? [];
  // attached cover art shows up as a video stream; ignore it
  const v = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const a = streams.find((s) => s.codec_type === "audio");
  let fps = 30;
  if (v?.avg_frame_rate && v.avg_frame_rate !== "0/0") {
    const [n, d] = v.avg_frame_rate.split("/").map(Number);
    if (n && d) fps = Math.round((n / d) * 100) / 100;
  }
  const isImage = v && (!j.format?.duration || ["png", "mjpeg", "webp", "gif", "bmp", "tiff"].includes(v.codec_name) && !a);
  return {
    duration: isImage ? 0 : Number(j.format?.duration ?? v?.duration ?? a?.duration ?? 0),
    hasVideo: !!v,
    hasAudio: !!a,
    width: v?.width ?? 1920,
    height: v?.height ?? 1080,
    fps,
  };
}

/** 16 kHz mono WAV for Whisper. */
export async function extractWav(input: string, out: string): Promise<void> {
  await runOk("ffmpeg", ["-y", "-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out]);
}

/** Audio envelope: 100 peaks per second, 0..255. */
export async function computePeaks(input: string): Promise<{ rate: number; data: number[] }> {
  const rate = 100;
  const sr = 8000;
  const per = sr / rate;
  const data: number[] = [];
  let acc = 0;
  let count = 0;
  let carry: Buffer | null = null;
  await runOk("ffmpeg", ["-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", String(sr), "-f", "s16le", "-"], {
    onStdoutData: (b) => {
      if (carry) {
        b = Buffer.concat([carry, b]);
        carry = null;
      }
      const n = Math.floor(b.length / 2);
      for (let i = 0; i < n; i++) {
        const v = Math.abs(b.readInt16LE(i * 2));
        if (v > acc) acc = v;
        if (++count === per) {
          data.push(Math.min(255, Math.round(Math.sqrt(acc / 32768) * 255)));
          acc = 0;
          count = 0;
        }
      }
      if (b.length % 2) carry = b.subarray(b.length - 1);
    },
  });
  return { rate, data };
}

export async function detectSilences(input: string, noiseDb = -38, minDur = 0.3): Promise<{ start: number; end: number }[]> {
  const r = await run("ffmpeg", ["-v", "info", "-i", input, "-af", `silencedetect=noise=${noiseDb}dB:d=${minDur}`, "-f", "null", "-"]);
  const out: { start: number; end: number }[] = [];
  let s: number | null = null;
  for (const line of r.stderr.split("\n")) {
    const a = line.match(/silence_start: (-?[\d.]+)/);
    if (a) s = Math.max(0, Number(a[1]));
    const b = line.match(/silence_end: ([\d.]+)/);
    if (b && s != null) {
      out.push({ start: s, end: Number(b[1]) });
      s = null;
    }
  }
  return out;
}

export async function thumbnail(input: string, out: string, at = 0.5): Promise<void> {
  await run("ffmpeg", ["-y", "-v", "error", "-ss", String(at), "-i", input, "-frames:v", "1", "-vf", "scale=480:-2", out]);
}
