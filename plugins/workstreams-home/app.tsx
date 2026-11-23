// bb-plugin-workstreams-home — the Workstreams section on bb's home page.
//
// One card per workstream note (frontmatter `group:`), most recently updated
// first, showing the Now block's Status and Waiting on. Clicking a card puts a
// "pick up this workstream" prompt in the new-thread composer; nothing is sent
// until you press Enter.
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { definePluginApp, useComposer, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Workstream } from "./server";


type Result = { dir: string; workstreams: Workstream[]; pending: boolean; error: string | null };

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
  // The server says when Claude's short lines have landed.
  useRealtime("summaries", () => load());
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

// Three columns, two rows visible (six cards); the rest scroll inside the box.
// The box's height is fixed, loaded or not, so the composer above never moves.
const CARD_HEIGHT = 168;
const GAP = 10;
const BOX_HEIGHT = CARD_HEIGHT * 2 + GAP;

const box: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gridAutoRows: CARD_HEIGHT,
  gap: GAP,
  height: BOX_HEIGHT,
  overflowY: "auto",
  overscrollBehaviorY: "contain",
  scrollSnapType: "y proximity",
  scrollbarWidth: "thin",
  paddingRight: 2,
};

const card: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  scrollSnapAlign: "start",
  textAlign: "left",
  padding: "14px 14px 12px",
  borderRadius: "var(--radius, 8px)",
  border: "1px solid var(--border)",
  background: "var(--card, transparent)",
  color: "var(--card-foreground, inherit)",
  font: "inherit",
  cursor: "pointer",
  minWidth: 0,
};

const muted: CSSProperties = { color: "var(--muted-foreground)" };

const LINES: { key: "status" | "blocker" | "next"; label: string; dot: string }[] = [
  { key: "status", label: "Status", dot: "var(--muted-foreground)" },
  { key: "blocker", label: "Blocker", dot: "#e5a13a" },
  { key: "next", label: "Next", dot: "var(--primary, #22c55e)" },
];

function Line({ label, dot, text }: { label: string; dot: string; text: string | null }) {
  return (
    <li style={{ display: "grid", gridTemplateColumns: "8px 54px 1fr", alignItems: "baseline", gap: 6, minWidth: 0 }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: text ? dot : "var(--border)", transform: "translateY(-1px)" }} />
      <span style={{ ...muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</span>
      <span
        style={{
          fontSize: 13,
          lineHeight: 1.35,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          ...(text ? {} : muted),
        }}
      >
        {text ?? "—"}
      </span>
    </li>
  );
}

function Card({ ws }: { ws: Workstream }) {
  const composer = useComposer();
  const [hover, setHover] = useState(false);
  const when = shortDate(ws.updated);
  return (
    <button
      type="button"
      title={ws.full || undefined}
      style={{ ...card, background: hover ? "var(--accent, var(--muted))" : card.background }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => {
        composer.insert(prompt(ws), { at: "end", block: true });
        composer.focus();
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        <strong style={{ fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {ws.group}
        </strong>
        {when ? <span style={{ ...muted, fontSize: 11.5, flexShrink: 0 }}>{when}</span> : null}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {LINES.map((l) => (
          <Line key={l.key} label={l.label} dot={l.dot} text={ws[l.key]} />
        ))}
      </ul>
    </button>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p style={{ ...muted, fontSize: 13, height: BOX_HEIGHT, margin: 0 }}>{children}</p>;
}

function WorkstreamsSection() {
  const { data, failed } = useWorkstreams();
  if (failed) return <Notice>Couldn't load workstreams: {failed}</Notice>;
  if (!data) return <Notice>Loading workstreams…</Notice>;
  if (data.error) return <Notice>{data.error}</Notice>;
  if (data.workstreams.length === 0)
    return (
      <Notice>
        No workstream notes in {data.dir}. A note counts when its frontmatter has <code>group: "Name"</code>.
      </Notice>
    );
  return (
    <div style={box}>
      {data.workstreams.map((ws) => (
        <Card key={ws.path} ws={ws} />
      ))}
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
