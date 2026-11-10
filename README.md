# bb-plugins

My bb setup: the plugins I use every day, plus a one-command installer for anyone
who wants the same.

```bash
curl -fsSL https://raw.githubusercontent.com/lukehowlett97/bb-plugins/main/setup.py | python3 -
```

It installs the plugins below that you don't have yet, plus Focus Board and
Gen UI, sets Claude Code as your default provider if you haven't picked one, and
writes a starter `~/.bb/AGENTS.md` if you have none. **It only adds; nothing you
already have is changed.** Append ` - --dry-run` to see the plan first. Safe to
re-run.

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

Tests for the installer: `python3 -m pytest tests`.
