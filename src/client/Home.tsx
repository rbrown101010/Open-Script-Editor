import { useEffect, useState } from "react";
import { api, type ProjectSummary } from "./api.ts";
import { fmtTime } from "../core/compose.ts";
import { Icon } from "./Icon.tsx";

export function Home() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    api.list().then(setProjects, (e) => setError(e.message));
  }, []);

  const importFile = async (file: File) => {
    setError(null);
    setUpload({ name: file.name, progress: 0 });
    try {
      const p = await api.upload(file, (progress) => setUpload({ name: file.name, progress }));
      location.hash = `#/p/${p.id}`;
    } catch (e) {
      setError((e as Error).message);
      setUpload(null);
    }
  };

  const pick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*,audio/*";
    input.onchange = () => input.files?.[0] && importFile(input.files[0]);
    input.click();
  };

  return (
    <div
      className={`home ${over ? "drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void importFile(f);
      }}
    >
      <header className="home-head">
        <div className="logo">
          <span className="logo-mark" /> Open Script Editor
        </div>
        <button className="btn primary" onClick={pick}>
          <Icon name="plus" /> New project
        </button>
      </header>

      <div className="dropzone" onClick={pick}>
        {upload ? (
          <>
            <b>Importing {upload.name}</b>
            <div className="progress">
              <div style={{ width: `${Math.round(upload.progress * 100)}%` }} />
            </div>
          </>
        ) : (
          <>
            <Icon name="upload" size={28} />
            <b>Drop a video or audio file to start</b>
            <span className="muted small">It's transcribed on this Mac with Whisper. Then edit the video by editing the text.</span>
          </>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <h3 className="section-title">Projects</h3>
      {projects?.length === 0 && <p className="muted">No projects yet.</p>}
      <div className="project-grid">
        {projects?.map((p) => (
          <a key={p.id} className="project-card" href={`#/p/${p.id}`}>
            <div className="thumb">
              {p.thumb ? <img src={p.thumb} /> : <Icon name={p.hasVideo ? "film" : "wave"} size={28} />}
              <span className="dur">{fmtTime(p.duration)}</span>
            </div>
            <div className="meta">
              <b>{p.name}</b>
              <span className="muted small">
                {p.transcription.state === "running"
                  ? `Transcribing ${Math.round(p.transcription.progress * 100)}%`
                  : p.transcription.state === "error"
                    ? "Transcription failed"
                    : new Date(p.updatedAt).toLocaleString()}
              </span>
            </div>
            <button
              className="x"
              title="Delete project"
              onClick={async (e) => {
                e.preventDefault();
                if (!confirm(`Delete "${p.name}"? This removes its media copy and edits.`)) return;
                await api.remove(p.id);
                setProjects((ps) => ps?.filter((x) => x.id !== p.id) ?? null);
              }}
            >
              ×
            </button>
          </a>
        ))}
      </div>
    </div>
  );
}
