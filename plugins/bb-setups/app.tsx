// bb-plugin-bb-setups — frontend: a Themes page on the navigation rail.
//
// Yours: every theme bb knows (built-in, your custom ones, plugin themes), each
// drawn as a light and a dark swatch from its own colours. Click one to switch.
// The team's: themes shared on the bb setups Drop page, with Install and use.
// Swatches: custom and team themes from their theme.css (--canvas, --ink,
// --primary); built-ins from their code theme's editor colours.
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { definePluginApp, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { rpcContract, TeamTheme } from "./server";

const PAGE = "https://drop.measureprotocol.com/i/bb-setups/";
const BUILT_IN = ["default", "nord", "dracula", "solarized", "gruvbox", "catppuccin"];

type Sdk = ReturnType<typeof useSdk>;
type Resolved = Awaited<ReturnType<Sdk["theme"]["resolve"]>>;
type Swatch = { canvas: string; ink: string; primary: string };
type Pair = { light: Swatch; dark: Swatch };
type Mine = { id: string; label: string; source: "built-in" | "yours" | "plugin"; pair: Pair };

const FALLBACK: Pair = {
  light: { canvas: "#ffffff", ink: "#1f1f24", primary: "#3b5bdb" },
  dark: { canvas: "#18181b", ink: "#e6e6ea", primary: "#8ea2ff" },
};

// bb's built-in palettes (from the app bundle, bb 0.49). Their resolve() has no
// CSS, so the swatches come from here.
const BUILT_IN_PAIRS: Record<string, Pair> = {
  nord: { light: { canvas: "#eceff4", ink: "#2e3440", primary: "#5e81ac" }, dark: { canvas: "#2e3440", ink: "#d8dee9", primary: "#88c0d0" } },
  dracula: { light: { canvas: "#f8f8f2", ink: "#282a36", primary: "#7d5bbe" }, dark: { canvas: "#282a36", ink: "#f8f8f2", primary: "#bd93f9" } },
  solarized: { light: { canvas: "#fdf6e3", ink: "#073642", primary: "#268bd2" }, dark: { canvas: "#002b36", ink: "#93a1a1", primary: "#268bd2" } },
  gruvbox: { light: { canvas: "#fbf1c7", ink: "#3c3836", primary: "#076678" }, dark: { canvas: "#282828", ink: "#ebdbb2", primary: "#83a598" } },
  catppuccin: { light: { canvas: "#eff1f5", ink: "#4c4f69", primary: "#8839ef" }, dark: { canvas: "#1e1e2e", ink: "#cdd6f4", primary: "#cba6f7" } },
};

// ------------------------------------------------------------------ swatches
const usable = (v: string | undefined) => (v && !/var\(|color-mix|calc\(/.test(v) ? v.trim() : undefined);

export function pairFromCss(css: string): Pair {
  const light: Partial<Swatch> = {};
  const dark: Partial<Swatch> = {};
  const block = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = block.exec(css.replace(/\/\*[\s\S]*?\*\//g, "")))) {
    const sel = m[1];
    const target = /\.dark\b/.test(sel) ? dark : /:root|\.light\b/.test(sel) ? light : null;
    if (!target) continue;
    for (const k of ["canvas", "ink", "primary"] as const) {
      const v = usable(new RegExp(`--${k}\\s*:\\s*([^;]+);?`).exec(m[2])?.[1]);
      if (v && !target[k]) target[k] = v;
    }
  }
  return {
    light: { ...FALLBACK.light, ...light },
    dark: { ...FALLBACK.dark, ...dark },
  };
}

function pairFromResolved(r: Resolved): Pair {
  if (r.customCss) return pairFromCss(r.customCss);
  if (BUILT_IN_PAIRS[r.themeId]) return BUILT_IN_PAIRS[r.themeId];
  const files = r.resolvedCodeTheme?.files ?? {};
  const pick = (name: string, fb: Swatch): Swatch => {
    const colors = ((files[name] as { colors?: Record<string, string> } | undefined)?.colors ?? {}) as Record<string, string>;
    return {
      canvas: colors["editor.background"] ?? fb.canvas,
      ink: colors["editor.foreground"] ?? fb.ink,
      primary: colors["button.background"] ?? colors["focusBorder"] ?? colors["textLink.foreground"] ?? fb.primary,
    };
  };
  return { light: pick(r.resolvedCodeTheme?.light ?? "", FALLBACK.light), dark: pick(r.resolvedCodeTheme?.dark ?? "", FALLBACK.dark) };
}

// ------------------------------------------------------------------ styles
const muted: CSSProperties = { color: "var(--muted-foreground)", fontSize: 12.5 };
const h2: CSSProperties = { margin: "0 0 10px", fontSize: 15, fontWeight: 600 };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 };
const btn: CSSProperties = {
  padding: "5px 12px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  fontSize: 12.5,
  whiteSpace: "nowrap",
};
const btnPrimary: CSSProperties = { ...btn, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)" };

function Half({ s }: { s: Swatch }) {
  return (
    <div style={{ flex: 1, background: s.canvas, color: s.ink, padding: "10px 10px 8px", display: "grid", gap: 6 }}>
      <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1 }}>Aa</span>
      <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <span style={{ width: 22, height: 8, borderRadius: 4, background: s.primary }} />
        <span style={{ width: 30, height: 4, borderRadius: 2, background: s.ink, opacity: 0.35 }} />
      </span>
    </div>
  );
}

function Card(props: {
  pair: Pair;
  title: string;
  note: string;
  active?: boolean;
  onClick?: () => void;
  action?: React.ReactNode;
  tooltip?: string;
}) {
  const [hover, setHover] = useState(false);
  const clickable = !!props.onClick;
  return (
    <div
      title={props.tooltip}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: `1px solid ${props.active ? "var(--primary)" : hover && clickable ? "var(--input, var(--border))" : "var(--border)"}`,
        boxShadow: props.active ? "0 0 0 1px var(--primary)" : undefined,
        borderRadius: 10,
        overflow: "hidden",
        background: "var(--card, var(--background))",
      }}
    >
      <button
        type="button"
        onClick={props.onClick}
        disabled={!clickable}
        aria-pressed={clickable ? !!props.active : undefined}
        style={{ display: "flex", width: "100%", padding: 0, border: 0, cursor: clickable ? "pointer" : "default", background: "none" }}
      >
        <Half s={props.pair.light} />
        <Half s={props.pair.dark} />
      </button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{props.title}</div>
          <div style={{ ...muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{props.active ? "in use" : props.note}</div>
        </div>
        {props.action}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ page
function ThemesPage() {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const [active, setActive] = useState<string>("");
  const [mine, setMine] = useState<Mine[]>([]);
  const [team, setTeam] = useState<TeamTheme[] | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    const cat = await sdk.theme.catalog();
    setActive(cat.active.themeId);
    const ids: Array<[string, string, Mine["source"]]> = [
      ...BUILT_IN.map((id) => [id, id, "built-in"] as [string, string, Mine["source"]]),
      ...cat.custom.map((id) => [id, id, "yours"] as [string, string, Mine["source"]]),
      ...cat.plugins.map((p) => [p.id, p.name, "plugin"] as [string, string, Mine["source"]]),
    ];
    const out = await Promise.all(
      ids.map(async ([id, label, source]) => {
        try {
          return { id, label, source, pair: pairFromResolved(await sdk.theme.resolve({ themeId: id })) };
        } catch {
          return { id, label, source, pair: FALLBACK };
        }
      }),
    );
    setMine(out);
  }, [sdk]);

  const loadTeam = useCallback(async () => {
    const r = await rpc.call("teamThemes");
    setTeam(r.themes);
    setTeamError(r.error);
  }, [rpc]);

  useEffect(() => {
    void loadMine().catch((e: unknown) => setMessage(String(e)));
    void loadTeam().catch((e: unknown) => setTeamError(String(e)));
  }, [loadMine, loadTeam]);

  const use = async (id: string) => {
    setBusy(id);
    try {
      const t = await sdk.theme.set(id);
      setActive(t.themeId);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const install = async (t: TeamTheme) => {
    setBusy(t.id);
    setMessage(null);
    try {
      const r = await rpc.call("installTheme", { id: t.id });
      await sdk.theme.set(r.name);
      await loadMine();
      setMessage(r.already ? `${r.name} was already installed; switched to it.` : `Installed ${r.name} and switched to it.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    setBusy("share");
    try {
      await rpc.call("startShare", { kind: "theme" });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const installedName = (t: TeamTheme) => {
    const who = t.id.split("~")[1];
    return mine.find((m) => m.source === "yours" && (m.id === `${t.name}-${who}` || (m.id === t.name && pairFromCss(t.css).light.canvas === m.pair.light.canvas)))?.id;
  };

  const sections: Array<[string, Mine[]]> = [
    ["Yours", mine.filter((m) => m.source === "yours")],
    ["From plugins", mine.filter((m) => m.source === "plugin")],
    ["Built in", mine.filter((m) => m.source === "built-in")],
  ];

  return (
    <div style={{ height: "100%", overflowY: "auto" }} className="p-4 md:p-5">
      <div className="mx-auto w-full max-w-5xl" style={{ display: "grid", gap: 24, fontSize: 13 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Themes</h1>
            <p style={{ ...muted, margin: "4px 0 0" }}>Click a theme to switch to it. Left half light, right half dark.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={btn} disabled={busy === "share"} onClick={() => void share()}>
              {busy === "share" ? "Opening…" : "Share one of yours"}
            </button>
            <a href={PAGE} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: "none" }}>
              Open bb setups
            </a>
          </div>
        </div>

        {message && (
          <div role="status" style={{ padding: "8px 12px", borderRadius: 8, background: "var(--muted)", fontSize: 12.5 }}>
            {message}
          </div>
        )}

        {sections.map(([title, items]) =>
          items.length ? (
            <section key={title}>
              <h2 style={h2}>{title}</h2>
              <div style={grid}>
                {items.map((m) => (
                  <Card
                    key={m.id}
                    pair={m.pair}
                    title={m.label}
                    note={busy === m.id ? "switching…" : m.source === "yours" ? "custom" : m.source}
                    active={m.id === active}
                    onClick={() => void use(m.id)}
                  />
                ))}
              </div>
            </section>
          ) : null,
        )}

        <section>
          <h2 style={h2}>From the team</h2>
          {teamError && <p style={muted}>{teamError}</p>}
          {team === null && !teamError && <p style={muted}>Reading the bb setups page…</p>}
          {team && !team.length && <p style={muted}>Nobody has shared a theme yet.</p>}
          {team && team.length > 0 && (
            <div style={grid}>
              {team.map((t) => {
                const have = installedName(t);
                return (
                  <Card
                    key={t.id}
                    pair={pairFromCss(t.css)}
                    title={t.title}
                    note={`${t.author}${have ? ", installed" : ""}`}
                    tooltip={t.description || undefined}
                    active={!!have && have === active}
                    onClick={have ? () => void use(have) : undefined}
                    action={
                      have ? undefined : (
                        <button type="button" style={btnPrimary} disabled={!!busy} onClick={() => void install(t)}>
                          {busy === t.id ? "Installing…" : "Install and use"}
                        </button>
                      )
                    }
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "themes",
    title: "Themes",
    icon: "Palette",
    path: "themes",
    component: ThemesPage,
  });
});
