// bb-plugin-thread-dots — swaps the sidebar's spinners for coloured dots.
//
//   blue   unopened   finished output you haven't looked at yet
//   amber  working    the agent is running (pulses)
//   green  cache hot  read, and the last turn ended within the cache TTL
//   grey   cache cold read, and the prompt cache has (probably) expired
//
// How it fits together:
// - Icons: four dot glyphs registered with experimental_icons.
// - Content script: owns experimental_setThreadRowStatus (the only way to put a
//   glyph on bb's own rows) plus a stylesheet. bb never lets a row status
//   replace its "runtime" spinner, so the stylesheet repaints that spinner as
//   the amber dot.
// - App overlay: reads the live thread list, classifies each thread, and
//   pushes the result through the content script's setter.
// - Hover card: a second overlay that watches the pointer over bb's row
//   anchors (a[data-sidebar-thread-id]) and shows a fixed-position card.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  definePluginApp,
  experimental_useProviders,
  experimental_useSidebarThreads,
  useSettings,
  type PluginComposerThreadRowStatus,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

type RowStatus = PluginComposerThreadRowStatus;
type Setter = (threadId: string, status: RowStatus | null) => void;

const COLORS = {
  unopened: "#3b82f6",
  working: "#f59e0b",
  hot: "#22c55e",
  cold: "#71717a",
} as const;
type Kind = keyof typeof COLORS;

const ICON = (kind: Kind) => `thread-dots/${kind}`;
const LABELS: Record<Kind, string> = {
  unopened: "Unopened",
  working: "Working",
  hot: "Cache hot",
  cold: "Cache cold",
};

const DEFAULT_TTL_MINUTES = 60;
const TICK_MS = 30_000;

// Indicators that mean the agent is doing something. "runtime" is drawn by bb
// regardless (restyled by CSS below); the rest accept our row status.
const WORKING = new Set<string>([
  "runtime",
  "working-draft",
  "workflow",
  "background-agent",
  "background-command",
  "plan-mode",
  "goal",
]);
// bb's own glyphs for these carry real information; leave them alone.
const KEEP_BB_GLYPH = new Set<string>([
  "waiting-for-input",
  "unread-error",
  "queued-failed",
]);

function classify(
  thread: PluginSidebarThread,
  now: number,
  ttlMs: number,
): Kind | null {
  if (KEEP_BB_GLYPH.has(thread.indicator)) return null;
  if (
    WORKING.has(thread.indicator) ||
    thread.status === "starting" ||
    thread.status === "active" ||
    thread.status === "stopping"
  ) {
    return "working";
  }
  if (thread.isUnread) return "unopened";
  return now - thread.latestAttentionAt < ttlMs ? "hot" : "cold";
}

function makeDot(color: string, pulse: boolean) {
  return function Dot({ className }: { className?: string }) {
    return (
      <svg
        viewBox="0 0 16 16"
        width="100%"
        height="100%"
        className={className}
        style={{ display: "block" }}
        aria-hidden="true"
      >
        <circle
          cx="8"
          cy="8"
          r="4.5"
          fill={color}
          className={pulse ? "thread-dots-pulse" : undefined}
        />
      </svg>
    );
  };
}

// bb draws its runtime spinner as <svg data-icon="Loading" aria-label="Thread working" class="animate-spin …">.
// An outer <svg> is a CSS box, so hide its paths and paint a round background instead.
const CSS = `
@keyframes thread-dots-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
.thread-dots-pulse { animation: thread-dots-pulse 1.4s ease-in-out infinite; }
[data-icon="Loading"][aria-label="Thread working"] {
  animation: thread-dots-pulse 1.4s ease-in-out infinite !important;
  display: inline-block;
  border-radius: 9999px;
  background: ${COLORS.working};
  transform: scale(0.5625);
}
[data-icon="Loading"][aria-label="Thread working"] > * { display: none; }
@media (prefers-reduced-motion: reduce) {
  .thread-dots-pulse, [data-icon="Loading"][aria-label="Thread working"] { animation: none !important; }
}
`;

// Bridge between the content script (which owns the setter) and the overlay
// (which owns the data). Both live in this bundle and the same window.
let setter: Setter | null = null;
const setterListeners = new Set<() => void>();
function publishSetter(next: Setter | null) {
  setter = next;
  for (const listener of setterListeners) listener();
}
function useSetter(): Setter | null {
  const [value, setValue] = useState(() => setter);
  useEffect(() => {
    const listener = () => setValue(() => setter);
    setterListeners.add(listener);
    listener();
    return () => {
      setterListeners.delete(listener);
    };
  }, []);
  return value;
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function useTtlMs() {
  const { values } = useSettings();
  const ttlSetting = values?.cacheTtlMinutes;
  return (
    (typeof ttlSetting === "number" && ttlSetting > 0
      ? ttlSetting
      : DEFAULT_TTL_MINUTES) * 60_000
  );
}

function ThreadDotsSync() {
  const set = useSetter();
  const { threads } = experimental_useSidebarThreads();
  const ttlMs = useTtlMs();
  const now = useNow(TICK_MS);
  const applied = useRef(new Map<string, Kind>());

  useEffect(() => {
    if (!set) {
      applied.current.clear();
      return;
    }
    const seen = new Set<string>();
    for (const thread of threads ?? []) {
      seen.add(thread.id);
      const kind = classify(thread, now, ttlMs);
      const previous = applied.current.get(thread.id);
      if (kind === previous) continue;
      if (kind === null) {
        set(thread.id, null);
        applied.current.delete(thread.id);
      } else {
        set(thread.id, { icon: ICON(kind), label: LABELS[kind] });
        applied.current.set(thread.id, kind);
      }
    }
    for (const id of [...applied.current.keys()]) {
      if (!seen.has(id)) {
        set(id, null);
        applied.current.delete(id);
      }
    }
  }, [set, threads, now, ttlMs]);

  return null;
}

const HOVER_DELAY_MS = 450;
const ROW_SELECTOR = "a[data-sidebar-thread-id]";
const CARD_WIDTH = 280;

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function duration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function describeState(
  thread: PluginSidebarThread,
  kind: Kind | null,
  now: number,
  ttlMs: number,
): string {
  const sinceTurn = now - thread.latestAttentionAt;
  const cache =
    sinceTurn < ttlMs
      ? `cache hot, ${duration(ttlMs - sinceTurn)} left`
      : `cache cold, expired ${ago(sinceTurn - ttlMs)}`;
  switch (kind) {
    case "working":
      return thread.indicatorLabel && thread.indicator !== "runtime"
        ? `Working: ${thread.indicatorLabel}`
        : "Working";
    case "unopened":
      return `Unopened · ${cache}`;
    case "hot":
    case "cold":
      return cache.charAt(0).toUpperCase() + cache.slice(1);
    default:
      return thread.indicatorLabel ?? "Idle";
  }
}

function activitySummary(thread: PluginSidebarThread): string | null {
  const { activity } = thread;
  const parts: string[] = [];
  if (activity.backgroundAgents) parts.push(plural(activity.backgroundAgents, "background agent"));
  if (activity.backgroundCommands) parts.push(plural(activity.backgroundCommands, "background command"));
  if (activity.workflows) parts.push(plural(activity.workflows, "workflow"));
  if (activity.planMode) parts.push("plan mode");
  if (activity.goals) parts.push(plural(activity.goals, "goal"));
  if (thread.hasPendingInteraction) parts.push("waiting for you");
  if (thread.queuedWork === "waiting") parts.push("message queued");
  if (thread.queuedWork === "failed") parts.push("queued message failed");
  return parts.length ? parts.join(", ") : null;
}

type Hover = { id: string; rect: DOMRect };

function useHoveredRow(): Hover | null {
  const [hover, setHover] = useState<Hover | null>(null);
  useEffect(() => {
    let anchor: Element | null = null;
    let timer: number | undefined;
    const hide = () => {
      window.clearTimeout(timer);
      anchor = null;
      setHover(null);
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const target = event.target instanceof Element ? event.target : null;
      const next = target?.closest(ROW_SELECTOR) ?? null;
      if (next === anchor) return;
      window.clearTimeout(timer);
      anchor = next;
      setHover(null);
      if (!next) return;
      timer = window.setTimeout(() => {
        const id = next.getAttribute("data-sidebar-thread-id");
        if (id && next.isConnected) setHover({ id, rect: next.getBoundingClientRect() });
      }, HOVER_DELAY_MS);
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);
  return hover;
}

const cardStyle: CSSProperties = {
  position: "fixed",
  zIndex: 2147483000,
  width: CARD_WIDTH,
  padding: "10px 12px",
  borderRadius: "calc(var(--radius, 8px) + 2px)",
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  boxShadow: "var(--shadow-md, 0 8px 24px rgba(0,0,0,.25))",
  fontFamily: "var(--font-sans, inherit)",
  fontSize: 12,
  lineHeight: 1.45,
  pointerEvents: "none",
};
const mutedStyle: CSSProperties = { color: "var(--muted-foreground)" };

function ThreadHoverCard() {
  const hover = useHoveredRow();
  const { threads } = experimental_useSidebarThreads();
  const { providers } = experimental_useProviders();
  const ttlMs = useTtlMs();
  const now = useNow(15_000);
  if (!hover) return null;
  const thread = threads.find((t) => t.id === hover.id);
  if (!thread) return null;

  const kind = classify(thread, now, ttlMs);
  const provider = providers.find((p) => p.id === thread.providerId);
  const children = threads.filter(
    (t) => t.parentThreadId === thread.id && !t.isArchived && !t.isHidden,
  ).length;
  const where = [
    thread.environment?.branchName ?? thread.environment?.name,
    thread.host?.name,
  ].filter(Boolean);
  const activity = activitySummary(thread);

  const rows: [string, string][] = [];
  if (provider) rows.push(["Agent", provider.displayName]);
  if (where.length) rows.push(["Where", where.join(" · ")]);
  if (activity) rows.push(["Activity", activity]);
  rows.push(["Last turn", ago(now - thread.latestAttentionAt)]);
  rows.push(["Last opened", thread.lastReadAt ? ago(now - thread.lastReadAt) : "never"]);
  if (children) rows.push(["Sub-threads", String(children)]);
  rows.push(["Created", ago(now - thread.createdAt)]);

  const estimatedHeight = 64 + rows.length * 18;
  const top = Math.max(
    8,
    Math.min(hover.rect.top - 4, window.innerHeight - estimatedHeight - 8),
  );
  const fitsRight = hover.rect.right + 8 + CARD_WIDTH < window.innerWidth;
  const left = fitsRight
    ? hover.rect.right + 8
    : Math.max(8, hover.rect.left - CARD_WIDTH - 8);

  return (
    <div style={{ ...cardStyle, top, left }} role="tooltip">
      <div
        style={{
          fontWeight: 600,
          fontSize: 13,
          marginBottom: 6,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}
      >
        {thread.displayTitle}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 9999,
            flexShrink: 0,
            background: kind ? COLORS[kind] : "var(--muted-foreground)",
          }}
        />
        <span>{describeState(thread, kind, now, ttlMs)}</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          columnGap: 10,
          rowGap: 2,
        }}
      >
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: "contents" }}>
            <span style={mutedStyle}>{label}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  for (const kind of Object.keys(COLORS) as Kind[]) {
    app.experimental_icons.register({
      name: ICON(kind),
      component: makeDot(COLORS[kind], kind === "working"),
    });
  }

  app.contentScripts.register({
    id: "thread-dots",
    mount: ({ signal, experimental_setThreadRowStatus }) => {
      const style = document.createElement("style");
      style.dataset.plugin = "thread-dots";
      style.textContent = CSS;
      document.head.appendChild(style);
      if (experimental_setThreadRowStatus) {
        publishSetter(experimental_setThreadRowStatus);
      }
      const dispose = () => {
        style.remove();
        publishSetter(null);
      };
      signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  });

  app.slots.experimental_appOverlay({
    id: "thread-dots-sync",
    component: ThreadDotsSync,
  });

  app.slots.experimental_appOverlay({
    id: "thread-dots-hover",
    component: ThreadHoverCard,
  });
});
