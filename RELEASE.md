# Releasing Lantern

## Build the installers

```bash
npm run dist
```

This builds the app and packages it with electron-builder into `release/`:

- `Lantern-<version>-x64.exe` — the Windows installer (NSIS). Double-click to install; it lets the user choose the folder and makes Start-menu and desktop shortcuts.
- `Lantern-<version>-portable.exe` — a single portable executable that runs without installing.

The app icon comes from `build/icon.ico` (regenerate it with `python scripts/make-icon.py`).

## Publishing on GitHub

1. Bump `version` in `package.json`.
2. `npm run dist`.
3. Create a GitHub Release and attach both `.exe` files from `release/`.

### SmartScreen note (important for users)

The executables are not code-signed (a signing certificate costs money per year). On first run, Windows SmartScreen shows "Windows protected your PC". Tell users to click **More info → Run anyway**. This is normal for unsigned open-source apps. If you later buy an EV/OV code-signing certificate, set `CSC_LINK` and `CSC_KEY_PASSWORD` before `npm run dist` and electron-builder will sign automatically, and the warning goes away.

## What users get

- Installs under `%LOCALAPPDATA%\Programs\Lantern` (per-user, no admin needed).
- Settings and worlds live in `%APPDATA%\Lantern` (`worlds.json`, `settings.json`, `logs\`).
- Uninstall from Windows "Apps & features" or the Start-menu uninstaller.

## In-app update check

Settings › About shows the running version and has "Check for updates". It asks the GitHub Releases API for the latest release of `noctuau/Lantern`, compares its tag with the running version, and offers the matching download: `Lantern-<version>-x64.exe` for an installed copy, `Lantern-<version>-portable.exe` for the portable build. The file is downloaded into `%TEMP%\lantern-updates\` with a progress bar; "Install and restart" closes Lantern and starts the installer (which replaces the installed files and keeps `%APPDATA%\Lantern`), while the portable build gets "Show the new exe" because it cannot replace itself. By default the app also checks once, a few seconds after start (installed builds only), and puts a dot on the Settings button when a newer release exists; nothing is downloaded until asked.

For this to keep working, a release must be **tagged `v<version>`** (matching `package.json`) and carry those two asset names (the `artifactName` settings above produce them). Pre-releases and drafts are not offered, since the API's "latest" endpoint skips them. There is no `electron-updater` feed (`latest.yml`); if you ever want silent background updates, that is the next step, and it needs code signing to be pleasant.
