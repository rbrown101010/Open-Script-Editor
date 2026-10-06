const PATHS: Record<string, string> = {
  back: "M15 18l-6-6 6-6",
  undo: "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11",
  redo: "M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13",
  play: "M7 4.5v15l12-7.5z",
  pause: "M7 4h3.5v16H7zM13.5 4H17v16h-3.5z",
  start: "M6 5v14M18 5L9 12l9 7z",
  export: "M12 15V3M7 8l5-5 5 5M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  strike: "M5 12h14M16 6.5A4 4 0 0012.5 5h-1a3.5 3.5 0 000 7M8 17.5A4 4 0 0011.5 19h1a3.5 3.5 0 000-7",
  restore: "M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8M3 3v5h5",
  gap: "M7 4l-3 16M14 4l-3 16M20 8h-4M20 16h-4",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5a1 1 0 100-.01",
  film: "M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  marker: "M6 3h12v18l-6-4-6 4z",
  pencil: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  plus: "M12 5v14M5 12h14",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3",
  wave: "M3 12h2M7 8v8M11 5v14M15 8v8M19 10v4M21 12h0",
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const fill = name === "play" || name === "pause";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth={fill ? 0 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
