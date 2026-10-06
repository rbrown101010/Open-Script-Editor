import { useEffect, useRef, useState } from "react";
import type { Composition, Layer, LayerStyle } from "../core/types.ts";
import { mediaUrl } from "./api.ts";
import { usePlayer, type EditorApi } from "./Editor.tsx";

interface Props {
  ctx: EditorApi;
  comp: Composition;
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
}

export function Preview({ ctx, comp, selectedLayerId, onSelectLayer }: Props) {
  const { project, player } = ctx;
  usePlayer(player);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageH, setStageH] = useState(360);
  const [drag, setDrag] = useState<{ id: string; style: LayerStyle } | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const t = player.time;
  const active = comp.layers.filter((l) => t >= l.start && t < l.end);
  const src = mediaUrl(project, project.mainAssetId);

  const startDrag = (e: React.MouseEvent, layer: Layer, mode: "move" | "resize") => {
    e.preventDefault();
    e.stopPropagation();
    onSelectLayer(layer.id);
    const stage = stageRef.current!.getBoundingClientRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const s0 = layer.style;
    let cur = s0;
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - x0) / stage.width;
      const dy = (ev.clientY - y0) / stage.height;
      cur =
        mode === "move"
          ? { ...s0, x: s0.x + dx, y: s0.y + dy }
          : { ...s0, w: Math.max(0.05, s0.w + dx), h: Math.max(0.05, s0.h + dy) };
      setDrag({ id: layer.id, style: cur });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDrag(null);
      if (cur !== s0) {
        const r = (n: number) => Math.round(n * 1000) / 1000;
        void ctx.edit([{ type: "updateLayer", id: layer.id, style: { x: r(cur.x), y: r(cur.y), w: r(cur.w), h: r(cur.h) } }]);
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="preview">
      <div
        className="stage"
        ref={stageRef}
        style={{ aspectRatio: `${project.width} / ${project.height}` }}
        onMouseDown={() => onSelectLayer(null)}
        onClick={() => player.toggle()}
      >
        <video
          ref={(v) => {
            if (v && player.video !== v) player.attach(v);
          }}
          src={src}
          className={project.hasVideo ? "main-video" : "main-video audio-only"}
          preload="auto"
          playsInline
        />
        {!project.hasVideo && <div className="audio-card">{project.name}</div>}
        {project.layers
          .filter((l) => l.type === "video")
          .map((l) => {
            const timing = comp.layers.find((x) => x.layer.id === l.id);
            return (
              <LayerVideo
                key={l.id}
                ctx={ctx}
                layer={l}
                start={timing?.start ?? -1}
                end={timing?.end ?? -1}
                style={drag?.id === l.id ? drag.style : l.style}
                selected={l.id === selectedLayerId}
                onMouseDown={(e) => startDrag(e, l, "move")}
              />
            );
          })}
        {active
          .filter(({ layer }) => layer.type !== "video")
          .map(({ layer }) => {
            const style = drag?.id === layer.id ? drag.style : layer.style;
            return (
              <div
                key={layer.id}
                className={`overlay ${layer.id === selectedLayerId ? "selected" : ""}`}
                style={{ ...box(style), zIndex: 2 + layer.track }}
                onMouseDown={(e) => startDrag(e, layer, "move")}
                onClick={(e) => e.stopPropagation()}
              >
                {layer.type === "image" ? (
                  <img src={mediaUrl(project, layer.assetId!)} style={{ objectFit: style.fit }} draggable={false} />
                ) : (
                  <TextLayer layer={layer} style={style} stageH={stageH} />
                )}
                {layer.id === selectedLayerId && <span className="resize" onMouseDown={(e) => startDrag(e, layer, "resize")} />}
              </div>
            );
          })}
        {!player.playing && <div className="play-hint">▶</div>}
      </div>
    </div>
  );
}

function box(s: LayerStyle): React.CSSProperties {
  return {
    left: `${s.x * 100}%`,
    top: `${s.y * 100}%`,
    width: `${s.w * 100}%`,
    height: `${s.h * 100}%`,
    opacity: s.opacity,
  };
}

function TextLayer({ layer, style, stageH }: { layer: Layer; style: LayerStyle; stageH: number }) {
  const fs = (style.fontSize ?? 0.07) * stageH;
  return (
    <div
      className="text-layer"
      style={{
        fontSize: fs,
        color: style.color,
        background: style.background,
        fontWeight: style.fontWeight,
        textAlign: style.align,
        justifyContent: style.align === "left" ? "flex-start" : style.align === "right" ? "flex-end" : "center",
        borderRadius: Math.min(fs * 0.35, 9999),
        padding: `0 ${fs * 0.5}px`,
      }}
    >
      <span>{layer.text}</span>
    </div>
  );
}

/** A B-roll video layer, kept in sync with the main playhead. */
function LayerVideo({
  ctx,
  layer,
  start,
  end,
  style,
  selected,
  onMouseDown,
}: {
  ctx: EditorApi;
  layer: Layer;
  start: number;
  end: number;
  style: LayerStyle;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const { player } = ctx;
  const t = player.time;
  const visible = t >= start && t < end;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = !(layer.volume && layer.volume > 0);
    v.volume = Math.min(1, layer.volume ?? 0);
    if (!visible) {
      if (!v.paused) v.pause();
      return;
    }
    const want = t - start;
    if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
    if (player.playing && v.paused) void v.play().catch(() => {});
    if (!player.playing && !v.paused) v.pause();
  });
  return (
    <div
      className={`overlay ${selected ? "selected" : ""}`}
      style={{ ...box(style), zIndex: 2 + layer.track, display: visible ? undefined : "none" }}
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
    >
      <video ref={ref} src={mediaUrl(ctx.project, layer.assetId!)} style={{ objectFit: style.fit }} preload="auto" playsInline muted />
    </div>
  );
}
