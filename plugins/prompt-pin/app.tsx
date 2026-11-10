// bb-plugin-prompt-pin — a sticky header for the transcript: while you read a
// reply, a bubble at the top of the thread shows the prompt that reply answers.
// It changes as you scroll from one turn into the next.
//
// bb has no slot at the top of the transcript, so this is an app overlay that
// draws a fixed-position bubble over the transcript's scroll area:
// - Data: sdk.threads.timeline() returns the thread's rows in transcript
//   order. We index every row id, and note which rows are user prompts.
//   Refetched whenever a turn starts or ends, or the page shows a row we
//   don't know yet.
// - Placement: the transcript list is [data-timeline-items]; its nearest
//   scrolling ancestor is the area we pin to. Each rendered row carries
//   [data-timeline-row-id]. The topmost visible row's nearest preceding user
//   prompt is the one we show — unless that prompt is itself the top row.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreads,
  useBbContext,
  useSdk,
} from "@get-bb/plugin-sdk/app";

type Prompt = { rowId: string; seq: number | null; text: string; images: number };

/** Row id → index in transcript order, plus each index's governing prompt. */
type TimelineIndex = {
  order: Map<string, number>;
  /** promptAt[i] is the latest user prompt at or before row i, or null. */
  promptAt: (Prompt | null)[];
};

const ITEMS_SELECTOR = "[data-timeline-items]";
const ROW_ATTR = "data-timeline-row-id";

type TimelineRow = {
  id?: unknown;
  kind?: unknown;
  role?: unknown;
  initiator?: unknown;
  text?: unknown;
  messageSeq?: unknown;
  attachments?: { localImages?: unknown; webImages?: unknown } | null;
};

function asPrompt(row: TimelineRow): Prompt | null {
  if (
    row.kind !== "conversation" ||
    row.role !== "user" ||
    row.initiator !== "user" ||
    typeof row.id !== "string" ||
    typeof row.text !== "string"
  ) {
    return null;
  }
  const images =
    (typeof row.attachments?.localImages === "number" ? row.attachments.localImages : 0) +
    (typeof row.attachments?.webImages === "number" ? row.attachments.webImages : 0);
  return {
    rowId: row.id,
    seq: typeof row.messageSeq === "number" ? row.messageSeq : null,
    text: row.text.trim(),
    images,
  };
}

function buildIndex(rows: readonly unknown[]): TimelineIndex {
  const order = new Map<string, number>();
  const promptAt: (Prompt | null)[] = [];
  let current: Prompt | null = null;
  rows.forEach((raw, i) => {
    const row = raw as TimelineRow;
    current = asPrompt(row) ?? current;
    if (typeof row.id === "string") order.set(row.id, i);
    promptAt.push(current);
  });
  return { order, promptAt };
}

function useTimelineIndex(threadId: string | null) {
  const sdk = useSdk();
  const { threads } = experimental_useSidebarThreads();
  const thread = threadId ? threads.find((t) => t.id === threadId) : undefined;
  const [index, setIndex] = useState<TimelineIndex | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const lastRefresh = useRef(0);

  useEffect(() => {
    setIndex(null);
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    const controller = new AbortController();
    sdk.threads
      .timeline({ threadId, deferContent: "true", signal: controller.signal })
      .then(
        (result) => {
          if (!controller.signal.aborted) {
            setIndex(buildIndex(result.rows as readonly unknown[]));
          }
        },
        () => {
          /* aborted or unavailable: leave the bubble hidden */
        },
      );
    return () => controller.abort();
  }, [sdk, threadId, thread?.status, thread?.latestAttentionAt, refreshKey]);

  // Called when the page shows a row the index lacks (new output streamed in).
  // Throttled so a burst of unknown rows costs one fetch.
  const requestRefresh = () => {
    const now = Date.now();
    if (now - lastRefresh.current < 10_000) return;
    lastRefresh.current = now;
    setRefreshKey((k) => k + 1);
  };

  return { index, requestRefresh };
}

const PANE_THREAD_PATTERN = /\/t\/(thr_[\w-]+)(?:\/|$)/;

function paneThreadIdFromLocation(): string | null {
  return PANE_THREAD_PATTERN.exec(window.location.pathname)?.[1] ?? null;
}

/** The route's thread, or the thread open in a plugin pane (Focus Board). */
function useActiveThreadId(): string | null {
  const { threadId } = useBbContext();
  const [paneThreadId, setPaneThreadId] = useState(paneThreadIdFromLocation);

  useEffect(() => {
    if (threadId) return;
    // bb's router pushes history without a popstate, so poll as well.
    const sync = () => setPaneThreadId(paneThreadIdFromLocation());
    sync();
    window.addEventListener("popstate", sync);
    const poll = window.setInterval(sync, 500);
    return () => {
      window.removeEventListener("popstate", sync);
      window.clearInterval(poll);
    };
  }, [threadId]);

  return threadId ?? paneThreadId;
}

function scrollParent(el: Element): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

type Placement = {
  top: number;
  left: number;
  width: number;
  items: Element;
  scroller: HTMLElement;
};

// The main transcript is the widest timeline whose scroller is the tallest;
// embedded timelines (sub-agents, side panels) are smaller.
function findPlacement(): Placement | null {
  let best: { area: number; placement: Placement } | null = null;
  for (const items of document.querySelectorAll(ITEMS_SELECTOR)) {
    const scroller = scrollParent(items);
    if (!scroller) continue;
    const s = scroller.getBoundingClientRect();
    const i = items.getBoundingClientRect();
    if (s.height < 200 || i.width < 200) continue;
    const area = s.height * i.width;
    if (!best || area > best.area) {
      const width = Math.min(i.width, 760);
      best = {
        area,
        placement: {
          top: s.top + 10,
          left: i.left + (i.width - width) / 2,
          width,
          items,
          scroller,
        },
      };
    }
  }
  return best?.placement ?? null;
}

/** Top-level rows of the main transcript in DOM order (nested timelines excluded). */
function* mainRows(items: Element): Generator<Element> {
  for (const row of items.querySelectorAll(`[${ROW_ATTR}]`)) {
    if (row.closest(ITEMS_SELECTOR) === items) yield row;
  }
}

type Resolution =
  | { kind: "prompt"; prompt: Prompt }
  | { kind: "none" }
  | { kind: "unknown" };

function resolvePrompt(placement: Placement, index: TimelineIndex): Resolution {
  const top = placement.scroller.getBoundingClientRect().top;
  for (const row of mainRows(placement.items)) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom <= top + 4) continue; // scrolled past
    const id = row.getAttribute(ROW_ATTR) ?? "";
    const at = index.order.get(id);
    if (at === undefined) continue; // a group/synthetic row; try the next one
    const prompt = index.promptAt[at];
    // The prompt row itself is the top row: it's on screen, no bubble needed.
    if (!prompt || prompt.rowId === id) return { kind: "none" };
    return { kind: "prompt", prompt };
  }
  return { kind: "unknown" };
}

type View = { placement: Placement; prompt: Prompt } | null;

function useView(index: TimelineIndex | null, requestRefresh: () => void): View {
  const [view, setView] = useState<View>(null);
  const refreshRef = useRef(requestRefresh);
  refreshRef.current = requestRefresh;

  useEffect(() => {
    if (!index) {
      setView(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const placement = findPlacement();
        const resolution = placement ? resolvePrompt(placement, index) : null;
        if (resolution?.kind === "unknown") refreshRef.current();
        const next =
          placement && resolution?.kind === "prompt"
            ? { placement, prompt: resolution.prompt }
            : null;
        setView((previous) => {
          if (
            previous &&
            next &&
            previous.prompt.rowId === next.prompt.rowId &&
            previous.placement.top === next.placement.top &&
            previous.placement.left === next.placement.left &&
            previous.placement.width === next.placement.width &&
            previous.placement.scroller === next.placement.scroller
          ) {
            return previous;
          }
          return next;
        });
      });
    };
    measure();
    document.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    // Rows mount and the layout settles without scroll events (route changes,
    // panels opening, streaming output); a slow poll keeps up with those.
    const poll = window.setInterval(measure, 1000);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      window.clearInterval(poll);
    };
  }, [index]);
  return view;
}

// bb's menus and popovers are z-50, but the app overlay layer sits above them,
// so no z-index on the bubble puts it underneath. Instead the bubble steps
// aside (fades out, lets clicks through) while an open one overlaps it.
const FLOATING_SELECTOR =
  "[data-radix-popper-content-wrapper], [role='menu'], [role='listbox'], [role='dialog']";

function overlapsFloating(bubble: HTMLElement): boolean {
  const b = bubble.getBoundingClientRect();
  for (const el of document.querySelectorAll(FLOATING_SELECTOR)) {
    if (bubble.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) {
      return true;
    }
  }
  return false;
}

function useCovered(bubble: HTMLElement | null): boolean {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (!bubble) {
      setCovered(false);
      return;
    }
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCovered(overlapsFloating(bubble)));
    };
    check();
    // Menus portal in and out of the DOM; watch for that rather than polling.
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [bubble]);
  return covered;
}

const bubbleStyle: CSSProperties = {
  position: "fixed",
  zIndex: 40,
  boxSizing: "border-box",
  padding: "8px 14px",
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "color-mix(in oklab, var(--muted, #333) 92%, transparent)",
  backdropFilter: "blur(8px)",
  color: "var(--foreground)",
  boxShadow: "var(--shadow-md, 0 8px 24px rgba(0,0,0,.25))",
  fontFamily: "var(--font-sans, inherit)",
  fontSize: 13,
  lineHeight: 1.45,
  cursor: "pointer",
  textAlign: "left",
};

function PromptPin() {
  const threadId = useActiveThreadId();
  const { index, requestRefresh } = useTimelineIndex(threadId);
  const view = useView(index, requestRefresh);
  const [expanded, setExpanded] = useState(false);
  const [bubble, setBubble] = useState<HTMLDivElement | null>(null);
  const covered = useCovered(bubble);

  useEffect(() => setExpanded(false), [view?.prompt.rowId]);

  if (!view) return null;
  const { placement, prompt } = view;
  const text = prompt.text || (prompt.images ? "(image)" : "");
  if (!text) return null;

  const jump = () => {
    const row = placement.scroller.querySelector(
      `[${ROW_ATTR}="${CSS.escape(prompt.rowId)}"]`,
    );
    if (row) {
      row.scrollIntoView({ block: "start", behavior: "smooth" });
    } else if (prompt.seq !== null) {
      // bb's message links use #msg=<seq>; let the router bring the row in.
      window.location.hash = `msg=${prompt.seq}`;
    }
  };

  return (
    <div
      ref={setBubble}
      role="button"
      tabIndex={0}
      title="The prompt this reply answers. Click to jump to it; hover to expand."
      onClick={jump}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          jump();
        }
      }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={{
        ...bubbleStyle,
        top: placement.top,
        left: placement.left,
        width: placement.width,
        opacity: covered ? 0 : 1,
        pointerEvents: covered ? "none" : undefined,
        transition: "opacity 120ms",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 2 }}>
        You asked
        {prompt.images ? ` · ${prompt.images} image${prompt.images === 1 ? "" : "s"}` : ""}
      </div>
      <div
        style={
          expanded
            ? { maxHeight: "40vh", overflowY: "auto", whiteSpace: "pre-wrap" }
            : {
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                whiteSpace: "pre-wrap",
              }
        }
      >
        {text}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "prompt-pin", component: PromptPin });
});
