// bb-plugin-workstreams-home — backend. Reads the workstream notes (markdown
// files whose frontmatter has `group: "<name>"`), parses each one's `## Now`
// block, and gives every card three short lines: status, blocker, next.
//
// The short lines come from Claude (Haiku, through the local `claude` CLI),
// cached per note by a hash of its Now block, so a note is summarised once per
// change. Until a summary exists the card shows a trimmed first clause, and
// the frontend is told to refetch when the summaries land.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const Workstream = z.object({
  group: z.string(),
  path: z.string(),
  updated: z.string().nullable(),
  status: z.string().nullable(),
  blocker: z.string().nullable(),
  next: z.string().nullable(),
  // The full Now lines, for the hover text.
  full: z.string(),
  summarised: z.boolean(),
});
export type Workstream = z.infer<typeof Workstream>;

export const rpcContract = defineRpcContract({
  list: {
    input: z.null(),
    output: z.object({
      dir: z.string(),
      workstreams: z.array(Workstream),
      pending: z.boolean(),
      error: z.string().nullable(),
    }),
  },
});

export const CHANNEL = "summaries";
const DEFAULT_DIR = "~/Work/Notes/projects";
const MAX_FILES = 200;
const MAX_FIELD = 600;
const SHORT = 64;

type Parsed = {
  group: string;
  path: string;
  updated: string | null;
  status: string | null;
  waiting: string | null;
  next: string | null;
};
type Short = { status: string | null; blocker: string | null; next: string | null };

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

// Markdown to one plain line: links keep their text, wiki links their name,
// emphasis and code marks go.
export function plain(s: string): string {
  const out = s
    .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_m, a: string, _b, c?: string) => c ?? a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return out.length > MAX_FIELD ? out.slice(0, MAX_FIELD - 1) + "…" : out;
}

// The first clause, cut on a word boundary: the fallback until Claude answers.
export function firstClause(s: string | null): string | null {
  if (!s) return null;
  let t = s.split(/(?<=[.;])\s|\s\(|:\s/)[0].replace(/[.;,]$/, "").trim();
  if (t.length > SHORT) t = t.slice(0, t.lastIndexOf(" ", SHORT) > 20 ? t.lastIndexOf(" ", SHORT) : SHORT) + "…";
  return t || null;
}

export function parseNote(text: string, path: string): Parsed | null {
  const src = text.replace(/\r\n/g, "\n");
  const fm = /^---\n([\s\S]*?)\n---/.exec(src);
  if (!fm) return null;
  const g = /^group:\s*(?:"([^"]+)"|'([^']+)'|(.+?))\s*$/m.exec(fm[1]);
  if (!g) return null;
  const group = (g[1] ?? g[2] ?? g[3] ?? "").trim();
  if (!group) return null;
  const body = src.slice(fm[0].length);
  // The Now block runs from its heading to the next ## heading (or the end).
  const start = /^## Now[ \t]*$/m.exec(body);
  let block = "";
  if (start) {
    const rest = body.slice(start.index + start[0].length);
    const end = /^## /m.exec(rest);
    block = end ? rest.slice(0, end.index) : rest;
  }
  const field = (label: string) => {
    const m = new RegExp(`^[-*]\\s*\\*\\*${label}:?\\*\\*:?\\s*(.+)$`, "mi").exec(block);
    return m ? plain(m[1]) : null;
  };
  return {
    group,
    path,
    updated: /^updated:\s*(\d{4}-\d{2}-\d{2})/m.exec(block)?.[1] ?? null,
    status: field("Status"),
    waiting: field("Waiting on"),
    next: field("Next"),
  };
}

function keyOf(p: Parsed): string {
  const h = createHash("sha1").update(JSON.stringify([p.group, p.status, p.waiting, p.next])).digest("hex");
  return "short:" + h.slice(0, 20);
}

function claudeBin(): string {
  for (const c of ["/opt/homebrew/bin/claude", "/usr/local/bin/claude", join(homedir(), ".local/bin/claude"), join(homedir(), ".claude/local/claude")])
    if (existsSync(c)) return c;
  return "claude";
}

const ShortReply = z.array(
  z.object({ id: z.number(), status: z.string().nullable(), blocker: z.string().nullable(), next: z.string().nullable() }),
);

function ask(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin(), ["-p", "--model", "haiku", "--output-format", "text"], {
      cwd: homedir(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
    });
    child.stdin.end(prompt);
  });
}

async function summarise(items: Parsed[]): Promise<Short[]> {
  const input = items.map((p, id) => ({ id, workstream: p.group, status: p.status, waiting_on: p.waiting, next: p.next }));
  const prompt = `You write the three lines on a small status card for each workstream below.
For each one return:
- status: where it stands, at most 6 words
- blocker: who or what it is waiting on, at most 6 words; null if nothing is blocking or it only waits on "me"/"Luke" with nothing external
- next: the next move, at most 6 words, starting with a verb
Plain words, no full stops, no dates unless essential, no ticket numbers, names kept. Use what the text says; never invent.
Reply with only a JSON array of {"id", "status", "blocker", "next"}, nothing else.

${JSON.stringify(input, null, 1)}`;
  const raw = await ask(prompt);
  const json = raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1);
  const parsed = ShortReply.parse(JSON.parse(json));
  return items.map((_, id) => {
    const r = parsed.find((x) => x.id === id);
    const clean = (v: string | null | undefined) => (v && !/^(none|null|n\/a|nothing|-+)$/i.test(v.trim()) ? v.trim() : null);
    return { status: clean(r?.status), blocker: clean(r?.blocker), next: clean(r?.next) };
  });
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    notesDir: { type: "string", label: "Workstream notes folder", default: DEFAULT_DIR },
  });

  let running: Promise<void> | null = null;
  function fill(missing: Parsed[]) {
    if (running || missing.length === 0) return;
    running = summarise(missing)
      .then(async (shorts) => {
        await Promise.all(missing.map((p, i) => bb.storage.kv.set(keyOf(p), shorts[i])));
        bb.realtime.publish(CHANNEL, { done: missing.length });
      })
      .catch((err: unknown) => bb.log.warn(`summaries failed: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        running = null;
      });
  }

  bb.rpc.register(rpcContract, {
    async list() {
      const { notesDir } = await settings.get();
      const dir = expandHome(String(notesDir || DEFAULT_DIR));
      let names: string[];
      try {
        names = (await readdir(dir)).filter((n) => n.endsWith(".md")).sort().slice(0, MAX_FILES);
      } catch (err) {
        return { dir, workstreams: [], pending: false, error: `Can't read ${dir}: ${err instanceof Error ? err.message : String(err)}` };
      }
      const found: (Parsed & { mtime: number })[] = [];
      await Promise.all(
        names.map(async (name) => {
          const path = join(dir, name);
          try {
            const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
            const p = parseNote(text, path);
            if (p) found.push({ ...p, mtime: info.mtimeMs });
          } catch (err) {
            bb.log.warn(`skipped ${path}: ${String(err)}`);
          }
        }),
      );
      // Most recently updated first: the Now block's date, then the file's.
      found.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? "") || b.mtime - a.mtime);

      const missing: Parsed[] = [];
      const workstreams = await Promise.all(
        found.map(async (p) => {
          const cached = p.status || p.waiting || p.next ? await bb.storage.kv.get<Short>(keyOf(p)) : null;
          if (!cached && (p.status || p.waiting || p.next)) missing.push(p);
          const full = [p.status && `Status: ${p.status}`, p.waiting && `Waiting on: ${p.waiting}`, p.next && `Next: ${p.next}`]
            .filter(Boolean)
            .join("\n\n");
          return {
            group: p.group,
            path: p.path,
            updated: p.updated,
            status: cached ? cached.status : firstClause(p.status),
            blocker: cached ? (cached.blocker && /^none$/i.test(cached.blocker.trim()) ? null : cached.blocker) : firstClause(p.waiting),
            next: cached ? cached.next : firstClause(p.next),
            full,
            summarised: Boolean(cached),
          };
        }),
      );
      fill(missing);
      return { dir, workstreams, pending: missing.length > 0, error: null };
    },
  });
}
