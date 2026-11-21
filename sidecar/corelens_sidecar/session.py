"""
One SSH session per device, driven by scrapli. The catalog's `session:`
block (passed by Rust as `session_spec` on `open`) supplies every literal
this module sends that is not a collection command: the banner answer,
the paging steps, the context switches. Nothing else is typed here.

Phase 1 uses scrapli's own platform drivers for the prompt and privilege
handling they encode (the same data the catalog carries, extracted by
scripts/extract-sessions.py); an OS with no scrapli platform (ArubaOS-
Switch) runs on scrapli's GenericDriver with the catalog's prompt pattern.
"""
from __future__ import annotations

import base64
import hashlib
import os
import re
import time
from typing import Any, Optional

from scrapli import Scrapli
from scrapli.driver import GenericDriver
from scrapli.exceptions import ScrapliAuthenticationFailed, ScrapliConnectionError, ScrapliConnectionNotOpened, ScrapliTimeout

from paramiko import Transport as _ParamikoTransport
import scrapli.transport.plugins.paramiko.transport as _scrapli_paramiko

from .allowlist import verdict


class _PatientTransport(_ParamikoTransport):
    """paramiko waits 15 s for the SSH banner, and a PA-220's
    management plane took up to 15.3 s in the lab. The wait is set per
    session from its own login time, never under 30 s.

    Past the banner, paramiko waits an hour for a channel and
    without limit for the shell. One device that answers the handshake and
    then nothing would hold this single-threaded loop, and every session
    behind it, until Rust replaced the process. The channel is opened with
    the same bound, and the shell request below is bounded too."""

    banner_wait = 30.0

    def __init__(self, sock, *args, **kwargs):
        super().__init__(sock, *args, **kwargs)
        self.banner_timeout = self.banner_wait

    def open_session(self, window_size=None, max_packet_size=None, timeout=None):
        return super().open_session(window_size=window_size, max_packet_size=max_packet_size, timeout=timeout if timeout is not None else self.banner_wait)


def _bounded_wait_for_event(self):
    """paramiko's `Channel._wait_for_event` waits forever for the
    device to answer a shell or exec request. This waits as long as the
    banner is waited for and then says so."""
    if not self.event.wait(_PatientTransport.banner_wait):
        raise _paramiko_ssh_exception(f"the device opened the channel but did not answer the shell request within {_PatientTransport.banner_wait:.0f} s")
    if self.event_ready:
        return
    e = self.transport.get_exception()
    if e is None:
        e = _paramiko_ssh_exception("Channel closed.")
    raise e


from paramiko.channel import Channel as _ParamikoChannel  # noqa: E402
from paramiko.ssh_exception import SSHException as _paramiko_ssh_exception  # noqa: E402

_ParamikoChannel._wait_for_event = _bounded_wait_for_event


# Scrapli builds the paramiko transport itself; this is the class it builds.
_scrapli_paramiko._ParamikoTransport = _PatientTransport

# Corelens catalog os → scrapli platform. None: GenericDriver with the catalog's prompt.
PLATFORMS = {
    "cisco_ios": "cisco_iosxe",
    "cisco_nxos": "cisco_nxos",
    "cisco_iosxr": "cisco_iosxr",
    "arista_eos": "arista_eos",
    "juniper_junos": "juniper_junos",
    "fortios": "fortinet_fortios",
    # FortiSwitchOS shares FortiOS's shell.
    "fortiswitch": "fortinet_fortios",
    "panos": "paloalto_panos",
    "aoscx": "aruba_aoscx",
    "aoss": None,
    "cisco_asa": "cisco_asa",
    "cisco_ftd": "cisco_ftd",
    "cisco_wlc_aireos": "cisco_aireos",
    "hpe_comware": "hp_comware",
    "huawei_vrp": "huawei_vrp",
    "mikrotik_routeros": "mikrotik_routeros",
    "cumulus": "cumulus_linux",
    # Cumulus 5 (NVUE) has the same bash prompt.
    "cumulus_nvue": "cumulus_linux",
    "ruckus_icx": "ruckus_fastiron",
    "ubiquiti_edgeos": "vyos_vyos",
    # NVIDIA Onyx has no scrapli platform; the catalog's prompt and `enable`.
    "onyx": None,
    # SONiC's shell is bash; the catalog's prompt.
    "sonic": None,
    # No scrapli platform; the catalog's prompt and steps.
    "cisco_s300": None,
    "extreme_exos": None,
    "aruba_os": None,
    "cisco_viptela": None,
    "vyos": "vyos_vyos",
}

# The only shapes a session step may take. A catalog is data Rust controls,
# but a step outside this vocabulary is still refused here and reported.
SESSION_STEP = re.compile(
    r"^(terminal |term |set cli |no page$|no paging$|config paging (disable|enable)$|screen-length|screen-width|skip-page-display$|stty cols "
    r"|disable clipaging$|disable cli prompting$|set terminal (length|width) \d+$|paginate false$"
    r"|config system console$|set output \S+$|end$|abort$|config global$|config vdom$|edit \S+$|changeto (context \S+|system)$"
    r"|set system setting target-vsys \S+$|enable$|exit$|logout$|quit$|a$|y$|n$|\r?$)"
)


def fingerprint_of(key) -> str:
    """OpenSSH's SHA-256 fingerprint, the form Corelens's host-key store keeps:
    `SHA256:` and the unpadded base64 of the digest of the key blob."""
    digest = hashlib.sha256(key.asbytes()).digest()
    return "SHA256:" + base64.b64encode(digest).decode().rstrip("=")


# Defined beside the hop module, which raises it too; re-exported here.
from .session_errors import SessionError  # noqa: E402
from .hop import DESCRIBE as _HOP_DESCRIBE, Hop as _Hop, check_hop_command, readable as _readable  # noqa: E402


def _fill(step: str, name: str, kind: str) -> str:
    return step.replace("{" + kind + "}", name).replace("{vrf}", name).replace("{vdom}", name).replace("{vsys}", name).replace("{ctx}", name).replace("{context}", name)


class Session:
    def __init__(self, sid: str, host: str, port: int, os_name: str, auth: dict, spec: dict, timeouts: dict, emit, known_key: Optional[str] = None, transport: str = "ssh", via: Optional[list] = None):
        self.id = sid
        self.host = host
        # The devices to go through, first to last: each one's address, its
        # SSH port, the host key Corelens remembers for it and the `ssh`
        # command to run on it to reach the next (Rust spells it for that
        # device's platform). The session is opened to the first and the
        # rest is typed, as an engineer would.
        self.via = list(via or [])
        for link in self.via:
            if not isinstance(link, dict) or not isinstance(link.get("host"), str):
                raise SessionError("error", "each device to go through needs a host")
            check_hop_command(link.get("hop_command"))
        if self.via and transport != "ssh":
            raise SessionError("error", "a hop starts with an SSH session")
        # The same login goes on to the far device, as the classic crawler sends it.
        self._hop_password = auth.get("password") or ""
        if self.via:
            host = self.via[0]["host"]
            port = int(self.via[0].get("port") or 22)
            known_key = self.via[0].get("known_host_key")
        # "ssh" (paramiko) or "telnet" — Rust decides, per its policy;
        # telnet has no host key to verify and sends everything in clear.
        if transport not in ("ssh", "telnet"):
            raise SessionError("error", f"unknown transport {transport!r}")
        self.transport_kind = transport
        self.os = os_name
        self.spec = spec or {}
        self.emit = emit
        self.contexts: list[str] = []
        self.context_kind: Optional[str] = None
        self.has_contexts = False
        self._original_paging: Optional[str] = None
        self._current_context: Optional[str] = None
        # The fingerprint Corelens's store holds for this host, if any,
        # and the one the device presented.
        self.known_key = known_key
        self.presented_key: Optional[str] = None
        connect_s = max(1, int(timeouts.get("connect_ms", 8000))) / 1000
        auth_s = max(1, int(timeouts.get("auth_ms", 20000))) / 1000
        self._hop_wait = connect_s + auth_s
        _PatientTransport.banner_wait = max(30.0, auth_s)
        # Scrapli takes the key as a file path and would name an
        # unresolved "path" — the key itself — in its error. Only a path to
        # a file this process may read is passed on; the text is never quoted.
        key_path = auth.get("private_key") or ""
        if key_path and not (len(key_path) < 1024 and "\n" not in key_path and os.path.isfile(key_path) and os.access(key_path, os.R_OK)):
            raise SessionError("auth", "the private key must be the path of a key file this process may read")
        # Set once a command timed out — scrapli closes the transport
        # then, and every later op must say so instead of failing one by one.
        self.dead: Optional[str] = None
        common: dict[str, Any] = {
            "host": host,
            "port": port,
            "auth_username": auth["username"],
            "auth_password": auth.get("password") or "",
            "auth_secondary": auth.get("enable") or auth.get("password") or "",
            "auth_private_key": auth.get("private_key") or "",
            "auth_private_key_passphrase": auth.get("passphrase") or "",
            # Strict, with the check replaced below by one against
            # Corelens's own store — the sidecar keeps no known_hosts file.
            "auth_strict_key": True,
            "transport": "paramiko" if transport == "ssh" else "telnet",
            "timeout_socket": connect_s,
            "timeout_transport": auth_s,
            "timeout_ops": 30,
        }
        # Through a device, the session starts at that device, whatever it
        # is, so the driver is the generic one with a prompt pattern that
        # matches every CLI; the far device's own pattern takes over once
        # the hop has landed.
        platform = None if self.via else PLATFORMS.get(os_name)
        self.enable_secret = common["auth_secondary"]
        if platform is None:
            # "generic" (the fingerprint pass, before the OS is known) and any OS
            # without a scrapli platform run on the GenericDriver with the
            # catalog's prompt pattern, or a loose one that matches every CLI.
            # GenericDriver knows no privilege levels, so no auth_secondary.
            del common["auth_secondary"]
            prompt = (None if self.via else self.spec.get("prompt_pattern")) or r"^.*[>#$%\]]\s*$"
            self.conn = GenericDriver(comms_prompt_pattern=prompt, **common)
            self.generic = True
        else:
            try:
                self.conn = Scrapli(platform=platform, **common)
            except TypeError as e:
                # Some scrapli platforms (fortinet_fortios) are built on
                # the generic driver, which knows no privilege levels and takes
                # no enable secret.
                if "auth_secondary" not in str(e):
                    raise
                del common["auth_secondary"]
                self.conn = Scrapli(platform=platform, **common)
            self.generic = False
        if transport == "ssh":
            self.conn.transport._verify_key = self._verify_key

    # ------------------------------------------------------------- host key

    def _verify_key(self) -> None:
        """Called by the transport after the key exchange and before any
        credential is sent. A key that is not the one Corelens remembers stops
        the session here, so the password never reaches the device."""
        key = self.conn.transport.session.get_remote_server_key()
        self.presented_key = fingerprint_of(key)
        if self.known_key and self.known_key != self.presented_key:
            raise SessionError(
                "host_key",
                f"The SSH host key for {self.host} is not the one Corelens remembered "
                f"(remembered {self.known_key}, presented {self.presented_key}). Nothing was sent.",
            )

    # ------------------------------------------------------------- lifecycle

    def open(self) -> dict:
        try:
            self.conn.open()
            if self.via:
                for link in self.via:
                    self._hop(link)
                self.jump_key, self.presented_key = self.presented_key, None
                pattern = self.spec.get("prompt_pattern")
                if pattern:
                    self.conn.comms_prompt_pattern = pattern
        except SessionError:
            raise
        except ScrapliAuthenticationFailed as e:
            raise SessionError("auth", str(e)) from None
        except ScrapliTimeout as e:
            raise SessionError("timeout", str(e)) from None
        except ScrapliConnectionNotOpened as e:
            # Scrapli's own words ("connection not opened … call
            # open()?") hide the reason; the handshake's error is it.
            cause = e.__cause__ or e
            raise SessionError("error", f"the SSH handshake failed: {cause or type(cause).__name__}") from None
        except (ScrapliConnectionError, OSError) as e:
            raise SessionError("error", str(e)) from None
        except _paramiko_ssh_exception as e:
            # The channel or the shell that never came.
            raise SessionError("timeout" if "did not answer" in str(e) or "imed out" in str(e) else "error", str(e)) from None
        # A failure past the handshake must not leave the device's
        # VTY line and the paramiko thread open until the process ends.
        try:
            self._prepare()
        except BaseException as e:
            try:
                self.conn.close()
            except Exception:  # noqa: BLE001 — the reason to report is the first one
                pass
            if isinstance(e, ScrapliTimeout):
                raise SessionError("timeout", str(e)) from None
            if isinstance(e, (ScrapliConnectionError, ScrapliConnectionNotOpened, OSError)):
                raise SessionError("error", str(e)) from None
            raise
        if self.via:
            # The far device's key was checked by the last jump's own ssh
            # client, not here, so there is none to report or remember; the
            # first jump's is, for that device.
            return {
                "prompt": self._prompt(),
                "contexts": self.contexts,
                "context_kind": self.context_kind,
                "host_key": None,
                "host_key_first_seen": False,
                "via": [link["host"] for link in self.via],
                "via_host_key": getattr(self, "jump_key", None),
                "via_host_key_first_seen": not self.known_key,
            }
        return {
            "prompt": self._prompt(),
            "contexts": self.contexts,
            "context_kind": self.context_kind,
            "host_key": self.presented_key,
            "host_key_first_seen": not self.known_key,
        }

    def _hop(self, link: dict) -> None:
        """Run `link`'s ssh on the device the session is at, and drive the
        login on the next one until its prompt is drawn."""
        command = check_hop_command(link["hop_command"])
        at = link["host"]
        channel = self.conn.transport.session_channel
        hop = _Hop(self._prompt())
        self.conn.channel.write(command)
        self.conn.channel.send_return()
        buffer = ""
        deadline = time.monotonic() + self._hop_wait
        while True:
            if time.monotonic() > deadline:
                raise SessionError("timeout", f"no prompt came back through {at}")
            if channel.recv_ready():
                buffer += channel.recv(65535).decode("utf-8", errors="replace")
            elif channel.closed or channel.exit_status_ready():
                raise SessionError("error", f"{at} closed the session during the hop")
            else:
                time.sleep(0.05)
                continue
            action, arg = hop.advance(_readable(buffer))
            if action == "send":
                self.conn.channel.write(arg)
                self.conn.channel.send_return()
                buffer = ""
            elif action == "password":
                self.conn.channel.write(self._hop_password, redacted=True)
                self.conn.channel.send_return()
                buffer = ""
            elif action == "failed":
                raise SessionError("auth" if arg == "rejected" else "error", f"through {at}: {_HOP_DESCRIBE[arg]}")
            elif action == "landed":
                self.emit("log", level="info", msg=f"reached {self.host} through {at}")
                return

    def _prepare(self) -> None:
        """Everything after the SSH session is up: paging, privilege, contexts."""
        if self.generic:
            if self.os == "generic":
                # The pass that recognises a device knows nothing of it
                # yet, and a Catalyst's `show version` stops at --More--, where
                # the switch drops the session. Most CLIs take this; the rest
                # answer with an error, which is ignored.
                try:
                    self.conn.send_command("terminal length 0", timeout_ops=10)
                except Exception:  # noqa: BLE001 — a device that does not know it is still recognised
                    pass
            self._generic_on_open()
        self._detect_contexts()
        self._disable_paging()

    def close(self) -> None:
        try:
            # FortiOS refuses `config system console` inside a VDOM.
            if not self.dead:
                self._leave_context()
                self._restore_paging()
        except Exception:  # noqa: BLE001 — closing must not fail on a device that already went away
            pass
        try:
            self.conn.close()
        except Exception:  # noqa: BLE001
            pass

    def _prompt(self) -> str:
        try:
            return self.conn.get_prompt()
        except Exception:  # noqa: BLE001
            return ""

    # ---------------------------------------------------------------- steps

    def _step(self, step: str, timeout: float = 15) -> str:
        """Send one session step from the catalog; refuse anything outside the vocabulary."""
        if not SESSION_STEP.match(step):
            raise SessionError("refused", f"session step {step!r} is outside the session vocabulary")
        r = self.conn.send_command(step, timeout_ops=timeout)
        return r.result

    def _generic_on_open(self) -> None:
        banner = self.spec.get("banner")
        if banner:
            # ProCurve: "Press any key to continue" before the prompt (netmiko hp_procurve.py).
            self.conn.channel.send_return()
            time.sleep(0.5)
        levels = self.spec.get("privilege_levels") or {}
        want = self.spec.get("default_privilege")
        lvl = levels.get(want) if want else None
        if lvl and lvl.get("escalate"):
            # The one catalog literal that reached the device unchecked.
            if not SESSION_STEP.match(lvl["escalate"]):
                raise SessionError("refused", f"escalate step {lvl['escalate']!r} is outside the session vocabulary")
            prompt = self._prompt()
            if not re.search(lvl["pattern"], prompt):
                self.conn.send_interactive(
                    [(lvl["escalate"], lvl.get("escalate_prompt") or "assword", False), (self.enable_secret, "", True)] if lvl.get("escalate_auth") else [(lvl["escalate"], "", False)],
                    timeout_ops=15,
                )
        for step in (self.spec.get("paging") or {}).get("off") or self.spec.get("on_open") or []:
            self._step(step)

    def _detect_contexts(self) -> None:
        ctx = self.spec.get("contexts")
        if not ctx:
            return
        self.context_kind = ctx.get("kind")
        detect = ctx.get("detect") or {}
        if not detect.get("cmd"):
            return
        out = self._run_raw(detect["cmd"], 15)
        if not re.search(detect.get("match", "$^"), out, re.M):
            return
        self.has_contexts = True
        lst = ctx.get("list") or {}
        if lst.get("cmd"):
            out = self._run_raw(lst["cmd"], 15)
            self.contexts = sorted(set(re.findall(lst.get("match", "$^"), out, re.M)))
        self.emit("log", level="info", msg=f"{self.context_kind}: {len(self.contexts)} found")

    def _disable_paging(self) -> None:
        paging = self.spec.get("paging") or {}
        check = paging.get("check")
        if check and check.get("cmd"):
            # FortiOS: read the console output mode, set standard only if it is not, restore on close.
            if check.get("in_global") and self.has_contexts:
                self._enter_global()
            out = self._run_raw(check["cmd"], 15)
            m = re.search(check.get("match", "$^"), out, re.M)
            self._original_paging = m.group(1) if m else None
            if self._original_paging != check.get("want"):
                for step in paging.get("off") or []:
                    self._step(step)
            if check.get("in_global") and self.has_contexts:
                self._leave_context()
        # Platforms scrapli knows already ran their own on_open; the generic path ran the steps above.

    def _restore_paging(self) -> None:
        paging = self.spec.get("paging") or {}
        check = paging.get("check")
        if not check or self._original_paging is None or self._original_paging == check.get("want"):
            return
        if check.get("in_global") and self.has_contexts:
            self._enter_global()
        for step in paging.get("restore") or []:
            self._step(step.replace("{original}", self._original_paging))
        if check.get("in_global") and self.has_contexts:
            self._leave_context()

    # ------------------------------------------------------------- contexts

    def _enter_global(self) -> None:
        for step in (self.spec.get("contexts") or {}).get("enter_global") or []:
            self._step(step)
        self._current_context = "global"

    def _leave_context(self) -> None:
        ctx = self.spec.get("contexts") or {}
        if self._current_context is None:
            return
        for step in ctx.get("leave") or []:
            self._step(step)
        self._current_context = None
        if ctx.get("reprompt"):
            self._prompt()

    def switch(self, context: dict) -> dict:
        """Enter a VDOM / vsys / ASA context, `global`, or `system` (none)."""
        if self.dead:
            raise SessionError("error", self.dead)
        ctx = self.spec.get("contexts")
        if not ctx:
            raise SessionError("unsupported", f"{self.os} has no contexts")
        name = context.get("name")
        self._leave_context()
        if name in (None, "system", ""):
            return {"context": None}
        if name == "global":
            self._enter_global()
            return {"context": "global"}
        # Only a name the device listed; on FortiOS `config vdom` /
        # `edit <new>` / `end` would make one.
        if self.has_contexts and name not in self.contexts:
            raise SessionError("unsupported", f"no {self.context_kind} named {name!r}")
        for step in ctx.get("enter") or []:
            self._step(_fill(step, name, ctx.get("kind", "context")))
        self._current_context = name
        if ctx.get("reprompt"):
            self._prompt()
        return {"context": name}

    # ------------------------------------------------------------- commands

    def _run_raw(self, cmd: str, timeout: float) -> str:
        v = verdict(cmd)
        if v != "ok":
            raise SessionError("refused", v)
        r = self.conn.send_command(cmd, timeout_ops=timeout)
        return r.result

    def _failed_when(self) -> list[str]:
        """Scrapli's refusals for the platform and the catalog's own."""
        ours = [m for m in self.spec.get("failed_when_contains") or [] if m]
        return list(dict.fromkeys(list(getattr(self.conn, "failed_when_contains", None) or []) + ours))

    def run(self, cmd: str, timeout_ms: int) -> tuple[str, str, int]:
        """(status, raw, duration_ms) for one collection command."""
        v = verdict(cmd)
        if v != "ok":
            raise SessionError("refused", v)
        if self.dead:
            raise SessionError("error", self.dead)
        started = time.monotonic()
        try:
            r = self.conn.send_command(cmd, timeout_ops=max(1, timeout_ms) / 1000, failed_when_contains=self._failed_when())
        except ScrapliTimeout:
            # Scrapli has closed the transport; say so from now on.
            self.dead = f"the session closed after {cmd!r} timed out"
            try:
                self.conn.close()
            except Exception:  # noqa: BLE001 — already gone
                pass
            return "timeout", "", int((time.monotonic() - started) * 1000)
        except (ScrapliConnectionError, OSError) as e:
            raise SessionError("error", f"connection lost: {e}") from None
        ms = int((time.monotonic() - started) * 1000)
        status = "unsupported" if r.failed else "ok"
        return status, r.result, ms
