import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Composition, Layer, Token } from "../core/types.ts";
import { detectFillers } from "../core/fillers.ts";
import type { EditOp } from "../core/ops.ts";
import type { EditorApi } from "./Editor.tsx";
import { addMediaLayer, layerColor, layerLabel, pickFile } from "./layers.ts";
import { Icon } from "./Icon.tsx";

export interface Selection {
  anchor: number;
  focus: number;
  /** Collapsed: a cursor placed before token `anchor`, nothing selected. */
  caret?: boolean;
}

export const selRange = (s: Selection): [number, number] =>
  s.anchor <= s.focus ? [s.anchor, s.focus] : [s.focus, s.anchor];

interface Props {
  ctx: EditorApi;
  comp: Composition;
  sel: Selection | null;
  setSel: (s: Selection | null) => void;
  showDeleted: boolean;
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
}

export function Script({ ctx, comp, sel, setSel, showDeleted, selectedLayerId, onSelectLayer }: Props) {
  const { project, player, edit } = ctx;
  const tokens = project.tokens;
  const rootRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const clipboard = useRef<{ fromId: string; toId: string } | null>(null);
  const [cutRange, setCutRange] = useState<[string, string] | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;

  const fillers = useMemo(() => detectFillers(tokens), [tokens]);

  // token index -> layers covering it
  const layerCover = useMemo(() => {
    const idx = new Map(tokens.map((t, i) => [t.id, i]));
    const cover: Layer[][] = tokens.map(() => []);
    const starts = new Map<number, Layer[]>();
    for (const l of project.layers) {
      const a = idx.get(l.startTokenId);
      const b = idx.get(l.endTokenId);
      if (a == null || b == null) continue;
      const [x, y] = a <= b ? [a, b] : [b, a];
      for (let i = x; i <= y; i++) cover[i].push(l);
      starts.set(x, (starts.get(x) ?? []).concat(l));
    }
    return { cover, starts };
  }, [tokens, project.layers]);

  const markersAt = useMemo(() => new Map(project.markers.map((m) => [m.tokenId, m])), [project.markers]);
  const speakerName = useMemo(() => new Map(project.speakers.map((s) => [s.id, s.name])), [project.speakers]);

  const cutIdx = useMemo(() => {
    if (!cutRange) return null;
    const a = tokens.findIndex((t) => t.id === cutRange[0]);
    const b = tokens.findIndex((t) => t.id === cutRange[1]);
    return a < 0 || b < 0 ? null : ([Math.min(a, b), Math.max(a, b)] as const);
  }, [cutRange, tokens]);

  // ---- current-word highlight without re-rendering the whole script ----
  const kept = useMemo(() => tokens.filter((t) => comp.tokenOut.has(t.id)), [tokens, comp]);
  useEffect(() => {
    let active: string | null = null;
    let lastScroll = 0;
    const update = () => {
      const t = player.time;
      let lo = 0;
      let hi = kept.length - 1;
      let found: Token | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const r = comp.tokenOut.get(kept[mid].id)!;
        if (t < r.start) hi = mid - 1;
        else if (t >= r.end) lo = mid + 1;
        else {
          found = kept[mid];
          break;
        }
      }
      const id = found?.id ?? null;
      if (id === active) return;
      const root = rootRef.current;
      if (!root) return;
      if (active) root.querySelector(`[data-id="${active}"]`)?.classList.remove("active");
      active = id;
      if (!id) return;
      const el = root.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
      el?.classList.add("active");
      if (player.playing && el && Date.now() - lastScroll > 400) {
        const pane = root.parentElement!;
        const r = el.getBoundingClientRect();
        const pr = pane.getBoundingClientRect();
        if (r.top < pr.top + 60 || r.bottom > pr.bottom - 60) {
          lastScroll = Date.now();
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }
    };
    update();
    return player.subscribe(update);
  }, [player, kept, comp]);

  // ---- selection toolbar position ----
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !sel || sel.caret) return setToolbarPos(null);
    const [a, b] = selRange(sel);
    const first = root.querySelector(`[data-i="${a}"]`) as HTMLElement | null;
    const last = root.querySelector(`[data-i="${b}"]`) as HTMLElement | null;
    const el = first ?? last;
    if (!el) return setToolbarPos(null);
    const rr = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setToolbarPos({ x: Math.max(0, r.left - rr.left), y: r.top - rr.top });
  }, [sel, tokens, showDeleted]);

  const ids = (s: Selection) => {
    const [a, b] = selRange(s);
    return { fromId: tokens[a].id, toId: tokens[b].id, a, b };
  };

  const seekToToken = (i: number) => {
    for (let j = i; j < tokens.length; j++) {
      const r = comp.tokenOut.get(tokens[j].id);
      if (r) return player.seek(r.start);
    }
  };

  // ---- actions ----
  const del = (s: Selection) => {
    if (s.caret) {
      // Backspace with a cursor: join paragraphs at a paragraph start, else delete previous token.
      const t = tokens[s.anchor];
      if (t?.para) return edit([{ type: "joinParagraph", tokenId: t.id }]);
      let j = s.anchor - 1;
      while (j >= 0 && tokens[j].deleted) j--;
      if (j < 0) return;
      setSel({ anchor: j, focus: j, caret: true });
      return edit([{ type: "deleteTokens", ids: [tokens[j].id] }]);
    }
    const { fromId, toId, a, b } = ids(s);
    const allDeleted = tokens.slice(a, b + 1).every((t) => t.deleted);
    if (allDeleted) return;
    setSel({ anchor: b + 1 < tokens.length ? b + 1 : b, focus: b + 1 < tokens.length ? b + 1 : b, caret: true });
    return edit([{ type: "deleteRange", fromId, toId }]);
  };

  const restore = (s: Selection) => {
    const { fromId, toId } = ids(s);
    return edit([{ type: "restoreRange", fromId, toId }]);
  };

  const addMarker = (s: Selection) => {
    const t = tokens[selRange(s)[0]];
    if (!t) return;
    const id = "mk_" + Math.random().toString(36).slice(2, 10);
    void edit([{ type: "addMarker", id, tokenId: t.id, title: "New chapter" }]).then(() => {
      setTimeout(() => (rootRef.current?.querySelector(`[data-marker="${id}"] input`) as HTMLInputElement | null)?.select(), 30);
    });
  };

  const addTitle = (s: Selection) => {
    const { fromId, toId, a, b } = ids(s);
    const text = tokens
      .slice(a, b + 1)
      .filter((t) => t.kind === "word" && !t.deleted)
      .map((t) => t.text)
      .join(" ")
      .slice(0, 80);
    const id = "ly_" + Math.random().toString(36).slice(2, 10);
    void edit([{ type: "addLayer", id, layerType: "text", fromId, toId, text: text || "Title" }]).then(() => onSelectLayer(id));
  };

  const addMedia = async (s: Selection) => {
    const file = await pickFile("image/*,video/*");
    if (!file) return;
    const { fromId, toId } = ids(s);
    const id = await addMediaLayer(ctx, file, fromId, toId).catch((e) => (ctx.toast(e.message), null));
    if (id) onSelectLayer(id);
  };

  const gapOps = (s: Selection, trimTo: number | null): EditOp[] => {
    const [a, b] = selRange(s);
    const gapIds = tokens.slice(a, b + 1).filter((t) => t.kind === "gap").map((t) => t.id);
    return gapIds.length ? [{ type: "setGapTrim", ids: gapIds, trimTo }] : [];
  };

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true]")) return;
      const s = selRef.current;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;
      if (key === "Escape") return setSel(null);
      if (mod && key.toLowerCase() === "a") {
        e.preventDefault();
        return setSel({ anchor: 0, focus: tokens.length - 1 });
      }
      if (!s) return;
      if ((key === "Backspace" || key === "Delete") && mod && e.shiftKey) {
        e.preventDefault();
        return void restore(s);
      }
      if (key === "Backspace" || key === "Delete") {
        e.preventDefault();
        return void del(s);
      }
      if (key === "ArrowLeft" || key === "ArrowRight") {
        e.preventDefault();
        const dir = key === "ArrowLeft" ? -1 : 1;
        let next = (s.caret ? s.anchor : s.focus) + dir;
        if (!showDeleted) while (tokens[next]?.deleted) next += dir;
        next = Math.max(0, Math.min(tokens.length - 1, next));
        if (e.shiftKey) {
          const clamp = (n: number) => Math.max(0, Math.min(tokens.length - 1, n));
          const anchor = s.caret && dir < 0 ? s.anchor - 1 : s.anchor;
          const focus = s.caret ? anchor : s.focus + dir;
          setSel({ anchor: clamp(anchor), focus: clamp(focus) });
        } else {
          setSel({ anchor: next, focus: next, caret: true });
          if (!player.playing) seekToToken(next);
        }
        return;
      }
      if (key === "Enter") {
        e.preventDefault();
        const i = selRange(s)[0];
        if (i > 0) void edit([{ type: "splitParagraph", tokenId: tokens[i].id }]);
        return;
      }
      if (mod && key.toLowerCase() === "x" && !s.caret) {
        e.preventDefault();
        const { fromId, toId } = ids(s);
        clipboard.current = { fromId, toId };
        setCutRange([fromId, toId]);
        ctx.toast("Cut. Click where it should go and press ⌘V.");
        return;
      }
      if (mod && key.toLowerCase() === "v" && clipboard.current) {
        e.preventDefault();
        const before = tokens[selRange(s)[0]]?.id ?? null;
        const clip = clipboard.current;
        clipboard.current = null;
        setCutRange(null);
        void edit([{ type: "moveRange", ...clip, beforeId: before }]);
        return;
      }
      if (mod && key.toLowerCase() === "c" && !s.caret) {
        const [a, b] = selRange(s);
        void navigator.clipboard?.writeText(
          tokens.slice(a, b + 1).filter((t) => t.kind === "word" && !t.deleted).map((t) => t.text).join(" "),
        );
        return;
      }
      if (!mod && (key === "#" || (e.shiftKey && e.code === "Digit3"))) {
        e.preventDefault();
        return addMarker(s);
      }
      if (!mod && key.toLowerCase() === "c" && !s.caret) {
        const t = tokens[selRange(s)[0]];
        if (t?.kind === "word") {
          e.preventDefault();
          setCorrecting(t.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- mouse ----
  const idxFrom = (el: EventTarget | null): number | null => {
    const n = (el as HTMLElement | null)?.closest?.("[data-i]") as HTMLElement | null;
    return n ? Number(n.dataset.i) : null;
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".sel-toolbar, .marker, .layer-chip, input")) return;
    const i = idxFrom(e.target);
    if (i == null) {
      if (e.target === rootRef.current) setSel(null);
      return;
    }
    e.preventDefault();
    if (e.shiftKey && sel) {
      setSel({ anchor: sel.anchor, focus: i });
      return;
    }
    dragging.current = true;
    moved.current = false;
    setSel({ anchor: i, focus: i, caret: true });
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current || !sel) return;
    const i = idxFrom(e.target);
    if (i == null) return;
    if (i !== sel.focus || (sel.caret && i !== sel.anchor)) {
      moved.current = true;
      setSel({ anchor: sel.anchor, focus: i });
    } else if (sel.caret && moved.current === false && e.buttons === 1 && Math.abs(e.movementX) > 2) {
      moved.current = true;
      setSel({ anchor: sel.anchor, focus: i });
    }
  };
  useEffect(() => {
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      const s = selRef.current;
      if (s && s.caret && !moved.current) seekToToken(s.anchor);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  });

  const onDoubleClick = (e: React.MouseEvent) => {
    const i = idxFrom(e.target);
    if (i == null || tokens[i].kind !== "word") return;
    setSel({ anchor: i, focus: i });
    setCorrecting(tokens[i].id);
  };

  const onDrop = async (e: React.DragEvent) => {
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    e.preventDefault();
    let a: number;
    let b: number;
    if (sel && !sel.caret) [a, b] = selRange(sel);
    else {
      const i = idxFrom(e.target);
      if (i == null) return ctx.toast("Select some words, then drop media onto them.");
      a = i;
      b = i;
      while (b + 1 < tokens.length && !tokens[b + 1].para) b++;
    }
    const id = await addMediaLayer(ctx, file, tokens[a].id, tokens[b].id).catch((err) => (ctx.toast(err.message), null));
    if (id) onSelectLayer(id);
  };

  // ---- render ----
  const [sa, sb] = sel ? selRange(sel) : [-1, -2];
  const paragraphs: number[][] = [];
  tokens.forEach((t, i) => {
    if (t.para || !paragraphs.length) paragraphs.push([]);
    paragraphs[paragraphs.length - 1].push(i);
  });
  let speaker = tokens[0]?.speaker ?? "s1";

  const selTokens = sel && !sel.caret ? tokens.slice(sa, sb + 1) : [];
  const selHasDeleted = selTokens.some((t) => t.deleted);
  const selHasKept = selTokens.some((t) => !t.deleted);
  const selHasGap = selTokens.some((t) => t.kind === "gap");

  return (
    <div
      className={`script ${showDeleted ? "" : "hide-deleted"}`}
      ref={rootRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={onDrop}
    >
      {paragraphs.map((para, pi) => {
        const first = tokens[para[0]];
        if (first.speaker) speaker = first.speaker;
        const visible = showDeleted || para.some((i) => !tokens[i].deleted);
        return (
          <Fragment key={first.id}>
            {para.map((i) =>
              markersAt.has(tokens[i].id) && i === para[0] ? (
                <MarkerRow key={"m" + i} marker={markersAt.get(tokens[i].id)!} edit={edit} />
              ) : null,
            )}
            {visible && (
              <div className="para">
                <div className="speaker">{speakerName.get(speaker) ?? "Speaker"}</div>
                <p>
                  {para.map((i) => {
                    const t = tokens[i];
                    const mk = i !== para[0] ? markersAt.get(t.id) : undefined;
                    const chips = layerCover.starts.get(i);
                    const prevDeleted = i > 0 && tokens[i - 1].deleted && i !== para[0];
                    if (t.deleted && !showDeleted) {
                      return prevDeleted ? null : (
                        <span key={t.id} data-i={i} data-id={t.id} className={`cutmark ${i >= sa && i <= sb ? "sel" : ""}`} title="Removed media (select and ⇧⌘⌫ to restore)">
                          ¦
                        </span>
                      );
                    }
                    return (
                      <Fragment key={t.id}>
                        {mk && <MarkerRow inline marker={mk} edit={edit} />}
                        {chips?.map((l) => (
                          <span
                            key={l.id}
                            className={`layer-chip ${l.id === selectedLayerId ? "on" : ""}`}
                            style={{ "--lc": layerColor(project.layers, l.id) } as React.CSSProperties}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              onSelectLayer(l.id);
                            }}
                            title="Layer: click to edit"
                          >
                            <Icon name={l.type === "text" ? "text" : l.type === "video" ? "film" : "image"} size={11} />
                            {layerLabel(ctx, l).slice(0, 24)}
                          </span>
                        ))}
                        <TokenView
                          t={t}
                          i={i}
                          selected={i >= sa && i <= sb && !(sel?.caret ?? false)}
                          caret={!!sel?.caret && sel.anchor === i}
                          filler={fillers.get(t.id)}
                          layers={layerCover.cover[i]}
                          layerColors={project.layers}
                          cut={!!cutIdx && i >= cutIdx[0] && i <= cutIdx[1]}
                          correcting={correcting === t.id}
                          onCorrect={(text) => {
                            setCorrecting(null);
                            if (text != null && text.trim() && text.trim() !== t.text) void edit([{ type: "correctText", id: t.id, text }]);
                          }}
                        />
                      </Fragment>
                    );
                  })}
                </p>
              </div>
            )}
            {pi === paragraphs.length - 1 && <div style={{ height: 120 }} />}
          </Fragment>
        );
      })}

      {toolbarPos && sel && !sel.caret && (
        <div
          className="sel-toolbar"
          ref={(el) => {
            if (!el || !rootRef.current) return;
            const max = rootRef.current.clientWidth - el.offsetWidth - 8;
            el.style.left = Math.max(8, Math.min(toolbarPos.x, max)) + "px";
          }}
          style={{ left: toolbarPos.x, top: toolbarPos.y - 44 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {selHasKept && (
            <button onClick={() => del(sel)} title="Remove (⌫)">
              <Icon name="strike" /> Remove
            </button>
          )}
          {selHasDeleted && (
            <button onClick={() => restore(sel)} title="Restore (⇧⌘⌫)">
              <Icon name="restore" /> Restore
            </button>
          )}
          {selHasGap && (
            <>
              <button onClick={() => edit(gapOps(sel, 0.3))} title="Shorten pause to 0.3s">
                <Icon name="gap" /> Shorten
              </button>
              <button onClick={() => edit(gapOps(sel, null))} title="Restore full pause">
                Full pause
              </button>
            </>
          )}
          <span className="sep" />
          <button onClick={() => addMedia(sel)} title="Attach an image or video to these words">
            <Icon name="image" /> Media
          </button>
          <button onClick={() => addTitle(sel)} title="Add a title over these words">
            <Icon name="text" /> Title
          </button>
          <button onClick={() => addMarker(sel)} title="Add a marker / chapter (#)">
            <Icon name="marker" /> Marker
          </button>
          {selTokens.length === 1 && selTokens[0].kind === "word" && (
            <button onClick={() => setCorrecting(selTokens[0].id)} title="Correct the text without changing media (C)">
              <Icon name="pencil" /> Correct
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const TokenView = memo(function TokenView({
  t,
  i,
  selected,
  caret,
  filler,
  layers,
  layerColors,
  cut,
  correcting,
  onCorrect,
}: {
  t: Token;
  i: number;
  selected: boolean;
  caret: boolean;
  filler?: string;
  layers: Layer[];
  layerColors: Layer[];
  cut: boolean;
  correcting: boolean;
  onCorrect: (text: string | null) => void;
}) {
  const cls = [
    t.kind,
    t.deleted ? "deleted" : "",
    selected ? "sel" : "",
    caret ? "caret" : "",
    filler ? "filler" : "",
    cut ? "cut" : "",
    layers.length ? "layered" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style = layers.length
    ? ({
        "--lc": layerColor(layerColors, layers[layers.length - 1].id),
      } as React.CSSProperties)
    : undefined;
  if (correcting) {
    return (
      <input
        className="correct-input"
        autoFocus
        defaultValue={t.text}
        size={Math.max(3, t.text.length + 1)}
        onBlur={(e) => onCorrect(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") onCorrect(null);
          e.stopPropagation();
        }}
      />
    );
  }
  if (t.kind === "gap") {
    const dur = t.end - t.start;
    const kept = t.trimTo != null ? Math.min(dur, t.trimTo) : dur;
    return (
      <span data-i={i} data-id={t.id} className={cls} style={style} title={`Pause ${dur.toFixed(2)}s${t.trimTo != null ? ` → ${kept.toFixed(2)}s` : ""}`}>
        {t.trimTo != null ? <>/{kept.toFixed(1)}s</> : dur >= 0.6 ? <>/ {dur.toFixed(1)}s</> : "/"}
      </span>
    );
  }
  return (
    <span data-i={i} data-id={t.id} className={cls} style={style} title={filler ? `Filler: ${filler}` : undefined}>
      {t.text}
    </span>
  );
});

function MarkerRow({
  marker,
  edit,
  inline,
}: {
  marker: { id: string; title: string };
  edit: EditorApi["edit"];
  inline?: boolean;
}) {
  return (
    <span className={`marker ${inline ? "inline" : ""}`} data-marker={marker.id}>
      <Icon name="marker" size={13} />
      <input
        defaultValue={marker.title}
        key={marker.title}
        onBlur={(e) => e.target.value !== marker.title && edit([{ type: "updateMarker", id: marker.id, title: e.target.value }])}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />
      <button className="x" title="Remove marker" onClick={() => edit([{ type: "removeMarker", id: marker.id }])}>
        ×
      </button>
    </span>
  );
}
