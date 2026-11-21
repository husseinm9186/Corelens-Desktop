#!/usr/bin/env bash
# Lay the sidecar under src-tauri/sidecar/ for the macOS bundle.
#
#   sidecar/build/macos.sh [python3.12]
#
# A relocatable CPython from python-build-standalone (its "install_only"
# build, which finds its own library and standard library relative to the
# executable), its SHA-256 pinned below and checked before anything is
# unpacked — the same value the release's SHA256SUMS publishes. The runtime
# goes straight into its site-packages from requirements.txt with
# --require-hashes and wheels only, by the given Python's pip, then the
# sidecar package. Rust spawns `sidecar/bin/python` by absolute path from
# the app's Resources, as it does the venv on Linux.
#
# Apple Silicon only: cryptography publishes no Intel macOS wheel for the
# pinned release, so the bundle carries an arm64 interpreter and an Intel
# Mac reports the Python collector as unavailable.
#
# Every link is replaced by what it points to (a bundle's resources are
# copied file by file), what a collector never uses is removed, and every
# Mach-O file is signed ad hoc, which Apple Silicon requires of any code
# it runs.
set -euo pipefail
py="${1:-python3}"
release="20261021"
version="3.12.15"
sha256="a18cc33862b53bd54a148c710def5375c1b47470cccedf817a19c2d211764584"

root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/src-tauri/sidecar"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

tarball="cpython-${version}+${release}-aarch64-apple-darwin-install_only.tar.gz"
curl -fsSL -o "$tmp/py.tgz" "https://github.com/astral-sh/python-build-standalone/releases/download/${release}/${tarball/+/%2B}"
got="$(shasum -a 256 "$tmp/py.tgz" | cut -d' ' -f1)"
if [ "$got" != "$sha256" ]; then
  echo "::error title=Sidecar layout::python-build-standalone checksum $got is not the pinned $sha256"
  exit 1
fi

rm -rf "$out"
tar -xzf "$tmp/py.tgz" -C "$tmp"
mv "$tmp/python" "$out"

# One interpreter, under the name collection.rs looks for, and no links.
rm "$out/bin/python"
cp "$out/bin/python3.12" "$out/bin/python"
find "$out/bin" -mindepth 1 ! -name python ! -name python3.12 -exec rm -rf {} +
find "$out" -type l -delete
lib="$out/lib/python3.12"
rm -rf "$out/include" "$out/share" "$out/lib/pkgconfig" "$out/lib/libtcl"* "$out/lib/itcl"* "$out/lib/tcl"* "$out/lib/tk"* "$out/lib/thread"* \
  "$lib/test" "$lib/idlelib" "$lib/tkinter" "$lib/turtledemo" "$lib/ensurepip" "$lib/lib2to3" "$lib/config-3.12-darwin" \
  "$lib/lib-dynload/_tkinter"* "$lib/site-packages/"*

"$py" -m pip install --disable-pip-version-check --no-compile --no-deps --require-hashes \
  --only-binary=:all: --platform macosx_11_0_arm64 --python-version 3.12 --implementation cp \
  --target "$lib/site-packages" -r "$root/sidecar/requirements.txt"
rm -rf "$lib/site-packages/bin"
cp -R "$root/sidecar/corelens_sidecar" "$lib/site-packages/corelens_sidecar"
find "$out" -name '__pycache__' -type d -exec rm -rf {} +

count=0
while IFS= read -r -d '' f; do
  if file -b "$f" | grep -q 'Mach-O'; then
    codesign --force --sign - "$f"
    count=$((count + 1))
  fi
done < <(find "$out" -type f \( -perm -u+x -o -name '*.so' -o -name '*.dylib' \) -print0)

python3 "$root/sidecar/build/smoke.py" "$out/bin/python" "$root/resources/templates/ntc"
echo "::notice title=Sidecar layout::$("$out/bin/python" -m corelens_sidecar --version) laid under src-tauri/sidecar, $count Mach-O files signed ad hoc, $(du -sh "$out" | cut -f1)."
