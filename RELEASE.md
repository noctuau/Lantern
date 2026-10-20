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

## Auto-update (later)

Not set up yet. electron-builder supports `electron-updater` with GitHub Releases as the feed; add it when you want in-app updates.
