import { useEffect, useMemo, useRef, useState } from "react";
import type { Composition } from "../core/types.ts";
import { fmtTime } from "../core/compose.ts";
import { api } from "./api.ts";
import type { EditorApi } from "./Editor.tsx";
import { selRange, type Selection } from "./Script.tsx";
import { layerColor, layerLabel } from "./layers.ts";

interface Props {
  ctx: EditorApi;
  comp: Composition;
  sel: Selection | null;
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
}

const RULER = 22;
const LANE = 22;
const WORDS = 58;

function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Canvas timeline of the edited program: ruler + markers, layer lanes, words over waveform. */
export function Timeline({ ctx, comp, sel, selectedLayerId, onSelectLayer }: Props) {
  const { project, player } = ctx;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<{ rate: number; data: number[] } | null>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(0); // 0 = fit
  const [scroll, setScroll] = useState(0);

  useEffect(() => {
    if (project.transcription.state === "done") api.peaks(project.id).then(setPeaks).catch(() => {});
  }, [project.id, project.transcription.state]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tracks = useMemo(() => {
    const t = [...new Set(comp.layers.map((l) => l.layer.track))].sort((a, b) => b - a);
    return t;
  }, [comp]);
  const height = RULER + Math.max(1, tracks.length) * LANE + WORDS + 8;
  const fitPps = (width - 24) / Math.max(1, comp.duration);
  const pps = zoom === 0 ? fitPps : Math.max(fitPps, zoom);
  const contentW = comp.duration * pps + 24;
  const maxScroll = Math.max(0, contentW - width);
  const sx = Math.min(scroll, maxScroll);

  const selRangeOut = useMemo(() => {
    if (!sel || sel.caret) return null;
    const [a, b] = selRange(sel);
    let s = Infinity;
    let e = -Infinity;
    for (let i = a; i <= b; i++) {
      const r = comp.tokenOut.get(project.tokens[i]?.id);
      if (r) {
        s = Math.min(s, r.start);
        e = Math.max(e, r.end);
      }
    }
    return e > s ? [s, e] : null;
  }, [sel, comp, project.tokens]);

  // Draw on every playhead change.
  useEffect(() => {
    const draw = () => {
      const cache = new Map<string, string>();
      const C = (n: string) => cache.get(n) ?? (cache.set(n, css(n)), cache.get(n)!);
      const c = canvasRef.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== width * dpr || c.height !== height * dpr) {
        c.width = width * dpr;
        c.height = height * dpr;
      }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      const X = (t: number) => 12 + t * pps - sx;
      const t0 = Math.max(0, (sx - 12) / pps);
      const t1 = Math.min(comp.duration, (sx + width) / pps);
      const muted = C("--muted");
      const line = C("--line");
      const text = C("--text");

      // ruler
      g.fillStyle = C("--panel-2");
      g.fillRect(0, 0, width, RULER);
      const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
      const step = steps.find((s) => s * pps >= 70) ?? 600;
      g.font = "10px -apple-system, system-ui, sans-serif";
      g.fillStyle = muted;
      g.strokeStyle = line;
      for (let t = Math.floor(t0 / step) * step; t <= t1; t += step) {
        const x = X(t);
        g.beginPath();
        g.moveTo(x + 0.5, RULER - 6);
        g.lineTo(x + 0.5, RULER);
        g.stroke();
        g.fillText(fmtTime(t), x + 3, 13);
      }
      // segment boundaries (edit points)
      g.strokeStyle = C("--cut");
      for (const s of comp.segments) {
        if (s.outStart <= 0) continue;
        const x = X(s.outStart);
        if (x < 0 || x > width) continue;
        g.beginPath();
        g.moveTo(x + 0.5, RULER);
        g.lineTo(x + 0.5, height);
        g.stroke();
      }
      // markers
      g.fillStyle = C("--marker");
      for (const m of comp.markers) {
        const x = X(m.time);
        g.beginPath();
        g.moveTo(x, 4);
        g.lineTo(x + 8, 4);
        g.lineTo(x + 8, 14);
        g.lineTo(x + 4, 18);
        g.lineTo(x, 14);
        g.closePath();
        g.fill();
        g.fillText(m.marker.title, x + 11, 13);
      }

      // layers
      tracks.forEach((track, li) => {
        const y = RULER + li * LANE + 3;
        for (const { layer, start, end } of comp.layers) {
          if (layer.track !== track) continue;
          const x = X(start);
          const w = Math.max(3, (end - start) * pps);
          const col = layerColor(project.layers, layer.id);
          g.fillStyle = col + (layer.id === selectedLayerId ? "ee" : "99");
          roundRect(g, x, y, w, LANE - 6, 4);
          g.fill();
          if (layer.id === selectedLayerId) {
            g.strokeStyle = text;
            g.lineWidth = 1.5;
            roundRect(g, x, y, w, LANE - 6, 4);
            g.stroke();
            g.lineWidth = 1;
          }
          g.fillStyle = "#0b0b0d";
          g.save();
          g.beginPath();
          g.rect(x, y, w, LANE - 6);
          g.clip();
          g.fillText(layerLabel(ctx, layer), x + 5, y + 11);
          g.restore();
        }
      });

      // waveform + words
      const wy = RULER + Math.max(1, tracks.length) * LANE + 4;
      g.fillStyle = C("--panel-2");
      roundRect(g, X(0), wy, comp.duration * pps, WORDS, 6);
      g.fill();
      if (peaks?.data.length) {
        g.fillStyle = C("--wave");
        const mid = wy + WORDS / 2 + 6;
        for (const s of comp.segments) {
          const xa = Math.max(0, X(s.outStart));
          const xb = Math.min(width, X(s.outEnd));
          for (let x = Math.floor(xa); x < xb; x++) {
            const out = (x + sx - 12) / pps;
            const src = s.srcStart + (out - s.outStart);
            const v = (peaks.data[Math.floor(src * peaks.rate)] ?? 0) / 255;
            const h = v * (WORDS - 22);
            g.fillRect(x, mid - h / 2, 1, Math.max(1, h));
          }
        }
      }
      g.save();
      g.beginPath();
      g.rect(0, wy, width, WORDS);
      g.clip();
      g.font = "11px -apple-system, system-ui, sans-serif";
      for (const tk of project.tokens) {
        if (tk.kind !== "word") continue;
        const r = comp.tokenOut.get(tk.id);
        if (!r || r.end < t0 || r.start > t1) continue;
        const x = X(r.start);
        const w = (r.end - r.start) * pps;
        if (w < 14) continue;
        g.fillStyle = C("--chip");
        roundRect(g, x + 1, wy + 4, w - 2, 16, 3);
        g.fill();
        g.fillStyle = text;
        g.save();
        g.beginPath();
        g.rect(x + 1, wy + 4, w - 4, 16);
        g.clip();
        g.fillText(tk.text, x + 4, wy + 16);
        g.restore();
      }
      g.restore();

      // selection
      if (selRangeOut) {
        g.fillStyle = C("--sel");
        g.fillRect(X(selRangeOut[0]), RULER, (selRangeOut[1] - selRangeOut[0]) * pps, height - RULER);
      }

      // playhead
      const px = X(player.time);
      g.strokeStyle = C("--accent");
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px, 0);
      g.lineTo(px, height);
      g.stroke();
      g.lineWidth = 1;
      g.fillStyle = C("--accent");
      g.beginPath();
      g.moveTo(px - 5, 0);
      g.lineTo(px + 5, 0);
      g.lineTo(px, 7);
      g.fill();
    };
    draw();
    // follow the playhead when zoomed in
    const unsub = player.subscribe(() => {
      if (player.playing && zoom) {
        const px = 12 + player.time * pps - sx;
        if (px > width - 40 || px < 0) setScroll(Math.max(0, player.time * pps - 60));
      }
      draw();
    });
    return () => {
      unsub();
    };
  }, [comp, peaks, width, height, pps, sx, player, tracks, selRangeOut, selectedLayerId, project, ctx, zoom]);

  const timeAt = (clientX: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(comp.duration, (clientX - r.left + sx - 12) / pps));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const y = e.clientY - r.top;
    const t = timeAt(e.clientX);
    if (y > RULER && y < RULER + tracks.length * LANE) {
      const track = tracks[Math.floor((y - RULER) / LANE)];
      const hit = comp.layers.find((l) => l.layer.track === track && t >= l.start && t <= l.end);
      if (hit) {
        onSelectLayer(hit.layer.id);
        return;
      }
    }
    player.seek(t);
    const move = (ev: MouseEvent) => player.seek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="timeline">
      <div className="timeline-tools">
        <span className="muted small">Timeline</span>
        <input
          type="range"
          min={0}
          max={400}
          value={zoom === 0 ? 0 : Math.round(Math.sqrt(zoom) * 10)}
          onChange={(e) => {
            const v = Number(e.target.value);
            setZoom(v === 0 ? 0 : (v / 10) ** 2 + fitPps);
          }}
          title="Zoom"
        />
      </div>
      <div
        className="timeline-canvas"
        ref={wrapRef}
        onWheel={(e) => {
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) setScroll((s) => Math.max(0, Math.min(maxScroll, s + (e.deltaX || e.deltaY))));
        }}
      >
        <canvas ref={canvasRef} style={{ width, height }} onMouseDown={onMouseDown} />
      </div>
    </div>
  );
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
