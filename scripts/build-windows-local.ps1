# Build the standard Windows installer (NSIS, WebView2 bootstrapper) on this
# machine, the way the CI Windows bundle job does, and print where it is.
#
#   pwsh -File scripts/build-windows-local.ps1 [-Thumbprint <cert>] [-NoSbom] [-NoNpmCi]
#
# The steps, in the job's order:
#   1. npm ci
#   2. Authenticode: with -Thumbprint (or CORELENS_SIGN_THUMBPRINT) naming a
#      certificate in Cert:\CurrentUser\My, the bundler signs the exe and
#      the installer, SHA-256, timestamped. The settings go in through an
#      extra --config file rather than into tauri.conf.json, so the working
#      tree is left as it was. Without one the installer is unsigned.
#   3. the collector sidecar: sidecar/build/windows.ps1 with Python 3.12,
#      then sidecar/build/sign.ps1 (which signs nothing without a certificate)
#   4. tauri build --bundles nsis with tauri.sidecar.conf.json, through
#      cargo-auditable, and tauri.updater.conf.json when the updater key is
#      there: TAURI_SIGNING_PRIVATE_KEY, or %USERPROFILE%\.tauri\corelens-desktop.key
#   5. the file names a download URL can carry (scripts/asset-names.mjs)
#   6. the SBOM and audit of what shipped: cargo audit of the exe (reported,
#      not failed), cargo cyclonedx, pip-audit of the sidecar (fails on an
#      advisory not written up in sidecar/pip-audit-ignore.txt), the npm SBOM
#   7. the public certificates beside the installer, a VirusTotal scan when
#      VIRUSTOTAL_API_KEY is set, and SHA256SUMS.txt
#
# -NoSbom skips cargo-auditable and step 6 (a quicker build for trying
# something; not what CI ships). -NoNpmCi keeps node_modules as it is.
# Prerequisites: docs/BUILD-WINDOWS.md.
param(
  [string]$Thumbprint = $env:CORELENS_SIGN_THUMBPRINT,
  [switch]$NoSbom,
  [switch]$NoNpmCi
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

# The variables a GitHub Actions runner provides, which the sidecar and
# signing scripts read. Set here only when unset, so a run inside CI keeps
# the runner's own; outside it they point at this checkout and a scratch
# folder under target\.
$scratchRoot = Join-Path $root "target\build-windows-local"
New-Item -ItemType Directory -Force -Path $scratchRoot | Out-Null
$runnerTemp = Join-Path $scratchRoot "runner-temp"
New-Item -ItemType Directory -Force -Path $runnerTemp | Out-Null
$defaults = [ordered]@{
  RUNNER_TEMP      = $runnerTemp
  RUNNER_OS        = "Windows"
  GITHUB_WORKSPACE = "$root"
  GITHUB_ENV       = (Join-Path $scratchRoot "github-env.txt")
}
foreach ($name in $defaults.Keys) {
  if (-not [Environment]::GetEnvironmentVariable($name)) {
    [Environment]::SetEnvironmentVariable($name, $defaults[$name], "Process")
  }
}

function Step([string]$what) { Write-Host ""; Write-Host "==> $what" -ForegroundColor Cyan }
function Fail([string]$why) { Write-Host "build-windows-local: $why" -ForegroundColor Red; exit 1 }
function Check([string]$what) { if ($LASTEXITCODE -ne 0) { Fail "$what failed (exit $LASTEXITCODE)" } }

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") { Fail "this builds the Windows installer and runs on Windows only" }
if ($PSVersionTable.PSVersion.Major -lt 7) { Fail "PowerShell 7 (pwsh) is needed, as CI uses; this is $($PSVersionTable.PSVersion)" }

Step "Prerequisites"
foreach ($tool in "node", "npm", "cargo", "rustc") {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool is not on PATH; see docs/BUILD-WINDOWS.md" }
}
$host_ = (& rustc -vV | Select-String "^host:").ToString()
if ($host_ -notmatch "x86_64-pc-windows-msvc") { Fail "rustc's host is '$host_'; the MSVC toolchain is needed (rustup default stable-x86_64-pc-windows-msvc)" }
$nodeMajor = [int]((& node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) { Fail "Node $(& node --version) is too old; 22 is recommended (CI uses 20)" }

# A CPython 3.12 with pip: the py launcher's, or python on PATH.
$python = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
  $python = (& py -3.12 -c "import sys; print(sys.executable)" 2>$null)
  if ($LASTEXITCODE -ne 0) { $python = $null }
}
if (-not $python -and (Get-Command python -ErrorAction SilentlyContinue)) {
  $v = & python -c "import sys; print('%d.%d' % sys.version_info[:2])"
  if ($v -eq "3.12") { $python = (& python -c "import sys; print(sys.executable)") }
}
if (-not $python) { Fail "Python 3.12 not found (py -3.12, or python 3.12 on PATH); see docs/BUILD-WINDOWS.md" }
$pinned = (Get-Content sidecar/.python-version -Raw).Trim()
Write-Host "node $(& node --version), $(& cargo --version), Python $(& $python --version) at $python (pinned: $pinned)"

if (-not $NoNpmCi) {
  Step "npm ci"
  npm ci
  Check "npm ci"
}

Step "Code signing"
$extra = @()
$scratch = $scratchRoot
if ([string]::IsNullOrWhiteSpace($Thumbprint)) {
  Write-Host "No certificate given (-Thumbprint or CORELENS_SIGN_THUMBPRINT): this installer is UNSIGNED."
  $env:CORELENS_SIGN_THUMBPRINT = ""
} else {
  $cert = Get-Item "Cert:\CurrentUser\My\$Thumbprint" -ErrorAction SilentlyContinue
  if (-not $cert) { Fail "no certificate $Thumbprint in Cert:\CurrentUser\My" }
  Write-Host "Signing as $($cert.Subject) - thumbprint $Thumbprint"
  $signing = Join-Path $scratch "tauri.signing.conf.json"
  @{ bundle = @{ windows = @{ certificateThumbprint = $Thumbprint; digestAlgorithm = "sha256"; timestampUrl = "http://timestamp.digicert.com" } } } |
    ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $signing
  $extra += @("--config", $signing)
  $env:CORELENS_SIGN_THUMBPRINT = $Thumbprint
}

Step "Collector sidecar (Python $pinned)"
& pwsh -NoProfile -File sidecar/build/windows.ps1 -Pip $python
Check "sidecar/build/windows.ps1"
& pwsh -NoProfile -File sidecar/build/sign.ps1
Check "sidecar/build/sign.ps1"

Step "Updater signature"
$keyFile = Join-Path $env:USERPROFILE ".tauri\corelens-desktop.key"
if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and (Test-Path $keyFile)) {
  # Read into the environment of this process only; never printed.
  $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $keyFile -Raw).Trim()
  if ($null -eq $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "" }
  Write-Host "Using the updater key from $keyFile"
}
if ($env:TAURI_SIGNING_PRIVATE_KEY) {
  $extra += @("--config", "src-tauri/tauri.updater.conf.json")
} else {
  Write-Host "No updater key (TAURI_SIGNING_PRIVATE_KEY or $keyFile): no updater signature is produced."
}

if (-not $NoSbom) {
  Step "SBOM tools"
  foreach ($t in @(@("cargo-auditable", "auditable"), @("cargo-audit", "audit"), @("cargo-cyclonedx", "cyclonedx"))) {
    & cargo $t[1] --version *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "installing $($t[0]) (once)"
      cargo install --locked $t[0]
      Check "cargo install $($t[0])"
    }
  }
  # By absolute path: tauri moves into src-tauri before starting the runner.
  $runner = Join-Path $root "scripts\sbom\cargo-auditable-runner.cmd"
  & $runner --version
  Check "cargo-auditable-runner.cmd"
  $extra += @("--runner", $runner)
}

Step "tauri build --bundles nsis"
$nsis = Join-Path $root "target\release\bundle\nsis"
if (Test-Path $nsis) { Remove-Item -Recurse -Force $nsis }
npm run tauri build -- --bundles nsis --config src-tauri/tauri.sidecar.conf.json @extra
Check "tauri build"
node scripts/asset-names.mjs target/release/bundle/nsis
Check "asset-names.mjs"

if (-not $NoSbom) {
  Step "SBOM and audit of what shipped"
  $out = Join-Path $nsis "sbom"
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  cargo audit bin target/release/corelens.exe
  if ($LASTEXITCODE -ne 0) { Write-Host "warning: cargo audit found advisories in corelens.exe" -ForegroundColor Yellow }
  $global:LASTEXITCODE = 0
  Push-Location src-tauri
  cargo cyclonedx --format json --target x86_64-pc-windows-msvc --override-filename corelens-rust.cdx
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { Fail "cargo cyclonedx failed (exit $code)" }
  Move-Item -Force src-tauri/corelens-rust.cdx.json (Join-Path $out "corelens-rust.cdx.json")
  # pip-audit in a venv of its own, so nothing is installed into the Python above.
  $venv = Join-Path $scratch "audit-venv"
  if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) { & $python -m venv $venv; Check "python -m venv" }
  $vpy = Join-Path $venv "Scripts\python.exe"
  & $vpy -m pip install --disable-pip-version-check -q pip-audit==2.10.1
  Check "pip install pip-audit"
  $ignore = Get-Content sidecar/pip-audit-ignore.txt | Where-Object { $_ -match '^[A-Z]' } | ForEach-Object { "--ignore-vuln"; ($_ -split '\s')[0] }
  & $vpy -m pip_audit -r sidecar/requirements.txt --require-hashes --disable-pip @ignore --format cyclonedx-json -o (Join-Path $out "sidecar-python.cdx.json")
  Check "pip-audit (an advisory in the sidecar not written up in sidecar/pip-audit-ignore.txt)"
  npx --yes @cyclonedx/cyclonedx-npm@6.0.1 --omit dev --output-format JSON --output-file (Join-Path $out "page-npm.cdx.json")
  Check "cyclonedx-npm"
}

Step "Certificates, scan and checksums"
$published = @(Get-ChildItem brand/*.crt -ErrorAction SilentlyContinue)
foreach ($crt in $published) { Copy-Item $crt.FullName $nsis }
if ($env:CORELENS_SIGN_THUMBPRINT) {
  $thumbprints = @($published | ForEach-Object { (Get-PfxCertificate $_.FullName).Thumbprint })
  if ($thumbprints -notcontains $env:CORELENS_SIGN_THUMBPRINT) {
    Write-Host "warning: signed with $env:CORELENS_SIGN_THUMBPRINT, which no certificate under brand/ is" -ForegroundColor Yellow
  }
}
$installers = @(Get-ChildItem (Join-Path $nsis "*-setup.exe"))
if ($installers.Count -ne 1) { Fail "expected one *-setup.exe in $nsis, found $($installers.Count)" }
$installer = $installers[0]
if ($env:VIRUSTOTAL_API_KEY) {
  ./.github/actions/virustotal/scan.ps1 -Path $installer.FullName
  Check "VirusTotal"
} else {
  Write-Host "No VIRUSTOTAL_API_KEY: not scanned."
}
"$((Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLower())  $($installer.Name)" | Out-File -Encoding ascii (Join-Path $nsis "SHA256SUMS.txt")

$signature = (Get-AuthenticodeSignature $installer.FullName).Status
Write-Host ""
Write-Host "Installer: $($installer.FullName)" -ForegroundColor Green
Write-Host "  $([math]::Round($installer.Length / 1MB, 1)) MB, Authenticode: $signature, updater signature: $(if (Test-Path "$($installer.FullName).sig") { 'yes' } else { 'no' })"
