import { useEffect, useState } from "react";
import type { Composition } from "../core/types.ts";
import { fmtTime } from "../core/compose.ts";
import { api } from "./api.ts";
import type { EditorApi } from "./Editor.tsx";

const FORMATS = [
  { id: "mp4", label: "Video", desc: "MP4 with layers burned in" },
  { id: "mp3", label: "Audio", desc: "MP3, 192 kbps" },
  { id: "wav", label: "Audio (WAV)", desc: "Uncompressed" },
  { id: "srt", label: "Subtitles", desc: "SRT timed to the edit" },
  { id: "md", label: "Transcript", desc: "Markdown with chapters" },
  { id: "chapters", label: "Chapters", desc: "YouTube chapter list" },
  { id: "edl", label: "Edit list", desc: "JSON segments for other tools" },
];

export function ExportDialog({ ctx, comp, onClose }: { ctx: EditorApi; comp: Composition; onClose: () => void }) {
  const [format, setFormat] = useState("mp4");
  const [height, setHeight] = useState(0);
  const [job, setJob] = useState<{ id: string; state: string; progress: number; url?: string; path?: string; message?: string } | null>(null);

  useEffect(() => {
    if (!job || job.state !== "running") return;
    const t = setInterval(async () => {
      const j = await api.job(job.id);
      setJob({ ...j, id: job.id });
    }, 500);
    return () => clearInterval(t);
  }, [job]);

  const start = async () => {
    const { id } = await api.export(ctx.project.id, format, height || undefined);
    setJob({ id, state: "running", progress: 0 });
  };

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Export</h3>
        <p className="muted small">
          {fmtTime(comp.duration)} edited from {fmtTime(ctx.project.duration)} · {comp.layers.length} layer
          {comp.layers.length === 1 ? "" : "s"} · {comp.markers.length} chapter{comp.markers.length === 1 ? "" : "s"}
        </p>
        <div className="format-grid">
          {FORMATS.map((f) => (
            <button key={f.id} className={format === f.id ? "on" : ""} onClick={() => setFormat(f.id)} disabled={job?.state === "running"}>
              <b>{f.label}</b>
              <span className="muted small">{f.desc}</span>
            </button>
          ))}
        </div>
        {format === "mp4" && ctx.project.hasVideo && (
          <label className="field row">
            Resolution
            <select value={height} onChange={(e) => setHeight(Number(e.target.value))}>
              <option value={0}>Original ({ctx.project.height}p)</option>
              {[2160, 1080, 720, 480].filter((h) => h < ctx.project.height).map((h) => (
                <option key={h} value={h}>
                  {h}p
                </option>
              ))}
            </select>
          </label>
        )}
        {job && (
          <div className="job">
            {job.state === "running" && (
              <>
                <div className="progress">
                  <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
                </div>
                <span className="muted small">Rendering… {Math.round(job.progress * 100)}%</span>
              </>
            )}
            {job.state === "done" && (
              <div className="done">
                <a className="btn primary" href={job.url} download>
                  Download
                </a>
                <span className="muted tiny path" title={job.path}>
                  Saved to {job.path}
                </span>
              </div>
            )}
            {job.state === "error" && <p className="error">{job.message}</p>}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" onClick={start} disabled={job?.state === "running"}>
            {job?.state === "done" ? "Export again" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
