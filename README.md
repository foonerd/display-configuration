# Display Configuration

A Volumio 4 plugin for the screen of an x86 player: the turn and mirror of every connected screen, the touch and pointer that follow it, the boot console and splash, picture fit for screens that overscan, screensaver, cursor and brightness, named profiles with backup and restore, and a fixed resolution for virtual machines. The plugin in the Volumio store under the name `display_configuration` (category `user_interface`); installations of 0.0.x upgrade in place and keep their settings.

This repository is where the plugin is developed. Its first commit is the plugin as the store shipped it at version 0.0.43; every change since is in the [changelog](CHANGELOG.md).

## What it does

The settings page is built from what the player has: one section per connected screen, the touch and pointer devices found, the tools installed. Every save applies at once and the page refreshes itself.

**Profile.** Settings are kept in named profiles, one active. Use, copy, rename or delete a profile; the section's description tells what the display is doing now. A profile's screen turn is either set per screen below, or follows the panel: the screen is turned by what the kernel reports about how the panel is mounted.

**Screen (one section each).** Turn (normal, right, upside down, left, each with a mirror) applied to the running display through xrandr. The panel mounting as the kernel reports it, with an override for devices the kernel does not know. The mode, from the screen's own list. Fit: scale and move the picture in software for screens that cut the edges or leave borders; the driver's underscan where the output has that property. In a multi-screen layout, the position of each screen; a screen can be turned off while the others stay on.

**Touch and pointer.** Touchscreens follow the turn of their screen. Each device can carry an offset for a controller mounted differently from the panel, and in a multi-screen layout can be glued to one screen. The matrices are written to an Xorg `InputClass` as well, so they hold from the first frame after a display restart.

**Boot console and splash.** The turn of the kernel console and of the boot logo, the same as the screen or set apart. The console turns at once, the boot logo at the next start. The x86 image boots two ways and the plugin serves both: on UEFI firmware the image's GRUB configuration reads the plugin's `rotation.cfg`; on legacy BIOS firmware the image boots through syslinux, and the plugin writes the same settings onto the kernel line in `/boot/syslinux.cfg` and writes them again after every Volumio update (an update puts the stock file back). The Boot section of the settings page names the boot path in use and whether the current boot already carries the settings.

**Screensaver and brightness.** The screen off (DPMS) or xscreensaver after a timeout, held off while music plays if wanted. The cursor hidden when idle. Brightness through the backlight where the device has one, in software otherwise. A button turns the screen off now. A laptop's lid turns the screen off and on.

**Virtual machine.** The hypervisor is recognised (VirtualBox, VMware, QEMU/KVM, Hyper-V, Xen, Parallels). A fixed resolution is written to the display server's configuration and the kernel line so the guest boots with a usable screen.

**Backup and reset.** Backups hold every profile and setting; they live under Internal Storage (`/data/INTERNAL/display_configuration/backups`) and survive uninstalling the plugin. Restore applies at once. Reset returns to the defaults.

**Maintenance.** Detailed logging, a re-apply of the settings, a restart of the display session, and a diagnostics report written to `/tmp/volumio-display-diagnostics.txt`.

The settings page is in English, German, Spanish, French, Italian, Japanese, Dutch, Polish, Portuguese, Russian and Chinese.

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
| Needs | An X11 display (the kiosk's); `xrandr`, `xinput`, `xset` from the image. The installer adds `unclutter-xfixes` and `xscreensaver` where missing. |

## Where things live on the player

| What | Where |
| --- | --- |
| Plugin | `/data/plugins/user_interface/display_configuration/` |
| Settings | `/data/configuration/user_interface/display_configuration/config.json` (one key, `state`, holding the profiles as JSON) |
| Backups | `/data/INTERNAL/display_configuration/backups/<name>.json` |
| Boot-time rotation, UEFI | `/data/plugins/user_interface/display_configuration/rotation.cfg`, read by the image's GRUB configuration at boot to set the console and boot logo orientation |
| Boot-time rotation, legacy BIOS | the `APPEND` line of `/boot/syslinux.cfg` carries `plymouth=`, `video=` and `fbcon=rotate:`; the stock line is kept as `/boot/syslinux.cfg.display-configuration.bak` |
| Touch persistence | `/etc/X11/xorg.conf.d/95-display-configuration-touch.conf` |
| Fixed resolution | `/etc/X11/xorg.conf.d/90-display-configuration-resolution.conf` |
| Root helper | `/usr/local/bin/display-configuration-root`, allowed to the `volumio` user by `/etc/sudoers.d/volumio-user-display_configuration`; the only thing the plugin runs as root |
| Display session | `volumio-kiosk.service`; log: `journalctl -u volumio-kiosk` and `/var/log/volumiokiosk.log` |
| Diagnostic report | `/tmp/volumio-display-diagnostics.txt` |

Uninstalling removes the helper, the sudoers entry, the Xorg snippets and the boot file, and takes the plugin's settings off the syslinux kernel line; backups are kept.

## Repository

| Path | Holds |
| --- | --- |
| `plugin/` | The plugin exactly as the store receives it: `index.js`, `package.json`, `config.json`, `UIConfig.json`, `i18n/`, `install.sh`, `uninstall.sh`, the root helper under `scripts/`, and the device-independent modules under `lib/`. Nothing else. |
| `test/` | The unit tests of the modules under `plugin/lib/` and the static check. |
| `scripts/package.sh` | Assembles the plugin zip, `dist/display_configuration-<version>.zip`, with the node modules. |
| `scripts/release-notes.sh` | Prints one version's changelog section, for the release notes. |
| `.github/workflows/` | CI on every push (the check, the shell lint, the zip); the release on a tag `vX.Y.Z` (the zip and its digest, published as a pre-release). |

The tests run with `npm test` at the repository root: the unit tests of the modules under `plugin/lib/`, and the static check (the code parses, every file is valid JSON ending in a newline, every UI label has a translation, every language carries every key, every button names a field and a method that exist, and the install scripts end as the store requires). Tests that read captured `xrandr` and `xinput` output from real devices take it from a `display-configuration-journal/fixtures/test` directory beside this checkout, or from `DISPLAY_CONFIGURATION_FIXTURES`; without it they are skipped.

## Licence

ISC. Copyright (c) 2025 Balbuze, (c) 2026 Just a Nerd. See [LICENSE](LICENSE).
