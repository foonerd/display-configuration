# Display Configuration

A Volumio 4 plugin for the screen of an x86 player: rotation, brightness, touch and pointer alignment, display scaling, screensaver, and the orientation of the console and the boot logo. The plugin in the Volumio store under the name `display_configuration` (category `user_interface`); existing installations upgrade in place and keep their settings.

This repository is where the plugin is developed. Its first commit is the plugin as the store shipped it at version 0.0.43; every change since is in the [changelog](CHANGELOG.md).

## What it does

**Display.** Screen rotation (default, left, right, inverted) applied to the running display through xrandr, with the touch and pointer layers following it. Brightness, where the hardware exposes a backlight.

**Advanced.** Separate rotation offsets for touch input, the mouse pointer, the console text (TTY) and the boot logo, for hardware whose layers do not agree with the panel. Display scaling (overscan) for screens that cut the edges, in steps from 2% to 10%. Console and boot logo changes take effect at the next boot.

**Screensaver.** The screen turned off (DPMS) or xscreensaver, after a timeout in seconds, with an option to keep the screen on while music plays. The mouse cursor hidden when idle. A laptop's lid turns the screen off and on.

**Diagnostics.** A debug logging switch, a restart of the display session without a reboot, and a diagnostic report written to `/tmp/volumio-display-diagnostics.txt`.

## Get it

From the store: Plugins, User Interface, Display configuration.

By hand, from a [release](https://github.com/foonerd/display-configuration/releases) zip or from this repository:

```sh
git clone --depth=1 https://github.com/foonerd/display-configuration
cd display-configuration/plugin
volumio plugin install
```

After updating, restart Volumio (or reboot) so the new version is the one running; Volumio loads plugin code once per start.

| Player | Volumio 4 (bookworm) on x86_64 with the kiosk display enabled. |
| --- | --- |
| Needs | An X11 display (the kiosk's); `xrandr`, `xinput`, `xset` from the image. The installer adds `unclutter-xfixes` and `xscreensaver`. |

## Where things live on the player

| What | Where |
| --- | --- |
| Plugin | `/data/plugins/user_interface/display_configuration/` |
| Settings | `/data/configuration/user_interface/display_configuration/config.json` |
| Boot-time rotation | `/data/plugins/user_interface/display_configuration/rotation.cfg`, read by the image's GRUB configuration at boot to set the console and boot logo orientation |
| Display session | `volumio-kiosk.service`; log: `journalctl -u volumio-kiosk` |
| Diagnostic report | `/tmp/volumio-display-diagnostics.txt` |

## Repository

| Path | Holds |
| --- | --- |
| `plugin/` | The plugin as the store receives it: `index.js`, `package.json`, `config.json`, `UIConfig.json`, `i18n/`, `install.sh`, `uninstall.sh`, and its static check under `test/`. |
| `scripts/package.sh` | Assembles the plugin zip, `dist/display_configuration-<version>.zip`, with the node modules. |
| `scripts/release-notes.sh` | Prints one version's changelog section, for the release notes. |
| `.github/workflows/` | CI on every push (the check, the shell lint, the zip); the release on a tag `vX.Y.Z` (the zip and its digest, published as a pre-release). |

The check runs with `npm test --prefix plugin`: the code parses, every file is valid JSON ending in a newline, every UI label has a translation, every language carries every key, every button names a field and a method that exist, and the install scripts end as the store requires.

## Licence

ISC. Copyright (c) 2025 Balbuze, (c) 2026 Just a Nerd. See [LICENSE](LICENSE).
