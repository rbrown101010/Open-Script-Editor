import fs from "node:fs";
import path from "node:path";
import { buildTokens, type RawWord } from "../src/core/transcript.ts";
import { cacheDir, findWhisperModel, mediaDir, whisperBin } from "./paths.ts";
import { computePeaks, detectSilences, extractWav, run } from "./media.ts";
import * as store from "./store.ts";

// Nudges Whisper to keep disfluencies ("um", "uh") instead of cleaning them up,
// which filler-word removal depends on.
const FILLER_PROMPT = "Umm, so, uh, let me think, like, hmm... Okay, um, here's what I'm, like, thinking.";

function setStatus(id: string, state: "running" | "done" | "error", progress: number, message?: string) {
  return store.withLock(id, () => store.update(id, { transcription: { state, progress, message } }));
}

export async function processProject(id: string): Promise<void> {
  const p = store.load(id);
  const main = p.assets.find((a) => a.id === p.mainAssetId);
  if (!main) throw new Error("Project has no main media");
  const input = path.join(mediaDir(id), main.file);
  const cache = cacheDir(id);
  fs.mkdirSync(cache, { recursive: true });
  try {
    await setStatus(id, "running", 0.02, "Extracting audio");
    const wav = path.join(cache, "audio16k.wav");
    await extractWav(input, wav);

    await setStatus(id, "running", 0.05, "Analyzing audio");
    const [peaks, silences] = await Promise.all([computePeaks(input), detectSilences(wav)]);
    fs.writeFileSync(path.join(cache, "peaks.json"), JSON.stringify(peaks));

    const model = findWhisperModel();
    if (!model) throw new Error("No Whisper model found. Run `npm run setup` to download one.");
    await setStatus(id, "running", 0.08, "Transcribing");
    // Whisper's word timestamps drift on long files, so transcribe short
    // chunks cut at real silences and offset each chunk's timings.
    const chunks = planChunks(silences, p.duration);
    const raw: RawWord[] = [];
    let finished = 0;
    await pool(chunks, 3, async (c, i) => {
      const words = await transcribeChunk(model, wav, c.start, c.end, path.join(cache, `chunk${i}`));
      raw.push(...words);
      finished += c.end - c.start;
      void setStatus(id, "running", 0.08 + 0.9 * (finished / p.duration), "Transcribing");
    });
    raw.sort((a, b) => a.start - b.start);
    const tokens = buildTokens(raw, silences, p.duration);
    await store.withLock(id, () => {
      const cur = store.load(id);
      return store.save({
        ...cur,
        tokens,
        markers: [],
        layers: [],
        speakers: cur.speakers.length ? cur.speakers : [{ id: "s1", name: "Speaker 1" }],
        transcription: { state: "done", progress: 1 },
        rev: cur.rev + 1,
      });
    });
  } catch (e) {
    console.error("[transcribe]", e);
    await setStatus(id, "error", 0, (e as Error).message);
  }
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

/** Split [0, duration] at silence midpoints into ~4-15 s chunks. */
export function planChunks(silences: { start: number; end: number }[], duration: number, min = 4, max = 15) {
  const cuts = silences.map((s) => (s.start + s.end) / 2).filter((t) => t > 0.5 && t < duration - 0.5);
  const chunks: { start: number; end: number }[] = [];
  let start = 0;
  while (duration - start > max) {
    const options = cuts.filter((t) => t >= start + min && t <= start + max);
    const cut = options.length ? options[options.length - 1] : start + max;
    chunks.push({ start, end: cut });
    start = cut;
  }
  chunks.push({ start, end: duration });
  return chunks;
}

async function transcribeChunk(model: string, wav: string, start: number, end: number, base: string): Promise<RawWord[]> {
  const chunkWav = base + ".wav";
  await run("ffmpeg", ["-y", "-v", "error", "-ss", start.toFixed(3), "-to", end.toFixed(3), "-i", wav, "-c", "copy", chunkWav]);
  const r = await run(whisperBin(), ["-m", model, "-f", chunkWav, "-oj", "-ml", "1", "-sow", "-np", "-t", "4", "--prompt", FILLER_PROMPT, "-of", base]);
  if (r.code !== 0) throw new Error("whisper-cli failed: " + r.stderr.slice(-800));
  const json = JSON.parse(fs.readFileSync(base + ".json", "utf8"));
  fs.rmSync(chunkWav, { force: true });
  fs.rmSync(base + ".json", { force: true });
  return (json.transcription ?? []).map((s: any) => ({
    text: String(s.text ?? ""),
    start: start + (s.offsets?.from ?? 0) / 1000,
    end: Math.min(end, start + (s.offsets?.to ?? 0) / 1000),
  }));
}
