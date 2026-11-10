# bb-plugins

Small bb plugins I use every day. Each one is an ordinary plugin directory under
`plugins/`, indexed by `.bb/plugins.json`.

| Plugin | What it does |
|---|---|
| `prompt-pin` | Pins your most recent prompt in a bubble at the top of the thread while you scroll through the reply. |
| `thread-days` | Shows the newest 10 threads in the sidebar with a See more toggle, and a dated divider where each earlier day starts. |
| `thread-dots` | Coloured dots instead of spinners in the thread list: unopened, working, cache hot, cache cold. |
| `usage-rail` | A Usage icon on the navigation rail: hover for Claude Code and Codex limits, click for the full page. |

## Install

One plugin:

```bash
bb plugin install git:github.com/lukehowlett97/bb-plugins@main --plugin thread-dots
```

At Measure, `bb-setup` (from measure-team-kit) installs all of them plus the team's
recommended plugins in one go.

Installs track `main`, so `bb plugin outdated` / `bb plugin update` pick up changes.

## Develop

```bash
cd plugins/<name>
npm install
bb plugin install path:$PWD   # once; then edit and `bb plugin reload <name>`
```
