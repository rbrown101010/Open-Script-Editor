import type { Layer } from "../core/types.ts";
import { api } from "./api.ts";
import type { EditorApi } from "./Editor.tsx";

export const LAYER_COLORS = ["#f472b6", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#fb923c"];

export function layerColor(layers: Layer[], id: string): string {
  const i = layers.findIndex((l) => l.id === id);
  return LAYER_COLORS[(i < 0 ? 0 : i) % LAYER_COLORS.length];
}

export function layerLabel(ctx: EditorApi, l: Layer): string {
  if (l.type === "text") return l.text?.split("\n")[0] || "Title";
  return ctx.project.assets.find((a) => a.id === l.assetId)?.name ?? l.type;
}

/** Upload a file and attach it as a layer spanning the given words. */
export async function addMediaLayer(ctx: EditorApi, file: File, fromId: string, toId: string): Promise<string | null> {
  const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name);
  const isVideo = file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name);
  if (!isImage && !isVideo) {
    ctx.toast("Layers can be images or videos.");
    return null;
  }
  ctx.toast(`Uploading ${file.name}…`);
  const { asset } = await api.uploadAsset(ctx.project.id, file);
  const id = "ly_" + Math.random().toString(36).slice(2, 10);
  await ctx.edit([{ type: "addLayer", id, layerType: isImage ? "image" : "video", fromId, toId, assetId: asset.id }]);
  ctx.toast(`Added ${file.name} as a layer`);
  return id;
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
