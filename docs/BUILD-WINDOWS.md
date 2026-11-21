# Building the Windows installer on a Windows PC

Building the standard installer — NSIS, with the WebView2 bootstrapper — on
a Windows machine instead of in CI. `scripts/build-windows-local.ps1` runs
the same steps as the CI Windows bundle job and prints the installer's path.

## Prerequisites

Install these once (an elevated terminal for `winget`):

1. **Visual Studio 2022 Build Tools, "Desktop development with C++".**
   The MSVC compiler and linker and the Windows SDK, which Rust's MSVC
   toolchain links with and which carries `signtool.exe` for signing.

   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```

   Or run the Build Tools installer and tick that workload. It is a few GB.

2. **Rust through rustup, MSVC toolchain.**

   ```powershell
   winget install Rustlang.Rustup
   rustup default stable-x86_64-pc-windows-msvc
   ```

   `rustc -vV` must say `host: x86_64-pc-windows-msvc`; the script checks.

3. **Node.js 22** (LTS), with npm — the installer from nodejs.org, or
   `winget install OpenJS.NodeJS` and check `node --version` says v22. CI
   builds with 20; anything from 20 up works.

4. **Python 3.12**, with pip and the `py` launcher.

   ```powershell
   winget install Python.Python.3.12
   ```

   It only fetches and unpacks the sidecar's hashed wheels; the installer
   ships python.org's embeddable 3.12 (pinned in `sidecar/build/windows.ps1`),
   not this one. `py -3.12` is found even when another Python is first on
   `PATH`.

5. **PowerShell 7** (`pwsh`), which the build scripts are written for, and
   **Git**:

   ```powershell
   winget install Microsoft.PowerShell
   winget install Git.Git
   ```

WebView2 is already part of Windows 11 (and of Edge on Windows 10).
Leave 30 GB free for `target\`.

## Building

```powershell
git clone https://github.com/husseinm9186/Corelens-Desktop.git
cd Corelens-Desktop
pwsh -File scripts\build-windows-local.ps1
```

The first build takes longest: Rust compiles everything, and the SBOM tools
(`cargo-auditable`, `cargo-audit`, `cargo-cyclonedx`) are installed with
`cargo install` once. Later builds reuse `target\`. It ends with:

```
Installer: C:\...\target\release\bundle\nsis\Corelens-Desktop_<version>_x64-setup.exe
```

Beside it: `SHA256SUMS.txt`, `sbom\` and, when signed, the `.sig`.

Outside CI the script sets the variables a GitHub Actions runner would
(`RUNNER_TEMP`, `RUNNER_OS`, `GITHUB_WORKSPACE`, `GITHUB_ENV`) to this
checkout and a scratch folder under `target\build-windows-local\`, and
only those that are not set already, so a run inside CI keeps the runner's.

If Windows refuses to run the script ("running scripts is disabled"),
`pwsh -ExecutionPolicy Bypass -File scripts\build-windows-local.ps1` runs
it once without changing the machine's policy.

### Options

- `-NoSbom` — no cargo-auditable and no SBOM or audit afterwards. Quicker
  for trying something; not the build CI ships.
- `-NoNpmCi` — keep `node_modules` as it is instead of a clean `npm ci`.
- `-Thumbprint <thumbprint>` — Authenticode-sign the exe, the sidecar's
  unsigned PE files and the installer with a certificate already in
  `Cert:\CurrentUser\My` (or set `CORELENS_SIGN_THUMBPRINT`). The settings go
  in through an extra `--config`, so `tauri.conf.json` is not changed.
  Without it the installer is unsigned and SmartScreen will say so.

### The updater signature

With the updater's minisign key in `%USERPROFILE%\.tauri\corelens-desktop.key`
(or in `TAURI_SIGNING_PRIVATE_KEY`), the build also writes the installer's
`.sig`, which "Check for updates" verifies. Without it the build goes on and
says that no signature was produced; the installer itself works the same.
The key's password, if it has one, goes in `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
The key never goes in the repository.

`VIRUSTOTAL_API_KEY`, when set, scans the installer as CI does; without it
the scan is skipped.

## What this has and has not been run on

The script is the CI Windows bundle job's steps in the same order, with the
same tools and files. It was written for a Windows PC and has not been run
from this repository's own checkout yet: the first run is the test. If a
step fails, the CI job in `.github/workflows/build.yml` is what it should
match.

Signing is with Corelens's own certificate when one is given
(`docs/SIGNING.md`); a build made without it is for trying, not for handing
on.
