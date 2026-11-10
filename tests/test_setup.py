"""Tests for setup.py against a fake `bb` on BB_CLI."""
import json
import os
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent.parent
SCRIPT = HERE / "setup.py"
import importlib.util
_spec = importlib.util.spec_from_file_location("bbsetup", SCRIPT)
bbsetup = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bbsetup)

FAKE_BB = r'''#!/usr/bin/env python3
import json, os, sys
state = json.load(open(os.environ["FAKE_STATE"]))
args = sys.argv[1:]
with open(os.environ["FAKE_LOG"], "a") as f:
    f.write(json.dumps(args) + "\n")
if args[:2] == ["plugin", "list"]:
    print(json.dumps({"plugins": [{"id": i} for i in state["installed"]]}))
elif args[:2] == ["settings", "show"]:
    print(json.dumps({"generalSettings": state["general"], "dataDir": state["dataDir"]}))
elif args[:2] == ["plugin", "install"]:
    sys.exit(1 if args[2] in state.get("fail", []) else 0)
'''


def run(tmp_path, installed, general, extra=(), fail=()):
    data_dir = tmp_path / "bbdata"
    data_dir.mkdir(exist_ok=True)
    fake = tmp_path / "bb"
    fake.write_text(FAKE_BB)
    fake.chmod(0o755)
    state = tmp_path / "state.json"
    state.write_text(json.dumps({"installed": installed, "general": general,
                                 "dataDir": str(data_dir), "fail": list(fail)}))
    log = tmp_path / "log.jsonl"
    log.write_text("")
    env = {**os.environ, "BB_CLI": str(fake), "FAKE_STATE": str(state), "FAKE_LOG": str(log)}
    res = subprocess.run([sys.executable, str(SCRIPT), *extra], capture_output=True, text=True, env=env)
    calls = [json.loads(l) for l in log.read_text().splitlines()]
    return res, calls, data_dir


def team_ids():
    return [p["id"] for p in bbsetup.PLUGINS]


def test_installs_only_missing_plugins(tmp_path):
    res, calls, _ = run(tmp_path, installed=["focus-board", "genui"], general={"defaultProviderId": "codex"})
    assert res.returncode == 0, res.stderr
    installs = [c for c in calls if c[:2] == ["plugin", "install"]]
    installed_ids = {c[c.index("--plugin") + 1] for c in installs if "--plugin" in c}
    assert installed_ids == set(team_ids()) - {"focus-board", "genui"}
    assert all("--yes" in c for c in installs)


def test_never_overwrites_a_set_setting_or_existing_agents_md(tmp_path):
    (tmp_path / "bbdata").mkdir()
    (tmp_path / "bbdata" / "AGENTS.md").write_text("mine")
    res, calls, data_dir = run(tmp_path, installed=team_ids(), general={"defaultProviderId": "codex"})
    assert res.returncode == 0
    assert not [c for c in calls if c[:2] in (["plugin", "install"], ["settings", "general"])]
    assert (data_dir / "AGENTS.md").read_text() == "mine"
    assert "up to date" in res.stdout


def test_fills_unset_setting_and_writes_starter_agents_md(tmp_path):
    res, calls, data_dir = run(tmp_path, installed=team_ids(), general={"defaultProviderId": None})
    assert ["settings", "general", "defaultProviderId", "claude-code"] in calls
    assert "Workstreams" in (data_dir / "AGENTS.md").read_text()


def test_dry_run_changes_nothing(tmp_path):
    res, calls, data_dir = run(tmp_path, installed=[], general={}, extra=["--dry-run"])
    assert res.returncode == 0
    assert all(c[:2] in (["plugin", "list"], ["settings", "show"]) for c in calls)
    assert not (data_dir / "AGENTS.md").exists()
    assert "Would add" in res.stdout


def test_failed_install_exits_nonzero_and_continues(tmp_path):
    fail = [bbsetup.PLUGINS[0]["source"]]
    res, calls, _ = run(tmp_path, installed=[], general={}, fail=fail)
    assert res.returncode == 1
    assert len([c for c in calls if c[:2] == ["plugin", "install"]]) == len(team_ids())
    assert "Failed: focus-board" in res.stdout


def test_runs_when_piped_on_stdin(tmp_path):
    """The curl | python3 - path: no __file__ beside it, everything embedded."""
    res, calls, data_dir = run(tmp_path, installed=[], general={}, extra=["--dry-run"])
    piped = subprocess.run([sys.executable, "-", "--list"], input=SCRIPT.read_text(),
                           capture_output=True, text=True)
    assert piped.returncode == 0, piped.stderr
    assert "thread-dots" in piped.stdout
