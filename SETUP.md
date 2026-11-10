# Set up bb like Luke's

Instructions for an agent (Claude, Codex) running inside bb or on the same machine.
The person asked you to set up their bb with Luke's plugins and starter config.
Follow these steps. **Only add; never change or remove anything they already have.**

## 1. Check bb is reachable

Run `bb plugin list --json`. If `bb` isn't found or the server doesn't answer, stop
and tell them to open the bb app first.

## 2. Work out the plan and confirm it

Compare their installed plugin ids with this list. Skip any id they already have,
whatever its source and whether or not it's enabled.

| id | What it does | Install command |
|---|---|---|
| `focus-board` | A board of your threads by status, with feature groups for workstreams | `bb plugin install git:github.com/lukehowlett97/bb-plugin-focus-board@main --yes` |
| `genui` | Agents answer with live UI (tables, charts, plans, buttons) instead of walls of text | `bb plugin install "git:https://github.com/ComicBit/bb-plugin-genui.git@semver:>=0.3.0 <1.0.0" --yes` |
| `prompt-pin` | Pins your latest prompt at the top of the thread while you read the reply | `bb plugin install git:github.com/lukehowlett97/bb-plugins@main --plugin prompt-pin --yes` |
| `thread-days` | Newest 10 threads in the sidebar, with a divider where each earlier day starts | `bb plugin install git:github.com/lukehowlett97/bb-plugins@main --plugin thread-days --yes` |
| `thread-dots` | Coloured dots instead of spinners: unopened, working, cache hot, cache cold | `bb plugin install git:github.com/lukehowlett97/bb-plugins@main --plugin thread-dots --yes` |
| `usage-rail` | Claude Code and Codex usage limits on the navigation rail | `bb plugin install git:github.com/lukehowlett97/bb-plugins@main --plugin usage-rail --yes` |

Also check, with `bb settings show --json`:

- `generalSettings.defaultProviderId`: if it's empty or null, plan to set it with
  `bb settings general defaultProviderId claude-code`. If it's set, leave it.
- `dataDir`: if `<dataDir>/AGENTS.md` doesn't exist, plan to write the starter from
  https://raw.githubusercontent.com/lukehowlett97/bb-plugins/main/starter/AGENTS.md
  (it asks agents to file threads into Focus Board groups). If it exists, leave it.

Show them the plan in one short list: what you'll add, and what they already have.
Ask once whether to go ahead. If everything is already there, say so and stop.

## 3. Do it

Run the install commands one at a time. Each one downloads and builds the plugin,
so it can take up to a minute. If one fails, note the error and carry on with the
rest; `bb plugin install-jobs` shows recent installs. Then apply the setting and
the AGENTS.md, if planned.

## 4. Report

Say what was added, what was skipped, and anything that failed. Then tell them:

- the new plugins show up straight away (they may need to reload the bb window);
- **Focus Board** is in the left sidebar; **Usage** is on the left rail;
- to update later, ask you to "update my bb plugins" (`bb plugin update --all`),
  and to pick up anything Luke adds, ask you to run this setup again;
- to remove one, Settings → Plugins, or `bb plugin remove <id>`;
- optionally, Luke's theme is `bb theme set gruvbox`.
