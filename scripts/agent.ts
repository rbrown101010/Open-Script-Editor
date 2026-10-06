// Tiny CLI over the HTTP API so agents (or you) can edit from a terminal.
//   npm run agent -- list
//   npm run agent -- import ~/Movies/talk.mp4
//   npm run agent -- script <projectId>
//   npm run agent -- ops <projectId> '[{"type":"removeFillers"}]'   (or a path to a .json file)
//   npm run agent -- undo <projectId>
//   npm run agent -- export <projectId> mp4|mp3|wav|srt|md|chapters|edl
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.SCRIPT_EDITOR_URL ?? `http://localhost:${process.env.PORT ?? 4317}`;
const [cmd, ...args] = process.argv.slice(2);

async function call(method: string, url: string, body?: unknown) {
  const r = await fetch(BASE + url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
}

const print = (x: unknown) => console.log(JSON.stringify(x, null, 2));

async function main() {
  switch (cmd) {
    case "list":
      return print(await call("GET", "/api/projects"));
    case "import": {
      const p = await call("POST", "/api/projects/from-path", { path: path.resolve(args[0]) });
      console.log(`Created ${p.id}; transcribing…`);
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const cur = await call("GET", `/api/projects/${p.id}`);
        if (cur.transcription.state !== "running") return console.log(cur.transcription.state, cur.id);
        process.stdout.write(`\r${Math.round(cur.transcription.progress * 100)}%`);
      }
    }
    case "script": {
      const s = await call("GET", `/api/projects/${args[0]}/script`);
      for (const p of s.paragraphs)
        console.log(p.tokens.map(([id, text, del]: [string, string, boolean]) => `${del ? "~" : ""}${text}{${id}}`).join(" ") + "\n");
      return;
    }
    case "project":
      return print(await call("GET", `/api/projects/${args[0]}`));
    case "composition":
      return print(await call("GET", `/api/projects/${args[0]}/composition`));
    case "ops": {
      const raw = fs.existsSync(args[1]) ? fs.readFileSync(args[1], "utf8") : args[1];
      const ops = JSON.parse(raw);
      const p = await call("POST", `/api/projects/${args[0]}/ops`, { ops: Array.isArray(ops) ? ops : [ops] });
      return console.log(`ok, rev ${p.rev}`);
    }
    case "undo":
    case "redo":
      return console.log(`ok, rev ${(await call("POST", `/api/projects/${args[0]}/${cmd}`)).rev}`);
    case "export": {
      const job = await call("POST", `/api/projects/${args[0]}/export`, { format: args[1] ?? "mp4" });
      for (;;) {
        await new Promise((r) => setTimeout(r, 500));
        const j = await call("GET", `/api/jobs/${job.id}`);
        if (j.state === "done") return console.log(j.path);
        if (j.state === "error") throw new Error(j.message);
        process.stdout.write(`\r${Math.round(j.progress * 100)}%`);
      }
    }
    default:
      console.log("commands: list | import <file> | script <id> | project <id> | composition <id> | ops <id> <json|file> | undo <id> | redo <id> | export <id> <format>");
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
