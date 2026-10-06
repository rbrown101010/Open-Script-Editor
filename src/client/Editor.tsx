import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, type ProjectView } from "./api.ts";
import { compose, fmtTime } from "../core/compose.ts";
import { applyOps, type EditOp } from "../core/ops.ts";
import { Player } from "./player.ts";
import { Script, type Selection } from "./Script.tsx";
import { Preview } from "./Preview.tsx";
import { Timeline } from "./Timeline.tsx";
import { Inspector, type InspectorTab } from "./Inspector.tsx";
import { ExportDialog } from "./ExportDialog.tsx";
import { Icon } from "./Icon.tsx";

export interface EditorApi {
  project: ProjectView;
  edit: (ops: EditOp[]) => Promise<void>;
  player: Player;
  toast: (msg: string) => void;
}

export function usePlayer(player: Player) {
  return useSyncExternalStore(
    (fn) => player.subscribe(fn),
    () => player.version,
  );
}

export function Editor({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [layerId, setLayerId] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(true);
  const [tab, setTab] = useState<InspectorTab>("cleanup");
  const [exportOpen, setExportOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const player = useMemo(() => new Player(), []);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const projectRef = useRef<ProjectView | null>(null);
  projectRef.current = project;

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout((toast as any).t);
    (toast as any).t = window.setTimeout(() => setToastMsg(null), 3200);
  }, []);

  useEffect(() => {
    api.get(projectId).then(setProject, (e) => setError(e.message));
  }, [projectId]);

  // Poll while transcription runs.
  const running = project?.transcription.state === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => api.get(projectId).then(setProject).catch(() => {}), 1000);
    return () => clearInterval(t);
  }, [running, projectId]);

  const comp = useMemo(() => (project ? compose(project) : null), [project]);
  useEffect(() => {
    if (comp) player.setComposition(comp);
  }, [comp, player]);
  useEffect(() => () => player.pause(), [player]);

  /** Optimistic edit: apply locally right away, then persist through the server. */
  const edit = useCallback(
    async (ops: EditOp[]) => {
      const cur = projectRef.current;
      if (!cur || !ops.length) return;
      try {
        const local = applyOps(cur, ops);
        setProject({ ...cur, ...local, history: { canUndo: true, canRedo: false } });
      } catch (e) {
        toast((e as Error).message);
        return;
      }
      const run = queue.current.then(() => api.ops(projectId, ops));
      queue.current = run.catch(() => {});
      try {
        setProject(await run);
      } catch (e) {
        toast((e as Error).message);
        setProject(await api.get(projectId));
      }
    },
    [projectId, toast],
  );

  const history = useCallback(
    async (kind: "undo" | "redo") => {
      const run = queue.current.then(() => (kind === "undo" ? api.undo(projectId) : api.redo(projectId)));
      queue.current = run.catch(() => {});
      setProject(await run);
    },
    [projectId],
  );

  // Global shortcuts that don't depend on script focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void history(e.shiftKey ? "redo" : "undo");
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        void history("redo");
      } else if (e.code === "Space" && !mod) {
        e.preventDefault();
        player.toggle();
      } else if (e.shiftKey && e.key.toLowerCase() === "l") {
        player.setRate(Math.min(3, player.rate + 0.25));
      } else if (e.shiftKey && e.key.toLowerCase() === "j") {
        player.setRate(Math.max(0.5, player.rate - 0.25));
      } else if (e.shiftKey && e.key.toLowerCase() === "k") {
        player.setRate(1);
      } else if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setExportOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history, player]);

  if (error) return <div className="center-msg">Couldn't open project: {error} · <a href="#/">Back</a></div>;
  if (!project || !comp) return <div className="center-msg">Loading…</div>;

  const ctx: EditorApi = { project, edit, player, toast };
  const selectLayer = (id: string | null) => {
    setLayerId(id);
    if (id) setTab("layer");
  };

  return (
    <div className="editor">
      <header className="topbar">
        <a className="icon-btn" href="#/" title="All projects">
          <Icon name="back" />
        </a>
        <input
          className="title-input"
          defaultValue={project.name}
          key={project.name}
          onBlur={(e) => e.target.value !== project.name && edit([{ type: "renameProject", name: e.target.value }])}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <div className="topbar-group">
          <button className="icon-btn" disabled={!project.history.canUndo} onClick={() => history("undo")} title="Undo (⌘Z)">
            <Icon name="undo" />
          </button>
          <button className="icon-btn" disabled={!project.history.canRedo} onClick={() => history("redo")} title="Redo (⇧⌘Z)">
            <Icon name="redo" />
          </button>
        </div>
        <div className="spacer" />
        <label className="toggle" title="Show removed words as strikethrough">
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          <span>Show removed</span>
        </label>
        <button className="btn" onClick={() => setTab("cleanup")}>
          <Icon name="sparkle" /> Clean up
        </button>
        <button className="btn primary" onClick={() => setExportOpen(true)}>
          <Icon name="export" /> Export
        </button>
      </header>

      <div className="workspace">
        <main className="script-pane">
          {project.transcription.state !== "done" ? (
            <TranscribeState project={project} onRetry={async () => setProject(await api.retranscribe(project.id))} />
          ) : (
            <Script
              ctx={ctx}
              comp={comp}
              sel={sel}
              setSel={setSel}
              showDeleted={showDeleted}
              selectedLayerId={layerId}
              onSelectLayer={selectLayer}
            />
          )}
        </main>
        <aside className="side-pane">
          <Preview ctx={ctx} comp={comp} selectedLayerId={layerId} onSelectLayer={selectLayer} />
          <Inspector
            ctx={ctx}
            comp={comp}
            tab={tab}
            setTab={setTab}
            layerId={layerId}
            onSelectLayer={selectLayer}
            sel={sel}
            setSel={setSel}
          />
        </aside>
      </div>

      <Transport player={player} />
      <Timeline ctx={ctx} comp={comp} sel={sel} selectedLayerId={layerId} onSelectLayer={selectLayer} />

      {exportOpen && <ExportDialog ctx={ctx} comp={comp} onClose={() => setExportOpen(false)} />}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}

function Transport({ player }: { player: Player }) {
  usePlayer(player);
  return (
    <div className="transport">
      <button className="icon-btn" onClick={() => player.seek(0)} title="Go to start">
        <Icon name="start" />
      </button>
      <button className="play-btn" onClick={() => player.toggle()} title="Play / pause (space)">
        <Icon name={player.playing ? "pause" : "play"} />
      </button>
      <span className="timecode">
        {fmtTime(player.time, true)} <span className="muted">/ {fmtTime(player.duration, true)}</span>
      </span>
      <button className="rate" onClick={() => player.setRate(player.rate >= 2 ? 1 : player.rate + 0.25)} title="Speed (⇧J / ⇧K / ⇧L)">
        {player.rate}×
      </button>
    </div>
  );
}

function TranscribeState({ project, onRetry }: { project: ProjectView; onRetry: () => void }) {
  const t = project.transcription;
  if (t.state === "error")
    return (
      <div className="transcribing">
        <h2>Transcription failed</h2>
        <p className="muted">{t.message}</p>
        <button className="btn primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  return (
    <div className="transcribing">
      <h2>{t.message ?? "Transcribing"}…</h2>
      <div className="progress">
        <div style={{ width: `${Math.round(t.progress * 100)}%` }} />
      </div>
      <p className="muted">Running Whisper locally on this Mac. Nothing leaves your computer.</p>
    </div>
  );
}
