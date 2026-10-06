import type { Composition } from "../core/types.ts";
import { outToSrc, srcToOut } from "../core/compose.ts";

type Listener = () => void;

/**
 * Plays the *edited* program from the untouched source file: it plays one
 * kept segment at a time and jumps over removed ranges, so edits are
 * instant (nothing is rendered until export).
 */
export class Player {
  video: HTMLVideoElement | null = null;
  comp: Composition | null = null;
  /** Playhead in output (edited) time. */
  time = 0;
  playing = false;
  rate = 1;
  private seg = 0;
  private raf = 0;
  private timer = 0;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** Bumps on every change; lets React subscribe cheaply. */
  version = 0;
  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  attach(video: HTMLVideoElement | null) {
    this.video = video;
    if (video) {
      video.playbackRate = this.rate;
      this.syncVideo();
    }
  }

  setComposition(comp: Composition) {
    const prev = this.comp;
    this.comp = comp;
    if (!comp.segments.length) {
      this.time = 0;
      this.pause();
      return;
    }
    // Keep the playhead on the same source moment if it still exists.
    if (prev && this.video) {
      const src = this.video.currentTime;
      const i = comp.segments.findIndex((s) => src >= s.srcStart - 0.001 && src < s.srcEnd);
      if (i >= 0) {
        this.seg = i;
        this.time = srcToOut(comp, i, src);
      } else {
        this.time = Math.min(this.time, comp.duration);
        this.seek(this.time);
      }
    }
    this.emit();
  }

  get duration() {
    return this.comp?.duration ?? 0;
  }

  seek(t: number) {
    if (!this.comp) return;
    this.time = Math.max(0, Math.min(t, this.duration));
    this.syncVideo();
    this.emit();
  }

  private syncVideo() {
    if (!this.comp || !this.video) return;
    const m = outToSrc(this.comp, this.time);
    if (!m) return;
    this.seg = m.seg;
    if (Math.abs(this.video.currentTime - m.src) > 0.01) this.video.currentTime = m.src;
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  play() {
    if (!this.comp || !this.video || !this.comp.segments.length) return;
    if (this.time >= this.duration - 0.02) this.time = 0;
    this.syncVideo();
    this.playing = true;
    void this.video.play().catch(() => {
      this.playing = false;
      this.emit();
    });
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
    // rAF stalls in background windows; a timer keeps cuts accurate anyway.
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.step(), 20);
    this.emit();
  }

  pause() {
    this.playing = false;
    this.video?.pause();
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    this.emit();
  }

  setRate(r: number) {
    this.rate = r;
    if (this.video) this.video.playbackRate = r;
    this.emit();
  }

  private tick = () => {
    if (!this.playing) return;
    this.step();
    if (this.playing) this.raf = requestAnimationFrame(this.tick);
  };

  private step() {
    const v = this.video;
    const comp = this.comp;
    if (!this.playing || !v || !comp) return;
    // Jump a hair early so the removed audio never leaks through.
    const lookahead = 0.022 * this.rate;
    const ct = v.currentTime;
    const seg = comp.segments[this.seg];
    if (seg && ct >= seg.srcStart - 0.05 && ct < seg.srcEnd - lookahead) {
      this.time = srcToOut(comp, this.seg, Math.max(seg.srcStart, ct));
    } else if (seg && ct >= seg.srcEnd - lookahead && ct < seg.srcEnd + 0.3) {
      if (this.seg + 1 >= comp.segments.length) {
        this.time = comp.duration;
        this.pause();
        return;
      }
      this.seg++;
      const next = comp.segments[this.seg];
      v.currentTime = next.srcStart;
      this.time = next.outStart;
    } else {
      // Source time maps to exactly one segment (each token appears once).
      const j = comp.segments.findIndex((s) => ct >= s.srcStart - 0.05 && ct < s.srcEnd);
      if (j >= 0) {
        this.seg = j;
        this.time = srcToOut(comp, j, Math.max(comp.segments[j].srcStart, ct));
      }
      // otherwise a seek is still in flight; hold the playhead
    }
    this.emit();
  }
}
