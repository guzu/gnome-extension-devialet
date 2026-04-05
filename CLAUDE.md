# gnome-dvlt-ctrl - GNOME Shell Extension for Devialet Speakers

## Project Overview

GNOME Shell extension to control Devialet speakers on the local network. Provides a panel indicator with per-device controls: play/pause, next/previous, volume slider, now-playing metadata with cover art, and mDNS auto-discovery.

**UUID:** `dvlt-ctrl@guzu.github.io`
**Target:** GNOME Shell 46–48 (ESModules / GJS)
**Parent project:** `dvlt-ctrl` (Python CLI in parent directory — see `../CLAUDE.md`)

## Architecture

```
extension.js          Entry point — wires up the 3 main components
├── devialetClient.js  HTTP client (Soup3) — talks to Devialet IP Control REST API
├── avahiDiscovery.js  mDNS discovery via Avahi D-Bus (system bus)
├── indicator.js       Panel indicator + popup menu with per-device cards (St/Clutter)
└── cache.js           JSON file cache at ~/.cache/dvlt-ctrl-gnome
```

### Key design decisions

- **Avahi D-Bus** (not Zeroconf): GJS cannot use Python libs; Avahi is available on every GNOME desktop.
- **Service type `_devialet-http._tcp`**: Devialet-specific mDNS service. Do NOT use `_http._tcp` — it misses some models.
- **ServiceResolverNew signature `iisssiu`** (7 params): the `aprotocol` int param is required but easy to forget.
- **TXT record parsing**: GVariant `ay` entries must be iterated byte-by-byte (`entry.get_child_value(j).get_byte()`). `get_data()` does not work.
- **Separator between device cards**: Only `St.Bin` with inline `style` works reliably in popup menus. `PopupSeparatorMenuItem`, CSS `border-top`, and `St.Widget` all fail silently.
- **No dbus-send to restart GNOME Shell**: user restarts manually (`Alt+F2 → r` on X11, or logout/login on Wayland).

### Data flow

1. On `enable()`: load cached devices → show UI immediately → start Avahi discovery in background
2. Avahi emits `device-found` signal → device added to menu, polling starts (every 5s)
3. Polling fetches volume + playback state via HTTP, updates UI
4. Re-scan every 10s to catch devices that failed initial mDNS resolution
5. Refresh button: verify cached devices (remove unreachable) + restart discovery (non-destructive)

## Devialet IP Control API

Base: `http://<host>:<port>/ipcontrol/v1`

| Endpoint | Method | Purpose |
|---|---|---|
| `/systems/current/sources/current/soundControl/volume` | GET/POST | Volume (0–100) |
| `/groups/current/sources/current` | GET | Playback state, metadata, source type |
| `/groups/current/sources/current/playback/play` | POST | Play |
| `/groups/current/sources/current/playback/pause` | POST | Pause |
| `/groups/current/sources/current/playback/next` | POST | Next track |
| `/groups/current/sources/current/playback/previous` | POST | Previous track |

Full API spec: `../Devialet-IP-Control.txt`

## Development Rules

### Code style
- ESModules (`import`/`export`) — no legacy `const X = imports.X`
- GJS conventions: GObject.registerClass for classes with signals
- No npm, no bundler, no transpiler — plain JS loaded directly by GNOME Shell

### GJS / GNOME Shell gotchas
- `Soup` must be imported with version: `import Soup from 'gi://Soup?version=3.0'`
- Async: use Promises wrapping `*_async`/`*_finish` callbacks (no native async GIO support in GJS)
- UI: `St` (Shell Toolkit) and `Clutter` only — no GTK in GNOME Shell extensions
- `PopupMenu` items: use `PopupBaseMenuItem` with `reactive: true` for hover effects
- Icons: `Gio.icon_new_for_string(path)` for custom PNGs, `icon_name` for system symbolic icons

### Linting

```bash
npm install    # first time only
./lint.sh      # runs ESLint on all source *.js files
```

### Testing

```bash
# Install to local GNOME extensions dir
ln -sf "$(pwd)" ~/.local/share/gnome-shell/extensions/dvlt-ctrl@guzu.github.io

# Restart GNOME Shell (X11)
# Alt+F2 → r → Enter

# View logs
journalctl -f -o cat /usr/bin/gnome-shell | grep dvlt-ctrl

# Enable console.debug() output
G_MESSAGES_DEBUG=all journalctl -f -o cat /usr/bin/gnome-shell | grep dvlt-ctrl

# Check Avahi (useful for debugging discovery)
avahi-browse -r -t _devialet-http._tcp
```

### Packaging

```bash
./pack.sh   # produces dvlt-ctrl@guzu.github.io.shell-extension.zip
```

### Adding new features
1. Check `../Devialet-IP-Control.txt` for available API endpoints
2. Add endpoint to `ENDPOINTS` map in `devialetClient.js`
3. Add method in `devialetClient.js`
4. Add UI in `indicator.js`

## File reference

| File | Purpose |
|---|---|
| `metadata.json` | Extension identity (UUID, shell versions) |
| `extension.js` | Entry point: `enable()` / `disable()` |
| `devialetClient.js` | HTTP API client (Soup3), single `_request()` method |
| `avahiDiscovery.js` | Avahi D-Bus mDNS browser with GObject signals |
| `indicator.js` | Panel button + popup menu with per-device cards |
| `cache.js` | JSON cache read/write at `~/.cache/dvlt-ctrl-gnome` |
| `stylesheet.css` | All CSS classes for the popup menu |
| `icons/devialet.png` | Panel icon |
| `icons/devialet-logo.png` | Default cover art in device cards |
| `README.md` | User-facing documentation |
| `DEVEL.md` | Developer guide (linting, packaging, debugging) |
| `eslint.config.js` | ESLint flat config for GJS |
| `package.json` | npm dev dependencies (ESLint) |
| `lint.sh` | Run ESLint on source files |
| `pack.sh` | Package extension as `.zip` for distribution |

## Tested devices

- Devialet Phantom II (Reactor)
- Devialet Dione
- Devialet Phantom Gold (via `_devialet-http._tcp`)

## Known limitations

1. Avahi resolver can intermittently fail (TimeoutError) — periodic re-scan mitigates this
2. Cover art loaded via Soup3 + GdkPixbuf — no caching, re-fetched on URL change
3. Single network only (mDNS doesn't cross subnets)
4. No preferences UI (no prefs.js)
