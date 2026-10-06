import type { Project } from "../core/types.ts";
import type { EditOp } from "../core/ops.ts";

export type ProjectView = Project & { history: { canUndo: boolean; canRedo: boolean } };

export interface ProjectSummary {
  id: string;
  name: string;
  duration: number;
  updatedAt: string;
  hasVideo: boolean;
  thumb: string | null;
  transcription: Project["transcription"];
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `${r.status} ${r.statusText}`);
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  list: () => req<ProjectSummary[]>("/api/projects"),
  get: (id: string) => req<ProjectView>(`/api/projects/${id}`),
  remove: (id: string) => req(`/api/projects/${id}`, { method: "DELETE" }),
  ops: (id: string, ops: EditOp[]) => req<ProjectView>(`/api/projects/${id}/ops`, json({ ops })),
  undo: (id: string) => req<ProjectView>(`/api/projects/${id}/undo`, { method: "POST" }),
  redo: (id: string) => req<ProjectView>(`/api/projects/${id}/redo`, { method: "POST" }),
  retranscribe: (id: string) => req<ProjectView>(`/api/projects/${id}/transcribe`, { method: "POST" }),
  peaks: (id: string) => req<{ rate: number; data: number[] }>(`/api/projects/${id}/peaks`),
  export: (id: string, format: string, height?: number) =>
    req<{ id: string }>(`/api/projects/${id}/export`, json({ format, height })),
  job: (jobId: string) =>
    req<{ state: string; progress: number; message?: string; url?: string; path?: string; file?: string }>(`/api/jobs/${jobId}`),
  upload: (file: File, onProgress?: (f: number) => void) =>
    xhrUpload<ProjectView>(`/api/projects?name=${encodeURIComponent(file.name)}`, file, onProgress),
  uploadAsset: (id: string, file: File, onProgress?: (f: number) => void) =>
    xhrUpload<{ asset: Project["assets"][number]; project: ProjectView }>(
      `/api/projects/${id}/assets?name=${encodeURIComponent(file.name)}`,
      file,
      onProgress,
    ),
};

function xhrUpload<T>(url: string, file: File, onProgress?: (f: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.setRequestHeader("content-type", "application/octet-stream");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => {
      const body = JSON.parse(x.responseText || "{}");
      if (x.status >= 400) reject(new Error(body.error ?? x.statusText));
      else resolve(body);
    };
    x.onerror = () => reject(new Error("Upload failed"));
    x.send(file);
  });
}

export const mediaUrl = (p: Project, assetId: string) => {
  const a = p.assets.find((x) => x.id === assetId);
  return a ? `/media/${p.id}/${encodeURIComponent(a.file)}` : "";
};
