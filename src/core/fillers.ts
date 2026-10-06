import type { Token } from "./types.ts";

/** Filler keys the UI and the removeFillers op understand. */
export const FILLER_WORDS = ["um", "uh", "er", "ah", "hmm", "mm", "like", "you know", "i mean"];

const SIMPLE = new Map<string, string>([
  ["um", "um"], ["umm", "um"], ["ummm", "um"], ["uhm", "um"], ["erm", "um"],
  ["uh", "uh"], ["uhh", "uh"], ["uhhh", "uh"],
  ["er", "er"], ["err", "er"],
  ["ah", "ah"], ["ahh", "ah"],
  ["hmm", "hmm"], ["hm", "hmm"], ["hmmm", "hmm"],
  ["mm", "mm"], ["mmm", "mm"],
]);

export function norm(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
}

const endsWithComma = (t: string) => /[,]$/.test(t.trim());

/**
 * Returns tokenId -> filler key for every filler token in script order.
 * "like" only counts when set off by commas ("it's, like, huge"), the way
 * Whisper punctuates verbal-tic usage. Repeated words ("the the") flag the
 * first copy as "repeat".
 */
export function detectFillers(tokens: Token[]): Map<string, string> {
  const words = tokens.filter((t) => t.kind === "word" && !t.deleted);
  const out = new Map<string, string>();
  for (let i = 0; i < words.length; i++) {
    const t = words[i];
    const n = norm(t.text);
    const prev = words[i - 1];
    const next = words[i + 1];
    const simple = SIMPLE.get(n);
    if (simple) {
      out.set(t.id, simple);
      continue;
    }
    if (n === "like" && (endsWithComma(t.text) || (prev && endsWithComma(prev.text)))) {
      out.set(t.id, "like");
      continue;
    }
    if (next) {
      const pair = n + " " + norm(next.text);
      if ((pair === "you know" || pair === "i mean") && endsWithComma(next.text)) {
        out.set(t.id, pair);
        out.set(next.id, pair);
        i++;
        continue;
      }
      if (n.length > 0 && n === norm(next.text) && !/[.?!]$/.test(t.text.trim())) {
        out.set(t.id, "repeat");
      }
    }
  }
  return out;
}

export function fillerCounts(tokens: Token[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of detectFillers(tokens).values()) counts[key] = (counts[key] ?? 0) + 1;
  // multi-word fillers tag two tokens each
  for (const k of Object.keys(counts)) if (k.includes(" ")) counts[k] = counts[k] / 2;
  return counts;
}
