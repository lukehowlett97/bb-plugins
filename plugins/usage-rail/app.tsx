// bb-plugin-usage-rail — puts provider usage on the navigation rail.
//
// - Rail item: a `navPanel` called Usage. Its badge stays off while every
//   window is calm, and turns into a warning dot at 70% or a critical dot at
//   90% so the collapsed rail still tells you when you're close to a limit.
// - Hover card: an app overlay watches the pointer over the rail item
//   ([data-nav-rail-item] in the Rail, [data-sidebar-navigation-item] in the
//   Top list) and shows every provider's windows as bars.
// - Page: clicking the item opens the same bars full size, with a refresh.
//
// Data comes from useSdk().system.usageLimits(), the same source as bb's own
// footer card and `bb settings usage`. One module-level poller feeds all three.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import {
  definePluginApp,
  experimental_usePluginId,
  experimental_useProviders,
  useSdk,
} from "@get-bb/plugin-sdk/app";

const PANEL_ID = "usage";
const POLL_MS = 60_000;
const HOVER_STALE_MS = 20_000;
const HOVER_DELAY_MS = 150;
const CARD_WIDTH = 280;
const WARN_AT = 70;
const CRITICAL_AT = 90;

type Sdk = ReturnType<typeof useSdk>;
type UsageResponse = Awaited<ReturnType<Sdk["system"]["usageLimits"]>>;
type ProviderUsage = UsageResponse[string];
type Window = { label: string; usedPercent: number; resetsAt: string | null; kind?: string };

// ---------------------------------------------------------------------------
// Store: one poller shared by the badge, the hover card and the page.

type Snapshot = { data: UsageResponse | null; error: string | null; fetchedAt: number };

let snapshot: Snapshot = { data: null, error: null, fetchedAt: 0 };
const listeners = new Set<() => void>();
let sdkRef: Sdk | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let inflight: Promise<void> | null = null;

function emit(next: Snapshot) {
  snapshot = next;
  for (const fn of listeners) fn();
}

function load(refresh = false): Promise<void> {
  if (!sdkRef) return Promise.resolve();
  if (inflight) return inflight;
  const sdk = sdkRef;
  inflight = sdk.system
    .usageLimits(refresh ? { refresh: true } : undefined)
    .then(
      (data) => emit({ data, error: null, fetchedAt: Date.now() }),
      (err: unknown) =>
        emit({
          ...snapshot,
          error: err instanceof Error ? err.message : String(err),
          fetchedAt: Date.now(),
        }),
    )
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (listeners.size === 1) {
    void load();
    timer = setInterval(() => void load(), POLL_MS);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function useUsage(): Snapshot {
  sdkRef = useSdk();
  return useSyncExternalStore(subscribe, () => snapshot);
}

// ---------------------------------------------------------------------------
// Helpers

function windowsOf(p: ProviderUsage): Window[] {
  return p.status === "ok" ? (p.windows as Window[]) : [];
}

function allWindows(data: UsageResponse | null): Window[] {
  return data ? Object.values(data).flatMap(windowsOf) : [];
}

function toneFor(pct: number): "neutral" | "warning" | "critical" {
  if (pct >= CRITICAL_AT) return "critical";
  if (pct >= WARN_AT) return "warning";
  return "neutral";
}

const TONE_COLOR = {
  neutral: "var(--primary, #22c55e)",
  warning: "#f59e0b",
  critical: "#ef4444",
} as const;

function resetsIn(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "resetting";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `resets in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `resets in ${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `resets in ${days}d ${hours % 24}h`;
}

function statusText(p: ProviderUsage): string | null {
  switch (p.status) {
    case "ok":
      return p.windows.length ? null : "No limits reported";
    case "not_installed":
      return "Not installed";
    case "unauthenticated":
      return "Not signed in";
    case "expired":
      return "Sign-in expired";
    case "error":
      return p.message;
    default:
      return null;
  }
}

function useProviderName(): (id: string) => string {
  const { providers } = experimental_useProviders();
  return (id) => providers.find((p) => p.id === id)?.displayName ?? id;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// ---------------------------------------------------------------------------
// Shared body: provider sections with one bar per window.

const mutedStyle: CSSProperties = { color: "var(--muted-foreground)" };

function Bar({ pct, height }: { pct: number; height: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      style={{
        height,
        borderRadius: 9999,
        background: "var(--muted, rgba(127,127,127,.2))",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${clamped}%`,
          height: "100%",
          borderRadius: 9999,
          background: TONE_COLOR[toneFor(pct)],
        }}
      />
    </div>
  );
}

function UsageBody({ large = false }: { large?: boolean }) {
  const { data, error } = useUsage();
  const name = useProviderName();
  const now = useNow(30_000);

  if (!data) {
    return <div style={mutedStyle}>{error ? `Couldn't load usage: ${error}` : "Loading…"}</div>;
  }
  // Providers that aren't installed (Cursor via ACP, say) have nothing to show.
  const entries = Object.entries(data).filter(([, p]) => p.status !== "not_installed");
  if (!entries.length) return <div style={mutedStyle}>No providers report usage.</div>;

  return (
    <div style={{ display: "grid", gap: large ? 20 : 10 }}>
      {entries.map(([id, p]) => {
        const plan = "planLabel" in p && typeof p.planLabel === "string" ? p.planLabel : null;
        const windows = windowsOf(p);
        const note = statusText(p);
        return (
          <section key={id} style={{ display: "grid", gap: large ? 10 : 6 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: large ? 15 : 13 }}>{name(id)}</span>
              {plan && <span style={{ ...mutedStyle, fontSize: large ? 12 : 11 }}>{plan}</span>}
            </div>
            {note && <div style={mutedStyle}>{note}</div>}
            {windows.map((w) => {
              const reset = resetsIn(w.resetsAt, now);
              return (
                <div key={w.label} style={{ display: "grid", gap: 3 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{w.label}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                      {Math.round(w.usedPercent)}%
                    </span>
                  </div>
                  <Bar pct={w.usedPercent} height={large ? 8 : 5} />
                  {reset && <div style={{ ...mutedStyle, fontSize: large ? 12 : 11 }}>{reset}</div>}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rail badge: quiet until a window crosses WARN_AT.

function useUsageBadge() {
  const { data } = useUsage();
  const name = useProviderName();
  if (!data) return null;
  let worst = 0;
  const parts: string[] = [];
  for (const [id, p] of Object.entries(data)) {
    for (const w of windowsOf(p)) {
      if (w.usedPercent >= WARN_AT) parts.push(`${name(id)} ${w.label} ${Math.round(w.usedPercent)}%`);
      worst = Math.max(worst, w.usedPercent);
    }
  }
  const tone = toneFor(worst);
  if (tone === "neutral") return null;
  return { tone, label: parts.join(", ") };
}

// ---------------------------------------------------------------------------
// Hover card over the rail item.

function useHoveredItem(itemId: string): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const selector = `[data-nav-rail-item="${CSS.escape(itemId)}"], [data-sidebar-navigation-item="${CSS.escape(itemId)}"]`;
    let anchor: Element | null = null;
    let delay: number | undefined;
    const hide = () => {
      window.clearTimeout(delay);
      anchor = null;
      setRect(null);
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const target = event.target instanceof Element ? event.target : null;
      const next = target?.closest(selector) ?? null;
      if (next === anchor) return;
      window.clearTimeout(delay);
      anchor = next;
      setRect(null);
      if (!next) return;
      if (Date.now() - snapshot.fetchedAt > HOVER_STALE_MS) void load(true);
      delay = window.setTimeout(() => {
        if (next.isConnected) setRect(next.getBoundingClientRect());
      }, HOVER_DELAY_MS);
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(delay);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, [itemId]);
  return rect;
}

const cardStyle: CSSProperties = {
  position: "fixed",
  // Above bb's own tooltip for the item, which would otherwise just say "Usage".
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

function UsageHoverCard() {
  const pluginId = experimental_usePluginId();
  const rect = useHoveredItem(`${pluginId}/${PANEL_ID}`);
  const { data } = useUsage();
  if (!rect) return null;

  const estimatedHeight = 40 + allWindows(data).length * 44 + (data ? Object.keys(data).length : 1) * 28;
  const top = Math.max(8, Math.min(rect.top - 6, window.innerHeight - estimatedHeight - 8));
  const left = rect.right + 8 + CARD_WIDTH < window.innerWidth ? rect.right + 8 : Math.max(8, rect.left - CARD_WIDTH - 8);

  return (
    <div style={{ ...cardStyle, top, left }} role="tooltip">
      <UsageBody />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full page.

function UsagePage() {
  const { fetchedAt } = useUsage();
  const now = useNow(10_000);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    setBusy(true);
    void load(true).finally(() => setBusy(false));
  };
  return (
    <div style={{ height: "100%", overflowY: "auto" }} className="p-4 md:p-5">
      <div className="mx-auto w-full max-w-3xl space-y-4" style={{ fontSize: 13 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={mutedStyle}>
            {fetchedAt ? `Updated ${Math.max(0, Math.round((now - fetchedAt) / 1000))}s ago` : ""}
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            style={{
              padding: "4px 10px",
              borderRadius: "var(--radius, 6px)",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "inherit",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <UsageBody large />
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: PANEL_ID,
    title: "Usage",
    icon: "ChartColumn",
    path: PANEL_ID,
    component: UsagePage,
    experimental_useBadge: useUsageBadge,
  });

  app.slots.experimental_appOverlay({
    id: "usage-rail-hover",
    component: UsageHoverCard,
  });
});
