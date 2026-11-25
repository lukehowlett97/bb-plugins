// bb-plugin-bb-setups — backend.
//
// 1. HTTP routes the Drop page's "open in bb" buttons link to:
//      GET /api/v1/plugins/bb-setups/http/share?kind=theme|skill|agents|plugin
//      GET /api/v1/plugins/bb-setups/http/install?id=<kind~who~name>
//      GET /api/v1/plugins/bb-setups/http/add?id=theme~who~name[&use=1]
//    share and install start a thread in the personal project with a FIXED
//    prompt and open it. The link only chooses which fixed prompt; it never
//    carries free text, so another website can at most open a thread that asks
//    you a question. add writes a theme that is already on the team's page
//    straight into ~/.bb/theme (CSS only, no thread), and switches with use=1.
// 2. RPC for the Themes page: the team's themes from Drop, and installing one.
//    Drop is read with the user's own key from ~/.measure/drop.env.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const SLUG = "bb-setups";
const PAGE = "https://drop.measureprotocol.com/i/bb-setups/";
const RUN = "drop get bb-setups --path bbsetups.py | python3 -";
const KINDS = ["theme", "skill", "agents", "plugin"] as const;
type Kind = (typeof KINDS)[number];
const ID_RE = /^(theme|skill|agents|plugin)~[a-z0-9._-]{1,64}~[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const TeamTheme = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  author: z.string(),
  description: z.string(),
  css: z.string(),
  sharedAt: z.string(),
});
export type TeamTheme = z.infer<typeof TeamTheme>;

export const rpcContract = defineRpcContract({
  teamThemes: {
    input: z.null(),
    output: z.object({ themes: z.array(TeamTheme), error: z.string().nullable() }),
  },
  installTheme: {
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ name: z.string(), already: z.boolean() }),
  },
  startShare: {
    input: z.object({ kind: z.enum(KINDS) }).strict(),
    output: z.object({ threadId: z.string() }),
  },
});

// ---------------------------------------------------------------------- prompts
function sharePrompt(kind: Kind): string {
  const tail = (cmd: string) =>
    `3. When I say yes, run:\n   ${RUN} ${cmd}\n4. Give me the link it prints. If it refuses because something looks like a key or password, tell me which line and stop.`;
  switch (kind) {
    case "theme":
      return `Share one of my bb themes on the team's bb setups page (${PAGE}).\n1. Run \`bb theme list\` and ask me which custom theme to share.\n2. Show me its theme.css and point out anything personal (home-folder paths, client or internal names). Suggest a one-line description.\n${tail('share theme <folder-name> --description "<the line I approved>"')}`;
    case "skill":
      return `Share one of my bb skills on the team's bb setups page (${PAGE}).\n1. List the folders in ~/.bb/skills and ask me which skill to share.\n2. Show me its SKILL.md and point out anything personal (home-folder paths, client or internal names, my own repos).\n${tail("share skill <folder-name>")}`;
    case "agents":
      return `Share a section of my bb AGENTS.md on the team's bb setups page (${PAGE}).\n1. List the headings in ~/.bb/AGENTS.md and ask me which section to share.\n2. Write just that section to a temporary file, show it to me, and point out anything personal or specific to my machine.\n${tail('share agents --title "<a short title>" --file <that file> --description "<one line>"')}`;
    case "plugin":
      return `Share one of my bb plugins on the team's bb setups page (${PAGE}).\n1. Run \`bb plugin list --json\` and ask me which plugin to share.\n2. Find where it installs from (a git: or npm: source; a local path won't work for anyone else) and suggest a one-line description.\n${tail('share plugin --title "<plugin name>" --source <source> --description "<the line I approved>"')}`;
  }
}

function installPrompt(id: string): string {
  const kind = id.split("~")[0] as Kind;
  const get =
    kind === "agents" ? `get ${id} --append` : kind === "plugin" ? `get ${id}` : `get ${id}`;
  const after =
    kind === "theme"
      ? "Then tell me to hover it in Settings, Appearance to preview it, or switch to it from the Themes page on the rail."
      : kind === "skill"
        ? "If I already have a skill with that name it stops; ask me whether to use --as <new-name> or --force. Then tell me the slash command."
        : kind === "agents"
          ? "Then remind me that new threads pick it up."
          : "It prints the `bb plugin install` command. A plugin runs code on my machine, so show me its source and ask before you run it.";
  return `Install "${id}" from the team's bb setups page (${PAGE}).\n1. Run \`${RUN} show ${id}\` and tell me in two or three lines what it is, who shared it, and anything in it that would run code or change how my agents behave.\n2. When I say yes, run \`${RUN} ${get}\`.\n3. ${after}`;
}

// ---------------------------------------------------------------------- Drop
async function dropEnv(): Promise<{ url: string; key: string }> {
  let key = process.env.MEASURE_DROP_KEY?.trim() ?? "";
  let url = process.env.MEASURE_DROP_URL?.trim() ?? "";
  const f = join(homedir(), ".measure", "drop.env");
  if ((!key || !url) && existsSync(f)) {
    for (const line of (await readFile(f, "utf8")).split("\n")) {
      const i = line.indexOf("=");
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
      if (k === "MEASURE_DROP_KEY" && !key) key = v;
      if (k === "MEASURE_DROP_URL" && !url) url = v;
    }
  }
  if (!key) throw new Error("No Drop key. Run `drop auth login` in a terminal, then refresh.");
  return { url: (url || "https://drop.measureprotocol.com").replace(/\/$/, ""), key };
}

type Row = { key: string; email?: string | null; value?: Record<string, unknown> };

async function entries(): Promise<Row[]> {
  const { url, key } = await dropEnv();
  const res = await fetch(`${url}/i/${SLUG}/_db/entries`, {
    headers: { "X-API-Key": key, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Drop said ${res.status} reading the bb setups page.`);
  const body = (await res.json()) as { items?: Row[] };
  return body.items ?? [];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

// ---------------------------------------------------------------------- threads
let lastSpawn = 0;

async function personalProjectId(bb: BbPluginApi): Promise<string> {
  const projects = (await bb.sdk.projects.list({ includePersonal: true })) as unknown as Array<{
    id: string;
    kind?: string;
  }>;
  const p = projects.find((x) => x.kind === "personal") ?? projects[0];
  if (!p) throw new Error("No bb project to start the thread in.");
  return p.id;
}

async function startThread(bb: BbPluginApi, prompt: string, title: string): Promise<string> {
  const now = Date.now();
  if (now - lastSpawn < 3_000) throw new Error("A bb setups thread was started a moment ago.");
  lastSpawn = now;
  const thread = (await bb.sdk.threads.spawn({
    projectId: await personalProjectId(bb),
    environment: { type: "project-default" },
    prompt,
    title,
  } as Parameters<typeof bb.sdk.threads.spawn>[0])) as unknown as { id: string };
  await bb.sdk.threads.open({ threadId: thread.id, file: null }).catch(() => undefined);
  // Bring the bb window forward; the link was clicked in a browser.
  if (process.platform === "darwin") {
    spawn("open", ["-a", "bb"], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  }
  return thread.id;
}

async function installTeamTheme(bb: BbPluginApi, id: string): Promise<{ name: string; already: boolean }> {
  if (!ID_RE.test(id) || !id.startsWith("theme~")) throw new Error("Not a theme id.");
  const row = (await entries()).find((r) => r.key === id);
  if (!row?.value) throw new Error(`${id} isn't on the bb setups page any more.`);
  const files = Object.entries((row.value.files ?? {}) as Record<string, unknown>).filter(
    ([p, t]) => typeof t === "string" && /^[A-Za-z0-9._-]+\.(css|json)$/.test(p),
  ) as Array<[string, string]>;
  if (!files.some(([p]) => p === "theme.css")) throw new Error("That entry has no theme.css.");
  const dir = (await bb.sdk.theme.catalog()).dir;
  const base = str(row.value.name);
  if (!NAME_RE.test(base)) throw new Error("That theme's name can't be a folder name.");
  const same = async (d: string) => {
    try {
      for (const [p, t] of files) if ((await readFile(join(d, p), "utf8")) !== t) return false;
      return true;
    } catch {
      return false;
    }
  };
  let name = base;
  if (existsSync(join(dir, name)) && !(await same(join(dir, name)))) name = `${base}-${id.split("~")[1]}`;
  const dest = join(dir, name);
  if (existsSync(dest) && (await same(dest))) return { name, already: true };
  if (existsSync(dest)) throw new Error(`You already have a different theme called ${name}.`);
  await mkdir(dest, { recursive: true });
  for (const [p, t] of files) {
    const target = resolve(dest, p);
    if (!target.startsWith(resolve(dest) + sep)) throw new Error("Bad file path in that theme.");
    await writeFile(target, t);
  }
  return { name, already: false };
}

function page(title: string, body: string, ok: boolean): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>:root{color-scheme:light dark;--bg:#f6f4fb;--ink:#1e1b26;--muted:#6a6578;--accent:#5b3fd6}
@media (prefers-color-scheme:dark){:root{--bg:#17151d;--ink:#ece9f4;--muted:#a49fb3;--accent:#a996ff}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
main{max-width:34rem;padding:2rem}h1{margin:0 0 .5rem;font-size:1.6rem;font-weight:600;color:${ok ? "var(--ink)" : "var(--accent)"}}p{margin:0;color:var(--muted)}a{color:var(--accent)}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

// ---------------------------------------------------------------------- plugin
export default function plugin(bb: BbPluginApi) {
  bb.http.route("GET", "/share", async (c) => {
    const kind = new URL(c.req.url).searchParams.get("kind") ?? "theme";
    if (!(KINDS as readonly string[]).includes(kind)) return page("Nothing to share", "That link asked for something bb setups doesn't know.", false);
    try {
      await startThread(bb, sharePrompt(kind as Kind), `Share a ${kind === "agents" ? "AGENTS.md section" : kind} on bb setups`);
      return page("Opened in bb", "A thread is asking which one to share. You can close this tab.", true);
    } catch (e) {
      return page("Couldn't open bb", e instanceof Error ? e.message : String(e), false);
    }
  });

  bb.http.route("GET", "/install", async (c) => {
    const id = new URL(c.req.url).searchParams.get("id") ?? "";
    if (!ID_RE.test(id)) return page("Nothing to install", "That link didn't name a bb setups entry.", false);
    try {
      await startThread(bb, installPrompt(id), `Install ${id.split("~")[2]} from bb setups`);
      return page("Opened in bb", "A thread is showing you what it is before installing. You can close this tab.", true);
    } catch (e) {
      return page("Couldn't open bb", e instanceof Error ? e.message : String(e), false);
    }
  });

  // Direct add, no thread: themes only, because a theme is just CSS and the
  // id must name an entry already on the team's page. ?use=1 also switches to it.
  bb.http.route("GET", "/add", async (c) => {
    const q = new URL(c.req.url).searchParams;
    const id = q.get("id") ?? "";
    if (!ID_RE.test(id) || !id.startsWith("theme~")) return page("Nothing to add", "That link didn't name a theme on the bb setups page.", false);
    try {
      const { name, already } = await installTeamTheme(bb, id);
      const use = q.get("use") === "1";
      if (use) await bb.sdk.theme.set(name);
      const title = use ? `Switched to ${name}` : already ? `${name} is already in your bb` : `Added ${name} to your bb`;
      const body = use
        ? "bb is using it now. You can close this tab."
        : "Switch to it from the Themes page on bb's rail, or hover it in Settings, Appearance to preview it. You can close this tab.";
      return page(title, body, true);
    } catch (e) {
      return page("Couldn't add it", e instanceof Error ? e.message : String(e), false);
    }
  });

  bb.rpc.register(rpcContract, {
    async teamThemes() {
      try {
        const rows = await entries();
        const themes = rows
          .filter((r) => r.value?.kind === "theme" && ID_RE.test(r.key))
          .map((r) => {
            const v = r.value ?? {};
            const files = (v.files ?? {}) as Record<string, unknown>;
            return {
              id: r.key,
              name: str(v.name),
              title: str(v.title) || str(v.name),
              author: str(v.author) || r.key.split("~")[1],
              description: str(v.description),
              css: str(files["theme.css"]),
              sharedAt: str(v.shared_at),
            };
          })
          .sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
        return { themes, error: null };
      } catch (e) {
        return { themes: [], error: e instanceof Error ? e.message : String(e) };
      }
    },

    async installTheme({ id }) {
      return installTeamTheme(bb, id);
    },

    async startShare({ kind }) {
      return { threadId: await startThread(bb, sharePrompt(kind), `Share a ${kind === "agents" ? "AGENTS.md section" : kind} on bb setups`) };
    },
  });
}
