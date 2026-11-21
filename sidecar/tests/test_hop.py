"""Reaching a device through another device's own SSH, in the collector.

The state machine and the command check without a network, then the whole
thing over a real socket: a paramiko SSH server stands in for a jump host
that, given an `ssh` command, asks the fingerprint question and a password
and then draws the next device's prompt and answers its `show version` — the
sequence the classic crawler's `hop.rs` was built against.
"""

import socket
import threading

import paramiko
import pytest

from corelens_sidecar.hop import Hop, HopFailed, check_hop_command
from corelens_sidecar.session import Session, SessionError

TARGET = "198.51.100.4"
PASSWORD = "not-a-real-password"
OPENSSH = (
    "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o GlobalKnownHostsFile=/dev/null "
    "-o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no "
    f"-o NumberOfPasswordPrompts=1 netops@{TARGET}"
)


# ------------------------------------------------------------ the command

@pytest.mark.parametrize("cmd", [OPENSSH, f"ssh netops@{TARGET}", f"ssh -l netops {TARGET}", f"execute ssh netops@{TARGET}"])
def test_each_spelling_the_crawler_uses_is_accepted(cmd):
    assert check_hop_command(cmd) == cmd


@pytest.mark.parametrize("cmd", [
    f"ssh netops@{TARGET}; reload",
    f"ssh netops@{TARGET} && conf t",
    f"ssh -l netops {TARGET} | tee x",
    "copy running-config tftp://192.0.2.9/x",
    f"ssh -o ProxyCommand=sh netops@{TARGET}",
    f"ssh net`id`@{TARGET}",
    "",
])
def test_anything_else_is_refused_before_it_reaches_a_device(cmd):
    with pytest.raises(SessionError) as e:
        check_hop_command(cmd)
    assert e.value.status == "refused"


# ------------------------------------------------------ the state machine

def test_the_fingerprint_is_answered_then_the_password_then_it_lands():
    h = Hop("netops@leaf-b02:mgmt:~$")
    assert h.advance("Are you sure you want to continue connecting (yes/no/[fingerprint])? ") == ("send", "yes")
    assert h.advance("netops@198.51.100.4's password: ") == ("password", None)
    assert h.advance("\nLast login: today\ncx-1# ") == ("landed", None)


def test_coming_back_to_the_prompt_it_left_is_not_landing():
    h = Hop("netops@leaf-b02:mgmt:~$")
    h.advance("password: ")
    assert h.advance("\nnetops@leaf-b02:mgmt:~$ ") == ("wait", None)


@pytest.mark.parametrize("text, reason", [
    ("Permission denied, please try again.", "rejected"),
    ("ssh: connect to host 198.51.100.4 port 22: Connection refused", "unreachable"),
    ("ssh: Could not resolve hostname x", "unresolved"),
    ("% Invalid input detected at '^' marker.", "no client"),
    ("Host key verification failed.", "host key"),
])
def test_each_failure_is_named_as_a_class_not_quoted(text, reason):
    assert Hop("SW1#").advance(text) == ("failed", reason)


# ------------------------------------------------------- over a real socket

class JumpHost(paramiko.ServerInterface):
    def __init__(self):
        self.stage = "at_jump"

    def check_auth_password(self, username, password):
        return paramiko.AUTH_SUCCESSFUL if password == PASSWORD else paramiko.AUTH_FAILED

    def get_allowed_auths(self, username):
        return "password"

    def check_channel_request(self, kind, chanid):
        return paramiko.OPEN_SUCCEEDED

    def check_channel_pty_request(self, *a):
        return True

    def check_channel_shell_request(self, channel):
        return True


def serve(listener, seen):
    sock, _ = listener.accept()
    t = paramiko.Transport(sock)
    t.add_server_key(paramiko.Ed25519Key.generate() if hasattr(paramiko.Ed25519Key, "generate") else paramiko.RSAKey.generate(2048))
    server = JumpHost()
    t.start_server(server=server)
    ch = t.accept(10)
    if ch is None:
        return
    jump_prompt, far_prompt = "netops@leaf-b02:mgmt:~$ ", "cx-1# "
    ch.send(f"\r\n{jump_prompt}")
    buf = ""
    while True:
        data = ch.recv(1024)
        if not data:
            break
        text = data.decode()
        # A terminal echoes what is typed as it is typed — except a password.
        if server.stage != "password":
            ch.send(text.replace("\n", "\r\n"))
        buf += text
        while "\n" in buf:
            line, buf = buf.split("\n", 1)
            cmd = line.strip()
            seen.append((server.stage, cmd))
            if server.stage == "at_jump":
                if cmd.startswith("ssh ") and TARGET in cmd:
                    server.stage = "fingerprint"
                    ch.send(f"The authenticity of host '{TARGET}' can't be established.\r\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ")
                else:
                    ch.send(jump_prompt)
            elif server.stage == "fingerprint":
                server.stage = "password"
                ch.send(f"\r\nnetops@{TARGET}'s password: ")
            elif server.stage == "password":
                server.stage = "at_target" if cmd == PASSWORD else "at_jump"
                ch.send(f"\r\nLast login: today\r\n{far_prompt}" if cmd == PASSWORD else f"\r\nPermission denied, please try again.\r\n{jump_prompt}")
            else:
                answers = {"show version": "ArubaOS-CX\r\nVersion : ML.10.18.1002"}
                ch.send(f"{answers.get(cmd, '')}\r\n{far_prompt}")


@pytest.fixture
def jump():
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    seen = []
    thread = threading.Thread(target=serve, args=(listener, seen), daemon=True)
    thread.start()
    yield listener.getsockname()[1], seen
    listener.close()


def test_a_session_through_a_jump_host_lands_on_the_far_device_and_runs_there(jump):
    port, seen = jump
    via = [{"host": "127.0.0.1", "port": port, "known_host_key": None, "hop_command": OPENSSH}]
    s = Session("h", TARGET, 22, "generic", {"username": "netops", "password": PASSWORD}, {}, {"connect_ms": 5000, "auth_ms": 5000}, lambda *a, **k: None, via=via)
    info = s.open()
    try:
        assert info["prompt"].startswith("cx-1"), info
        assert info["via"] == ["127.0.0.1"]
        # The far device's key was checked by the jump's own client, not
        # by Corelens, so there is nothing of it to remember.
        assert info["host_key"] is None and info["host_key_first_seen"] is False
        status, raw, _ = s.run("show version", 10000)
        assert status == "ok" and "ML.10.18.1002" in raw, (status, raw)
    finally:
        s.close()
    # The password went to the far device's prompt, and nothing but the hop
    # command (and the fingerprint answer) was typed at the jump host.
    at_jump = [cmd for stage, cmd in seen if stage == "at_jump" and cmd]
    assert all(cmd == OPENSSH or cmd.startswith("terminal length") for cmd in at_jump), at_jump
    assert ("password", PASSWORD) in seen


def test_a_far_device_that_refuses_the_login_says_so(jump):
    port, _ = jump
    via = [{"host": "127.0.0.1", "port": port, "known_host_key": None, "hop_command": OPENSSH}]
    s = Session("h", TARGET, 22, "generic", {"username": "netops", "password": PASSWORD}, {}, {"connect_ms": 5000, "auth_ms": 5000}, lambda *a, **k: None, via=via)
    # The jump accepts the password; the far device, scripted to accept
    # only the same one, is sent another by overriding what is sent on.
    s._hop_password = "wrong-password"
    with pytest.raises(SessionError) as e:
        s.open()
    assert e.value.status == "auth" and "rejected" in str(e.value)
