// bb-plugin-workstreams-home — the Workstreams section on bb's home page.
//
// One card per workstream note (frontmatter `group:`), most recently updated
// first, showing the Now block's Status and Waiting on. Clicking a card puts a
// "pick up this workstream" prompt in the new-thread composer; nothing is sent
// until you press Enter.
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { definePluginApp, useComposer, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Workstream } from "./server";

const COLLAPSED = 6;

type Result = { dir: string; workstreams: Workstream[]; error: string | null };

function useWorkstreams() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<Result | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const load = useCallback(() => {
    rpc.call("list").then(
      (r) => {
        setData(r);
        setFailed(null);
      },
      (err: unknown) => setFailed(err instanceof Error ? err.message : String(err)),
    );
  }, [rpc]);
  useEffect(() => {
    load();
    // Notes change while bb is in the background; re-read when it comes back.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);
  return { data, failed };
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  // Whole calendar days between that date and today, both at local midnight.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function prompt(ws: Workstream): string {
  return `Pick up the "${ws.group}" workstream. Read the Now block in ${ws.path} first, then carry on from its Next line.`;
}

const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
  gap: 10,
};

const card: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  textAlign: "left",
  padding: "10px 12px",
  borderRadius: "var(--radius, 8px)",
  border: "1px solid var(--border)",
  background: "var(--card, transparent)",
  color: "var(--card-foreground, inherit)",
  font: "inherit",
  cursor: "pointer",
  minWidth: 0,
};

const clamp = (lines: number): CSSProperties => ({
  display: "-webkit-box",
  WebkitLineClamp: lines,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  margin: 0,
  fontSize: 12.5,
  lineHeight: 1.4,
});

const muted: CSSProperties = { color: "var(--muted-foreground)" };

function Card({ ws }: { ws: Workstream }) {
  const composer = useComposer();
  const [hover, setHover] = useState(false);
  const when = shortDate(ws.updated);
  const tip = [ws.status && `Status: ${ws.status}`, ws.waiting && `Waiting on: ${ws.waiting}`, ws.next && `Next: ${ws.next}`]
    .filter(Boolean)
    .join("\n\n");
  return (
    <button
      type="button"
      title={tip || undefined}
      style={{ ...card, background: hover ? "var(--accent, var(--muted))" : card.background }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => {
        composer.insert(prompt(ws), { at: "end", block: true });
        composer.focus();
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        <strong style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {ws.group}
        </strong>
        {when ? <span style={{ ...muted, fontSize: 11.5, flexShrink: 0 }}>{when}</span> : null}
      </div>
      {ws.status ? (
        <p style={clamp(3)}>{ws.status}</p>
      ) : (
        <p style={{ ...clamp(1), ...muted }}>No Now block yet.</p>
      )}
      {ws.waiting ? (
        <p style={{ ...clamp(2), ...muted }}>
          <span style={{ fontWeight: 600 }}>Waiting on: </span>
          {ws.waiting}
        </p>
      ) : null}
    </button>
  );
}

function WorkstreamsSection() {
  const { data, failed } = useWorkstreams();
  const [all, setAll] = useState(false);
  if (failed) return <p style={{ ...muted, fontSize: 13 }}>Couldn't load workstreams: {failed}</p>;
  if (!data) return <p style={{ ...muted, fontSize: 13 }}>Loading workstreams…</p>;
  if (data.error) return <p style={{ ...muted, fontSize: 13 }}>{data.error}</p>;
  if (data.workstreams.length === 0)
    return (
      <p style={{ ...muted, fontSize: 13 }}>
        No workstream notes in {data.dir}. A note counts when its frontmatter has <code>group: "Name"</code>.
      </p>
    );
  const shown = all ? data.workstreams : data.workstreams.slice(0, COLLAPSED);
  const hidden = data.workstreams.length - shown.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={grid}>
        {shown.map((ws) => (
          <Card key={ws.path} ws={ws} />
        ))}
      </div>
      {hidden > 0 || all ? (
        <button
          type="button"
          onClick={() => setAll(!all)}
          style={{ ...muted, alignSelf: "flex-start", background: "none", border: 0, padding: 0, font: "inherit", fontSize: 12.5, cursor: "pointer" }}
        >
          {all ? "Show fewer" : `Show all ${data.workstreams.length}`}
        </button>
      ) : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.homepageSection({
    id: "workstreams",
    title: "Workstreams",
    component: WorkstreamsSection,
  });
});
