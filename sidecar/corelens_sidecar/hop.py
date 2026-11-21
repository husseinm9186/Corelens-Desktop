"""Reaching a device through another device's own SSH.

The collector's side of what the classic crawler does in
`crates/corelens-discover/src/hop.rs`: log in to a device, run *its* `ssh`
to the next one, answer the fingerprint question, type the password at the
next device's own prompt and know when the login has landed or why it
failed. The same rules, ported line for line so the two engines agree:

- The command is one of the four spellings Rust builds (`HopDialect` in
  hop.rs) — OpenSSH told to keep no known_hosts, `ssh user@host`,
  Cisco's `ssh -l user host`, FortiOS's `execute ssh user@host` — with a
  user and an address of plain characters. Anything else is refused before
  a byte reaches the device, as the allowlist refuses a command.
- The password is sent only once the next device asks for it, never echoed.
- A failure is reported as a class ("rejected", "unreachable", …), never
  as a quote of the device.
"""
from __future__ import annotations

import re
from typing import Optional

from .session_errors import SessionError

_TOKEN = r"[A-Za-z0-9._\-]+"
_ADDRESS = r"[A-Za-z0-9.:\-]+"
_OPENSSH = (
    "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o GlobalKnownHostsFile=/dev/null "
    "-o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no "
    "-o NumberOfPasswordPrompts=1 "
)
HOP_COMMAND = re.compile(
    "^(?:"
    + re.escape(_OPENSSH) + f"{_TOKEN}@{_ADDRESS}"
    + f"|ssh {_TOKEN}@{_ADDRESS}"
    + f"|ssh -l {_TOKEN} {_ADDRESS}"
    + f"|execute ssh {_TOKEN}@{_ADDRESS}"
    + ")$"
)

DESCRIBE = {
    "rejected": "the next device rejected the login",
    "unreachable": "the next device could not be reached from the one before it",
    "unresolved": "the next device's name did not resolve on the device before it",
    "no client": "the device before it has no usable ssh client",
    "host key": "the next device's host key could not be accepted",
}

_REJECTED = ("permission denied", "access denied", "authentication failed", "too many authentication failures", "login incorrect")
_UNREACHABLE = ("connection refused", "connection timed out", "no route to host", "network is unreachable", "connection closed", "operation timed out", "unable to connect")
_UNRESOLVED = ("could not resolve", "name or service not known", "nodename nor servname", "name does not resolve")
_NO_CLIENT = ("command not found", "ssh: not found", "unknown command", "invalid input", "% unknown", "bad command")
_HOST_KEY = ("host key verification failed", "no matching host key", "remote host identification has changed")

_ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][A-Za-z0-9]|\x1b[=>]")


class HopFailed(SessionError):
    pass


def check_hop_command(cmd: str) -> str:
    """The command, if it is one of the spellings a hop may send."""
    if not isinstance(cmd, str) or not HOP_COMMAND.match(cmd):
        raise SessionError("refused", "a hop command must be one of the ssh forms Corelens builds")
    return cmd


def readable(text: str) -> str:
    return _ANSI.sub("", text).replace("\r", "")


def _failure_in(low: str) -> Optional[str]:
    if any(m in low for m in _REJECTED):
        return "rejected"
    if any(m in low for m in _UNRESOLVED):
        return "unresolved"
    if any(m in low for m in _HOST_KEY):
        return "host key"
    if any(m in low for m in _UNREACHABLE):
        return "unreachable"
    if any(m in low for m in _NO_CLIENT):
        return "no client"
    return None


def _last_nonempty(buffer: str) -> Optional[str]:
    for line in reversed(buffer.splitlines()):
        if line.strip():
            return line
    return None


def _asks_to_continue(low: str) -> bool:
    return "are you sure you want to continue connecting" in low or "(yes/no" in low or "fingerprint" in low


def _asks_for_password(buffer: str) -> bool:
    line = _last_nonempty(buffer)
    if line is None:
        return False
    t = line.rstrip()
    low = t.lower()
    return (low.endswith("password:") or low.endswith("passphrase:") or ("password for" in low and t.endswith(":"))) and "password changed" not in low


def _looks_like_prompt(line: str) -> bool:
    t = line.rstrip()
    if not t or t[-1] not in "#$>%":
        return False
    head = t[:-1].rstrip()
    return bool(head) and len(head) <= 64 and len(head.split()) <= 3 and not head.endswith(",") and "password" not in head.lower()


class Hop:
    """One hop's state across reads. `advance` takes everything rendered
    since the command was sent and says what to do: ("wait", None),
    ("send", text), ("password", None), ("landed", None) or
    ("failed", reason)."""

    def __init__(self, from_prompt: str):
        self.from_prompt = from_prompt.strip()
        self.answered_fingerprint = False
        self.sent_password = False

    def advance(self, buffer: str):
        low = buffer.lower()
        failure = _failure_in(low)
        if failure:
            return ("failed", failure)
        if not self.answered_fingerprint and _asks_to_continue(low):
            self.answered_fingerprint = True
            return ("send", "yes")
        if not self.sent_password and _asks_for_password(buffer):
            self.sent_password = True
            return ("password", None)
        if self.sent_password:
            line = _last_nonempty(buffer)
            if line is not None:
                t = line.strip()
                if _looks_like_prompt(t) and t != self.from_prompt and not _asks_for_password(buffer):
                    return ("landed", None)
        return ("wait", None)
