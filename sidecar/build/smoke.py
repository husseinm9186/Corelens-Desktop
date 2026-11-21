"""Prove a laid sidecar works the way Corelens runs it.

    python sidecar/build/smoke.py <laid python> resources/templates/ntc

Starts the interpreter from its own folder with the environment cleared,
as the collector does; imports every package with native code (an
interpreter that starts is not one whose wheels load); then speaks the
protocol: `hello`, a `parse` of ntc-templates' own `show ip arp` fixture
that must give as many rows as the fixture's expected output, and `quit`.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

NATIVE = "import cryptography.hazmat.bindings._rust, nacl.bindings, bcrypt, _cffi_backend, scrapli, paramiko, textfsm, ntc_templates"


def fail(msg: str) -> None:
    print(f"::error title=Sidecar smoke test::{msg}")
    sys.exit(1)


def main() -> None:
    python, templates = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    cwd = python.parent.parent if python.parent.name == "bin" else python.parent
    env = {"PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1"}
    if os.name == "nt":
        env["SYSTEMROOT"] = os.environ.get("SYSTEMROOT", r"C:\Windows")

    imp = subprocess.run([str(python), "-c", NATIVE], cwd=cwd, env=env, capture_output=True, text=True)
    if imp.returncode != 0:
        fail(f"a native module does not load: {imp.stderr.strip().splitlines()[-1:]}")

    tests = templates.parent / "tests" / "cisco_ios" / "show_ip_arp"
    raw = (tests / "cisco_ios_show_ip_arp.raw").read_text(encoding="utf-8")
    sample = (tests / "cisco_ios_show_ip_arp.yml").read_text(encoding="utf-8")
    expected = len(re.findall(r"^  - ", sample, re.M))
    if expected == 0:
        fail(f"the fixture under {tests} has no expected rows")

    requests = [
        {"op": "hello", "id": 1, "protocol": 1, "templates_dir": str(templates)},
        {"op": "parse", "id": 2, "os": "cisco_ios", "cmd": "show ip arp", "parser": "textfsm:cisco_ios_show_ip_arp", "raw": raw},
        {"op": "quit", "id": 3},
    ]
    stdin = "".join(json.dumps(r) + "\n" for r in requests)
    run = subprocess.run([str(python), "-m", "corelens_sidecar"], cwd=cwd, env=env, input=stdin, capture_output=True, text=True, timeout=120)
    replies = {}
    for line in run.stdout.splitlines():
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if "id" in msg:
            replies[msg["id"]] = msg
    hello, parsed = replies.get(1), replies.get(2)
    if not hello or hello.get("status") != "ok":
        fail(f"hello was not answered ok: {hello} {run.stderr.strip()[-400:]}")
    rows = (parsed or {}).get("rows")
    if not isinstance(rows, list) or len(rows) != expected:
        fail(f"parse gave {len(rows) if isinstance(rows, list) else rows} rows, the fixture expects {expected}: {parsed}")
    print(f"sidecar smoke test: native modules load, hello ok, parse gave {len(rows)} of {expected} rows")


if __name__ == "__main__":
    main()
