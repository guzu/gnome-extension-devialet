# Development

## Linting

ESLint is used to check for syntax errors. Install dependencies and run:

```bash
npm install
./lint.sh
```

## Packaging

To create a distributable `.zip` for GNOME Extensions:

```bash
./pack.sh
```

This runs `gnome-extensions pack` and produces a `dvlt-ctrl@guzu.github.io.shell-extension.zip` file ready for upload to [extensions.gnome.org](https://extensions.gnome.org).

## Debugging

View extension logs with:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep dvlt-ctrl
```

The extension uses `console.debug()` for verbose logging (discovery, device resolution, cache loading). These messages are hidden by default. To enable them, set the `G_MESSAGES_DEBUG` environment variable before starting GNOME Shell:

```bash
G_MESSAGES_DEBUG=all journalctl -f -o cat /usr/bin/gnome-shell | grep dvlt-ctrl
```

Or export it in your session before login:

```bash
export G_MESSAGES_DEBUG=all
```
