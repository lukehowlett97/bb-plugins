// bb-plugin-thread-days — trims the sidebar's Threads group and marks the days.
//
// - Only the newest `limit` (default 10) top-level threads show; a "See more"
//   button under the group reveals the rest, "See less" folds them away. The
//   open thread always stays visible. The choice persists in localStorage.
// - A thin dated divider ("Yesterday", "Sat 31 Oct") sits above the first
//   thread of each earlier day, using the thread's updated time.
//
// How it fits together:
// - App overlay: reads the live thread list and the limit setting and
//   publishes them to module state.
// - Content script: watches the sidebar DOM. bb renders each top-level row of
//   a group as a [data-sidebar-windowed-item] wrapper (a placeholder when it is
//   scrolled out of view). We never move bb's nodes: hiding and dividers are
//   attributes styled by our stylesheet, and the only node we add is the
//   button, placed after the group rather than inside bb's list.
import { useEffect } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreads,
  useSettings,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

const GROUP_SELECTOR = '[data-sidebar-visibility-group="threads"]';
const ITEM_SELECTOR = "[data-sidebar-windowed-item]";
const ROW_SELECTOR = "a[data-sidebar-thread-id]";
const HIDDEN_ATTR = "data-thread-days-hidden";
const LABEL_ATTR = "data-thread-days-label";
const BUTTON_ATTR = "data-thread-days-more";
const EXPANDED_KEY = "thread-days:expanded";
const DEFAULT_LIMIT = 10;

const CSS = `
[${HIDDEN_ATTR}] { display: none !important; }
[${LABEL_ATTR}]::before {
  content: attr(${LABEL_ATTR});
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 8px 2px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: .02em;
  color: var(--muted-foreground);
  pointer-events: none;
}
[${BUTTON_ATTR}] {
  display: block;
  width: calc(100% - 8px);
  margin: 2px 4px 4px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--radius, 6px);
  background: transparent;
  text-align: left;
  font: inherit;
  font-size: 12px;
  color: var(--muted-foreground);
  cursor: pointer;
}
[${BUTTON_ATTR}]:hover { background: var(--sidebar-accent, var(--accent)); color: var(--foreground); }
`;

// Shared between the overlay (which owns the data) and the content script
// (which owns the DOM). Both live in this bundle and the same window.
const state = {
  threads: new Map<string, PluginSidebarThread>(),
  limit: DEFAULT_LIMIT,
  expanded: readExpanded(),
  schedule: () => {},
};

function readExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeExpanded(value: boolean) {
  state.expanded = value;
  try {
    localStorage.setItem(EXPANDED_KEY, value ? "1" : "0");
  } catch {
    // Private mode or storage disabled: keep it for this window only.
  }
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayLabel(dayStart: number, todayStart: number): string {
  const days = Math.round((todayStart - dayStart) / 86_400_000);
  if (days === 1) return "Yesterday";
  const d = new Date(dayStart);
  const sameYear = d.getFullYear() === new Date(todayStart).getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// The thread a top-level item stands for: its first rendered row, or for a
// placeholder the first "threadId:projectId" token bb leaves for keyboard nav.
function itemThreadId(item: Element): string | null {
  const row = item.querySelector(ROW_SELECTOR);
  if (row) return row.getAttribute("data-sidebar-thread-id");
  const nav = item.getAttribute("data-sidebar-windowed-nav");
  return nav ? (nav.split(" ")[0]?.split(":")[0] ?? null) : null;
}

function topLevelItems(group: Element): Element[] {
  return Array.from(group.querySelectorAll(ITEM_SELECTOR)).filter((item) => {
    const outer = item.parentElement?.closest(ITEM_SELECTOR);
    return !outer || !group.contains(outer);
  });
}

function setAttr(el: Element, name: string, value: string | null) {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

function apply(button: HTMLButtonElement) {
  const group = document.querySelector(GROUP_SELECTOR);
  if (!group) {
    button.remove();
    return;
  }
  const items = topLevelItems(group);
  const todayStart = startOfDay(Date.now());
  let previousDay = todayStart;
  let hiddenCount = 0;

  items.forEach((item, index) => {
    const selected = item.querySelector("[data-sidebar-thread-selected]") !== null;
    const hide = !state.expanded && index >= state.limit && !selected;
    setAttr(item, HIDDEN_ATTR, hide ? "" : null);
    if (hide) {
      hiddenCount++;
      setAttr(item, LABEL_ATTR, null);
      return;
    }
    const id = itemThreadId(item);
    const thread = id ? state.threads.get(id) : undefined;
    let label: string | null = null;
    if (thread) {
      const day = startOfDay(thread.updatedAt);
      // Only mark a step back in time, so a custom sort never draws noise.
      if (day < previousDay) {
        label = dayLabel(day, todayStart);
        previousDay = day;
      }
    }
    setAttr(item, LABEL_ATTR, label);
  });

  const extra = items.length - state.limit;
  if (extra <= 0) {
    button.remove();
    return;
  }
  const text = state.expanded ? "See less" : `See more (${hiddenCount})`;
  if (button.textContent !== text) button.textContent = text;
  if (group.nextElementSibling !== button) group.after(button);
}

function SyncOverlay() {
  const { threads } = experimental_useSidebarThreads();
  const { values } = useSettings();

  useEffect(() => {
    state.threads = new Map((threads ?? []).map((t) => [t.id, t]));
    state.schedule();
  }, [threads]);

  useEffect(() => {
    const limit = values?.limit;
    state.limit = typeof limit === "number" && limit > 0 ? limit : DEFAULT_LIMIT;
    state.schedule();
  }, [values?.limit]);

  return null;
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "thread-days",
    mount: ({ signal }) => {
      const style = document.createElement("style");
      style.dataset.plugin = "thread-days";
      style.textContent = CSS;
      document.head.appendChild(style);

      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute(BUTTON_ATTR, "");
      button.addEventListener("click", () => {
        writeExpanded(!state.expanded);
        state.schedule();
      });

      let frame = 0;
      state.schedule = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          apply(button);
        });
      };
      const observer = new MutationObserver(state.schedule);
      observer.observe(document.body, { childList: true, subtree: true });
      // Day boundaries move at midnight even when nothing re-renders.
      const tick = window.setInterval(state.schedule, 60_000);
      state.schedule();

      const dispose = () => {
        observer.disconnect();
        window.clearInterval(tick);
        cancelAnimationFrame(frame);
        state.schedule = () => {};
        style.remove();
        button.remove();
        for (const el of Array.from(document.querySelectorAll(`[${HIDDEN_ATTR}], [${LABEL_ATTR}]`))) {
          el.removeAttribute(HIDDEN_ATTR);
          el.removeAttribute(LABEL_ATTR);
        }
      };
      signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  });

  app.slots.experimental_appOverlay({
    id: "thread-days-sync",
    component: SyncOverlay,
  });
});
