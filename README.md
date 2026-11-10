# bb-plugins

My bb setup: the plugins I use every day, and instructions any agent can follow
to give someone the same setup.

**To get it, ask your Claude (in a bb thread):**

> Set up my bb like Luke's: follow https://raw.githubusercontent.com/lukehowlett97/bb-plugins/main/SETUP.md

It shows you the plan, asks once, installs the plugins you don't have yet (these
four plus Focus Board and Gen UI), and writes a starter `~/.bb/AGENTS.md` if you
have none. **It only adds; nothing you already have is changed.** Ask again later
to pick up anything new.

## The plugins in this repo

Each one is an ordinary plugin directory under `plugins/`, indexed by
`.bb/plugins.json`.

| Plugin | What it does |
|---|---|
| `prompt-pin` | Pins your most recent prompt in a bubble at the top of the thread while you scroll through the reply. |
| `thread-days` | Shows the newest 10 threads in the sidebar with a See more toggle, and a dated divider where each earlier day starts. |
| `thread-dots` | Coloured dots instead of spinners in the thread list: unopened, working, cache hot, cache cold. |
| `usage-rail` | A Usage icon on the navigation rail: hover for Claude Code and Codex limits, click for the full page. |

## Install just one


```bash
bb plugin install git:github.com/lukehowlett97/bb-plugins@main --plugin thread-dots
```

Installs track `main`, so `bb plugin outdated` / `bb plugin update` pick up changes.

## Develop

```bash
cd plugins/<name>
npm install
bb plugin install path:$PWD   # once; then edit and `bb plugin reload <name>`
```
