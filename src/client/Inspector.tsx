import { useMemo, useState } from "react";
import type { Composition, Layer, LayerStyle } from "../core/types.ts";
import { chaptersText, fmtTime } from "../core/compose.ts";
import { detectFillers, FILLER_WORDS } from "../core/fillers.ts";
import type { EditorApi } from "./Editor.tsx";
import type { Selection } from "./Script.tsx";
import { layerColor, layerLabel } from "./layers.ts";
import { Icon } from "./Icon.tsx";

export type InspectorTab = "cleanup" | "chapters" | "layer";

interface Props {
  ctx: EditorApi;
  comp: Composition;
  tab: InspectorTab;
  setTab: (t: InspectorTab) => void;
  layerId: string | null;
  onSelectLayer: (id: string | null) => void;
  sel: Selection | null;
  setSel: (s: Selection | null) => void;
}

export function Inspector(props: Props) {
  const { tab, setTab } = props;
  return (
    <div className="inspector">
      <div className="tabs">
        {(["cleanup", "chapters", "layer"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "cleanup" ? "Clean up" : t === "chapters" ? "Chapters" : "Layers"}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === "cleanup" && <Cleanup {...props} />}
        {tab === "chapters" && <Chapters {...props} />}
        {tab === "layer" && <Layers {...props} />}
      </div>
    </div>
  );
}

function Cleanup({ ctx, comp, setSel }: Props) {
  const { project, edit, player } = ctx;
  const tokens = project.tokens;
  const fillers = useMemo(() => detectFillers(tokens), [tokens]);
  const instances = useMemo(() => {
    const list: { i: number; key: string }[] = [];
    let skipNext = false;
    tokens.forEach((t, i) => {
      const k = fillers.get(t.id);
      if (!k) return;
      if (skipNext) {
        skipNext = false;
        return;
      }
      if (k.includes(" ")) skipNext = true;
      list.push({ i, key: k });
    });
    return list;
  }, [tokens, fillers]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const x of instances) c[x.key] = (c[x.key] ?? 0) + 1;
    return c;
  }, [instances]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [longer, setLonger] = useState(0.75);
  const [trimTo, setTrimTo] = useState(0.3);
  const gaps = tokens.filter((t) => t.kind === "gap" && !t.deleted && t.end - t.start > longer);
  const trimmed = tokens.filter((t) => t.kind === "gap" && t.trimTo != null).length;
  const chosen = Object.keys(counts).filter((k) => !off.has(k));
  const removeCount = instances.filter((x) => !off.has(x.key)).length;

  const context = (i: number) => {
    const words = (from: number, to: number) =>
      tokens.slice(Math.max(0, from), Math.max(0, to)).filter((t) => t.kind === "word" && !t.deleted).map((t) => t.text);
    return { before: words(i - 4, i).slice(-3).join(" "), word: tokens[i].text, after: words(i + 1, i + 6).slice(0, 3).join(" ") };
  };

  return (
    <div className="cleanup">
      <div className="stat-row">
        <div>
          <div className="stat">{fmtTime(project.duration)}</div>
          <div className="muted small">Original</div>
        </div>
        <div>
          <div className="stat accent">{fmtTime(comp.duration)}</div>
          <div className="muted small">Edited</div>
        </div>
        <div>
          <div className="stat">{comp.segments.length > 0 ? comp.segments.length - 1 : 0}</div>
          <div className="muted small">Cuts</div>
        </div>
      </div>

      <section>
        <h4>
          <Icon name="sparkle" size={13} /> Filler words
        </h4>
        {instances.length === 0 ? (
          <p className="muted small">No filler words left.</p>
        ) : (
          <>
            <div className="chips">
              {Object.entries(counts).map(([k, n]) => (
                <label key={k} className={`chip ${off.has(k) ? "" : "on"}`}>
                  <input
                    type="checkbox"
                    checked={!off.has(k)}
                    onChange={() => {
                      const next = new Set(off);
                      if (next.has(k)) next.delete(k);
                      else next.add(k);
                      setOff(next);
                    }}
                  />
                  {k === "repeat" ? "repeated words" : k} <b>{n}</b>
                </label>
              ))}
            </div>
            <button
              className="btn primary block"
              disabled={!removeCount}
              onClick={() =>
                edit([
                  {
                    type: "removeFillers",
                    words: chosen.filter((k) => k !== "repeat"),
                    includeRepeats: chosen.includes("repeat"),
                  },
                ]).then(() => ctx.toast(`Removed ${removeCount} filler words`))
              }
            >
              Remove {removeCount} filler word{removeCount === 1 ? "" : "s"}
            </button>
            <ul className="instances">
              {instances.slice(0, 200).map(({ i, key }) => {
                const c = context(i);
                return (
                  <li
                    key={tokens[i].id}
                    onClick={() => {
                      const end = key.includes(" ") ? i + 1 : i;
                      setSel({ anchor: i, focus: end });
                      const r = comp.tokenOut.get(tokens[i].id);
                      if (r) player.seek(Math.max(0, r.start - 1));
                      document.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
                    }}
                  >
                    <span className="muted">…{c.before} </span>
                    <mark>{key.includes(" ") ? key : c.word}</mark>
                    <span className="muted"> {c.after}…</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="muted tiny">Detects {FILLER_WORDS.join(", ")} and repeated words.</p>
      </section>

      <section>
        <h4>
          <Icon name="gap" size={13} /> Shorten word gaps
        </h4>
        <div className="gap-form">
          <label>
            Pauses longer than
            <input type="number" step={0.05} min={0.1} value={longer} onChange={(e) => setLonger(Number(e.target.value))} />s
          </label>
          <label>
            shorten to
            <input type="number" step={0.05} min={0} value={trimTo} onChange={(e) => setTrimTo(Number(e.target.value))} />s
          </label>
        </div>
        <button className="btn block" disabled={!gaps.length} onClick={() => edit([{ type: "shortenGaps", longerThan: longer, trimTo }])}>
          Shorten {gaps.length} pause{gaps.length === 1 ? "" : "s"}
        </button>
        {trimmed > 0 && (
          <button
            className="btn ghost block"
            onClick={() =>
              edit([{ type: "setGapTrim", ids: tokens.filter((t) => t.trimTo != null).map((t) => t.id), trimTo: null }])
            }
          >
            Reset {trimmed} shortened pause{trimmed === 1 ? "" : "s"}
          </button>
        )}
      </section>
    </div>
  );
}

function Chapters({ ctx, comp }: Props) {
  const { project, player, edit } = ctx;
  const addAtPlayhead = () => {
    const t = player.time;
    const tok = project.tokens.find((x) => {
      const r = comp.tokenOut.get(x.id);
      return r && x.kind === "word" && r.end > t;
    });
    if (tok) void edit([{ type: "addMarker", tokenId: tok.id, title: `Chapter ${project.markers.length + 1}` }]);
  };
  const text = chaptersText(comp);
  return (
    <div className="chapters">
      <p className="muted small">
        Markers split the script into chapters. Press <kbd>#</kbd> in the script or add one at the playhead.
      </p>
      <button className="btn block" onClick={addAtPlayhead}>
        <Icon name="marker" /> Add marker at {fmtTime(player.time)}
      </button>
      <ul className="chapter-list">
        {comp.markers.map(({ marker, time }) => (
          <li key={marker.id} onClick={() => player.seek(time)}>
            <span className="time">{fmtTime(time)}</span>
            <span className="title">{marker.title}</span>
            <button
              className="x"
              onClick={(e) => {
                e.stopPropagation();
                void edit([{ type: "removeMarker", id: marker.id }]);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {comp.markers.length > 0 && (
        <>
          <pre className="yt">{text}</pre>
          <button className="btn block" onClick={() => navigator.clipboard.writeText(text).then(() => ctx.toast("Copied chapters for YouTube"))}>
            Copy chapters for YouTube
          </button>
        </>
      )}
    </div>
  );
}

const PRESETS: Record<string, Partial<LayerStyle>> = {
  Full: { x: 0, y: 0, w: 1, h: 1 },
  Center: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
  "Lower third": { x: 0.08, y: 0.72, w: 0.84, h: 0.16 },
  "Top right": { x: 0.66, y: 0.04, w: 0.3, h: 0.3 },
  "Bottom right": { x: 0.66, y: 0.66, w: 0.3, h: 0.3 },
  "Left half": { x: 0, y: 0, w: 0.5, h: 1 },
};

function Layers({ ctx, comp, layerId, onSelectLayer }: Props) {
  const { project, edit, player } = ctx;
  const layer = project.layers.find((l) => l.id === layerId);
  if (!layer) {
    return (
      <div className="layers">
        <p className="muted small">
          Select words in the script, then choose <b>Media</b> or <b>Title</b>, or drop an image or video onto the selection. The layer stays
          attached to those words through every edit.
        </p>
        <ul className="layer-list">
          {comp.layers.map(({ layer: l, start, end }) => (
            <li key={l.id} onClick={() => onSelectLayer(l.id)}>
              <span className="swatch" style={{ background: layerColor(project.layers, l.id) }} />
              <span className="title">{layerLabel(ctx, l)}</span>
              <span className="time">
                {fmtTime(start)}–{fmtTime(end)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const timing = comp.layers.find((l) => l.layer.id === layer.id);
  const set = (style: Partial<LayerStyle>, extra: Partial<Pick<Layer, "track" | "volume">> = {}) =>
    edit([{ type: "updateLayer", id: layer.id, style, ...extra }]);
  const s = layer.style;
  return (
    <div className="layers">
      <div className="layer-head">
        <button className="icon-btn" onClick={() => onSelectLayer(null)} title="All layers">
          <Icon name="back" />
        </button>
        <span className="swatch" style={{ background: layerColor(project.layers, layer.id) }} />
        <b>{layerLabel(ctx, layer)}</b>
      </div>
      <p className="muted small">
        {timing ? (
          <a onClick={() => player.seek(timing.start)}>
            Visible {fmtTime(timing.start, true)}–{fmtTime(timing.end, true)}
          </a>
        ) : (
          "Hidden: all of its words are removed."
        )}
      </p>
      {layer.type === "text" && (
        <label className="field">
          Text
          <textarea
            defaultValue={layer.text}
            key={layer.id + layer.text}
            rows={2}
            onBlur={(e) => e.target.value !== layer.text && edit([{ type: "updateLayer", id: layer.id, text: e.target.value }])}
          />
        </label>
      )}
      <div className="field">
        Position
        <div className="presets">
          {Object.entries(PRESETS).map(([name, p]) => (
            <button key={name} onClick={() => set(p)}>
              {name}
            </button>
          ))}
        </div>
      </div>
      {layer.type !== "text" && (
        <div className="field row">
          Fit
          <select value={s.fit} onChange={(e) => set({ fit: e.target.value as LayerStyle["fit"] })}>
            <option value="cover">Fill (crop)</option>
            <option value="contain">Fit (letterbox)</option>
          </select>
        </div>
      )}
      <label className="field row">
        Opacity
        <input type="range" min={0} max={1} step={0.05} value={s.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} />
      </label>
      {layer.type === "text" && (
        <>
          <label className="field row">
            Size
            <input type="range" min={0.03} max={0.2} step={0.005} value={s.fontSize ?? 0.07} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
          </label>
          <div className="field row">
            Color
            <input type="color" value={s.color ?? "#ffffff"} onChange={(e) => set({ color: e.target.value })} />
            Background
            <select value={s.background ?? "transparent"} onChange={(e) => set({ background: e.target.value })}>
              <option value="rgba(0,0,0,0.55)">Dark</option>
              <option value="rgba(255,255,255,0.9)">Light</option>
              <option value="#4f8cff">Blue</option>
              <option value="transparent">None</option>
            </select>
          </div>
          <div className="field row">
            Align
            <select value={s.align ?? "center"} onChange={(e) => set({ align: e.target.value as LayerStyle["align"] })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </>
      )}
      {layer.type === "video" && (
        <label className="field row">
          Volume
          <input type="range" min={0} max={1} step={0.05} value={layer.volume ?? 0} onChange={(e) => set({}, { volume: Number(e.target.value) })} />
        </label>
      )}
      <div className="field row">
        Stack
        <button className="btn small" onClick={() => set({}, { track: layer.track + 1 })}>
          Bring forward
        </button>
        <button className="btn small" onClick={() => set({}, { track: Math.max(0, layer.track - 1) })}>
          Send back
        </button>
      </div>
      <button
        className="btn danger block"
        onClick={() => {
          onSelectLayer(null);
          void edit([{ type: "removeLayer", id: layer.id }]);
        }}
      >
        Remove layer
      </button>
    </div>
  );
}
