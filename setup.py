#!/usr/bin/env python3
"""
Luke's bb setup, for anyone who wants it. One command, safe to re-run:

  curl -fsSL https://raw.githubusercontent.com/lukehowlett97/bb-plugins/main/setup.py | python3 -

Add ` - --dry-run` to see what it would do first. It only ever *adds*:

  - installs each plugin below that you don't have yet. A plugin you already
    have, from any source and enabled or not, is left exactly as it is;
  - sets a recommended setting only while yours is still unset;
  - writes a starter AGENTS.md into bb's data dir only if you have none.

Nothing you've already chosen is overwritten. Run it again later to pick up
plugins added since; installed ones update with `bb plugin update --all`.

Needs the bb app running on this machine, and python3 (3.9+).
"""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys

REPO = "git:github.com/lukehowlett97/bb-plugins@main"

PLUGINS = [
    {"id": "focus-board", "source": "git:github.com/lukehowlett97/bb-plugin-focus-board@main",
     "about": "A board of your threads by status, with feature groups for workstreams"},
    {"id": "genui", "source": "git:https://github.com/ComicBit/bb-plugin-genui.git@semver:>=0.3.0 <1.0.0",
     "about": "Agents answer with live UI (tables, charts, plans, buttons) instead of walls of text"},
    {"id": "prompt-pin", "source": REPO, "plugin": "prompt-pin",
     "about": "Pins your latest prompt at the top of the thread while you read the reply"},
    {"id": "thread-days", "source": REPO, "plugin": "thread-days",
     "about": "Newest 10 threads in the sidebar, with a divider where each earlier day starts"},
    {"id": "thread-dots", "source": REPO, "plugin": "thread-dots",
     "about": "Coloured dots instead of spinners: unopened, working, cache hot, cache cold"},
    {"id": "usage-rail", "source": REPO, "plugin": "usage-rail",
     "about": "Claude Code and Codex usage limits on the navigation rail"},
]

SETTINGS_IF_UNSET = {"defaultProviderId": "claude-code"}

STARTER_AGENTS = """\
# Workstreams

My threads belong to workstreams, shown as feature groups on the Focus Board
(`bb focus-board group list`).

- Early in a thread, once its subject is clear, put it in the matching group with
  `focus_board_group_set` (or `bb focus-board group add "<group>" "$BB_THREAD_ID"`).
  Judge by what the thread is about, not by its title.
- If no group fits, leave the thread ungrouped. Don't create a new group yourself;
  if this looks like a new workstream, suggest one to me instead.
- When I agree to a new workstream, create the group and add this thread in the
  same step (`bb focus-board group create "<name>"` then `group add` straight
  away): bb deletes a group that has no threads in it.
- If the work moves to a different workstream, move the thread
  (`bb focus-board group move`) or suggest starting a new thread there.
"""


def bb_cmd():
    return os.environ.get("BB_CLI") or shutil.which("bb")


def bb(*args):
    return subprocess.run([bb_cmd(), *args], capture_output=True, text=True)


def bb_json(*args):
    res = bb(*args, "--json")
    if res.returncode != 0:
        raise RuntimeError((res.stdout + res.stderr).strip())
    return json.loads(res.stdout)


def install_args(p):
    args = ["plugin", "install", p["source"], "--yes"]
    if p.get("plugin"):
        args += ["--plugin", p["plugin"]]
    return args


def run(dry_run):
    if not bb_cmd():
        sys.exit("bb isn't installed (no `bb` on PATH). Install the bb app first, then run this again.")
    try:
        installed = {p["id"] for p in bb_json("plugin", "list")["plugins"]}
        settings = bb_json("settings", "show")
    except (RuntimeError, json.JSONDecodeError) as e:
        sys.exit(f"Couldn't reach bb. Is the app running?\n  {e}")

    added, skipped, failed = [], [], []
    verb = "would install" if dry_run else "installing"

    for p in PLUGINS:
        if p["id"] in installed:
            skipped.append(p["id"])
            continue
        print(f"  {verb} {p['id']} — {p['about']}", flush=True)
        if dry_run:
            added.append(p["id"])
            continue
        res = bb(*install_args(p))
        if res.returncode == 0:
            added.append(p["id"])
        else:
            failed.append(p["id"])
            lines = (res.stdout + res.stderr).strip().splitlines()
            print(f"    ! failed: {lines[-1] if lines else '(no output)'}")

    general = settings.get("generalSettings", {})
    for key, value in SETTINGS_IF_UNSET.items():
        if general.get(key) in (None, ""):
            print(f"  {'would set' if dry_run else 'setting'} {key} = {value}")
            if not dry_run:
                res = bb("settings", "general", key, str(value))
                if res.returncode != 0:
                    print(f"    ! couldn't set {key}: {(res.stdout + res.stderr).strip()}")

    data_dir = settings.get("dataDir")
    if data_dir:
        target = pathlib.Path(data_dir) / "AGENTS.md"
        if not target.exists():
            print(f"  {'would write' if dry_run else 'writing'} a starter {target} (workstreams on the Focus Board)")
            if not dry_run:
                target.write_text(STARTER_AGENTS)

    print()
    if skipped:
        print(f"Already had: {', '.join(skipped)}")
    if added:
        print(f"{'Would add' if dry_run else 'Added'}: {', '.join(added)}")
    if not added and not failed:
        print("Nothing to add — you're up to date.")
    if failed:
        print(f"Failed: {', '.join(failed)}. Run this again to retry, or `bb plugin install-jobs` to see why.")
        return 1
    if added and not dry_run:
        print("Done. Plugins update with `bb plugin update --all`.")
    return 0


def main():
    ap = argparse.ArgumentParser(
        prog="setup.py",
        description="Install Luke's bb plugins and starter config. Only adds; never overwrites.",
    )
    ap.add_argument("--dry-run", action="store_true", help="show what would change, change nothing")
    ap.add_argument("--list", action="store_true", help="list the plugins and exit")
    args = ap.parse_args()
    if args.list:
        for p in PLUGINS:
            print(f"  {p['id']:<14} {p['about']}")
        return 0
    return run(args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
