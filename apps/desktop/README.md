# Virtex Desktop (Electron)

A secure Electron shell around the web client and the standalone POS terminal.

## Run

```bash
# 1) Start the web apps it points at
nx serve client-web      # portal on :4200
nx serve pos             # POS terminal on :4300 (optional)

# 2) Launch the desktop shell
nx serve desktop
```

- **Go → Portal** (⌘/Ctrl+1) loads the web client; **Go → Point of sale** (⌘/Ctrl+2) loads the POS
  terminal. Both origins are configurable:

```bash
DESKTOP_PORTAL_URL=https://app.example.com \
DESKTOP_POS_URL=https://pos.example.com \
nx serve desktop
```

## Security

Context isolation on, node integration off, `sandbox: true`, and a preload that exposes only
`window.virtexDesktop` (platform + versions). Navigation outside the configured origins is refused
and handed to the system browser.

## Package (installers)

`nx package desktop` runs electron-builder (`apps/desktop/electron-builder.json`). Install the
packager first: `npm i -D electron-builder`.
