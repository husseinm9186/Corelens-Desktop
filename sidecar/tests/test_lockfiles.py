"""The Python the lockfiles were compiled for is the one that runs them.

pip-compile writes only the dependencies the compiling interpreter needs, so
a lock compiled on a newer Python can leave out one an older Python needs
(typing_extensions, for cyclonedx-python-lib) and `--require-hashes` then
refuses the whole install. CI's setup-python and the embedded interpreter
the Windows build lays down both follow `sidecar/.python-version`.
"""

import re
from pathlib import Path

SIDECAR = Path(__file__).resolve().parent.parent


def pinned() -> str:
    return (SIDECAR / ".python-version").read_text().strip()


def test_both_lockfiles_were_compiled_on_the_pinned_python():
    for name in ("requirements.txt", "requirements-dev.txt"):
        header = (SIDECAR / name).read_text().splitlines()[:3]
        found = [m.group(1) for line in header if (m := re.search(r"pip-compile with Python (\d+\.\d+)", line))]
        assert found == [pinned()], f"{name} was compiled with Python {found}, the sidecar runs {pinned()}"


def test_the_embedded_interpreter_is_the_pinned_python():
    script = (SIDECAR / "build" / "windows.ps1").read_text()
    m = re.search(r'\$PythonVersion = "(\d+)\.(\d+)\.\d+"', script)
    assert m, "windows.ps1 names no embedded Python version"
    assert f"{m.group(1)}.{m.group(2)}" == pinned()
