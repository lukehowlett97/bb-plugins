// bb-plugin-workstreams-home — backend. Reads the workstream notes (markdown
// files whose frontmatter has `group: "<name>"`) and returns each one's
// `## Now` block, parsed into Status / Waiting on / Next / Done when.
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const Workstream = z.object({
  group: z.string(),
  title: z.string(),
  path: z.string(),
  updated: z.string().nullable(),
  status: z.string().nullable(),
  waiting: z.string().nullable(),
  next: z.string().nullable(),
  done: z.string().nullable(),
});
export type Workstream = z.infer<typeof Workstream>;

export const rpcContract = defineRpcContract({
  list: {
    input: z.null(),
    output: z.object({
      dir: z.string(),
      workstreams: z.array(Workstream),
      error: z.string().nullable(),
    }),
  },
});

const DEFAULT_DIR = "~/Work/Notes/projects";
const MAX_FILES = 200;
const MAX_FIELD = 600;

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

export function parseNote(text: string, path: string): Workstream | null {
  const src = text.replace(/\r\n/g, "\n");
  const fm = /^---\n([\s\S]*?)\n---/.exec(src);
  if (!fm) return null;
  const g = /^group:\s*(?:"([^"]+)"|'([^']+)'|(.+?))\s*$/m.exec(fm[1]);
  if (!g) return null;
  const group = (g[1] ?? g[2] ?? g[3] ?? "").trim();
  if (!group) return null;
  const body = src.slice(fm[0].length);
  const h1 = /^# (.+)$/m.exec(body);
  // The Now block runs from its heading to the next ## heading (or the end).
  const start = /^## Now[ \t]*$/m.exec(body);
  let block = "";
  if (start) {
    const rest = body.slice(start.index + start[0].length);
    const end = /^## /m.exec(rest);
    block = end ? rest.slice(0, end.index) : rest;
  }
  const updated = /^updated:\s*(\d{4}-\d{2}-\d{2})/m.exec(block)?.[1] ?? null;
  const field = (label: string) => {
    const re = new RegExp(`^[-*]\\s*\\*\\*${label}:?\\*\\*:?\\s*(.+)$`, "mi");
    const m = re.exec(block);
    return m ? plain(m[1]) : null;
  };
  return {
    group,
    title: h1 ? plain(h1[1]) : group,
    path,
    updated,
    status: field("Status"),
    waiting: field("Waiting on"),
    next: field("Next"),
    done: field("Done when"),
  };
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    notesDir: {
      type: "string",
      label: "Workstream notes folder",
      default: DEFAULT_DIR,
    },
  });

  bb.rpc.register(rpcContract, {
    async list() {
      const { notesDir } = await settings.get();
      const dir = expandHome(String(notesDir || DEFAULT_DIR));
      let names: string[];
      try {
        names = (await readdir(dir)).filter((n) => n.endsWith(".md")).sort().slice(0, MAX_FILES);
      } catch (err) {
        return { dir, workstreams: [], error: `Can't read ${dir}: ${err instanceof Error ? err.message : String(err)}` };
      }
      const found: (Workstream & { mtime: number })[] = [];
      await Promise.all(
        names.map(async (name) => {
          const path = join(dir, name);
          try {
            const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
            const ws = parseNote(text, path);
            if (ws) found.push({ ...ws, mtime: info.mtimeMs });
          } catch (err) {
            bb.log.warn(`skipped ${path}: ${String(err)}`);
          }
        }),
      );
      // Most recently updated first: the Now block's date, then the file's.
      found.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? "") || b.mtime - a.mtime);
      return { dir, workstreams: found.map(({ mtime: _m, ...w }) => w), error: null };
    },
  });
}
