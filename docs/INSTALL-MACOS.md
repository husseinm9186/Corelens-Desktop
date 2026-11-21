# Installing Corelens Desktop on a Mac

The macOS build is a universal app (Apple Silicon and Intel) in a `.dmg`,
on the repository's **Releases** page. It is **signed ad hoc, not with an
Apple Developer ID, and not notarized**, so macOS will not open it with a
double-click the first time. Nothing about that changes what the app does;
it changes only how macOS greets it.

## 1. Install

Open the `.dmg` and drag *Corelens Desktop* to *Applications*.

## 2. Open it the first time

Double-click it; macOS says it cannot check the app. Then open *System
Settings → Privacy & Security*, scroll to the message about Corelens
Desktop and choose **Open Anyway**, then **Open**. From then on it opens
normally.

If macOS says instead that the app is damaged, it is not: clear the
quarantine mark as in step 3 and open it again.

## 3. The collector

The app carries the Python collector (Discover → Advanced → Engine →
*Corelens collector*) inside it, for **Apple Silicon** Macs. On an Intel
Mac that engine says it cannot run there; choose the *Classic crawler*,
which needs no Python. Everything else in the app is the same on both.

Files copied out of a downloaded `.dmg` keep macOS's quarantine mark, and
the collector's interpreter is a program of its own inside the app. If
Discover says the collector could not start, remove the mark from the
installed app once, in Terminal:

```sh
xattr -dr com.apple.quarantine "/Applications/Corelens Desktop.app"
```

## 4. Where it keeps things

The database and the logs are under
`~/Library/Application Support/Corelens Desktop/`, the window's own
storage under `~/Library/WebKit/com.corelens.desktop/`, and the vault's
kept key — when *open by itself on this computer* is ticked — in the login
keychain under *Corelens Desktop*. Removing the app from *Applications*
leaves all three; delete the two folders and that keychain item to remove
them too.

## What has and has not been checked

The collector inside the macOS app is laid down and smoke-tested by the
release build on an Apple Silicon runner. It has not been run by hand on a
Mac from this repository's releases yet.
