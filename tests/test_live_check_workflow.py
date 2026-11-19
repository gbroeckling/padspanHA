# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The hourly live check (.github/workflows/live-check.yml): the update
check, the licence server and the latest release's zip, probed from outside,
a failing run being the alert. Nothing secret in it, and its probe of the
update check is never counted as an install."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

_ROOT = Path(__file__).resolve().parents[1]
_WF = _ROOT / ".github" / "workflows" / "live-check.yml"
pytestmark = pytest.mark.skipif(not _WF.is_file(), reason="the workflow is not in this tree")


def _wf():
    return yaml.safe_load(_WF.read_text(encoding="utf-8"))


def test_it_runs_every_hour_and_by_hand():
    on = _wf()[True]   # YAML 1.1 reads the bare key `on` as True
    assert on["schedule"] == [{"cron": "23 * * * *"}] and "workflow_dispatch" in on


def test_it_needs_no_secret_and_can_only_read():
    text = _WF.read_text(encoding="utf-8")
    assert "secrets." not in text and "github.token" not in text and "GITHUB_TOKEN" not in text
    assert _wf()["permissions"] == {"contents": "read"}


def test_it_probes_the_three_things_an_install_reaches():
    runs = "\n".join(s.get("run", "") for s in _wf()["jobs"]["probe"]["steps"])
    assert "https://padspan.traks.ca/api/version.php?v=live-check" in runs
    assert "https://traks.ca/license/?action=validate&product=padspan" in runs
    assert "--data-urlencode \"key=PSPAN-0000-0000-0000-0000\"" in runs, "the key in the body, as PadSpan sends it"
    assert re.search(r"machine_h=0{64}\"", runs), "a made-up hashed id, never a real one"
    assert "releases/latest/download/padspan_ha.zip" in runs and "import aiohttp" in runs, "downloaded as HACS does"
    for later in _wf()["jobs"]["probe"]["steps"][1:]:
        assert later.get("if") == "${{ !cancelled() }}", "one failure still runs the other probes"


def test_the_probe_is_never_counted_as_an_install():
    php = (_ROOT / "server" / "version.php").read_text(encoding="utf-8")
    assert "if ($v !== 'live-check') {" in php
    i = php.index("if ($v !== 'live-check') {")
    assert php.index("file_put_contents($log_file", i) > i, "the ping log is written only for real installs"
    assert php.count("file_put_contents($log_file") == 1
