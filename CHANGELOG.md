# Changelog

All notable changes to Display Configuration are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-11-03

The boot layer on legacy BIOS players. Found by the first community test (a Dell Latitude 3189 booting the Volumio stick in BIOS mode): on that boot path the image uses syslinux rather than GRUB, and the plugin's `rotation.cfg` was never read, so the console and the boot logo stayed unturned while everything else worked.

### Added

- Legacy BIOS boots: the plugin detects the boot path and writes `plymouth=`, `video=` and `fbcon=rotate:` onto the kernel line in `/boot/syslinux.cfg`, through the root helper's new `syslinux set|clear` verb. Only those tokens are ever changed; the file is checked before and after, the stock line is kept as `syslinux.cfg.display-configuration.bak`, and the line is written again whenever a Volumio update has put the stock file back. The default turn leaves the stock file untouched.
- The Boot section names the boot path (UEFI/GRUB, legacy BIOS/syslinux) and whether the boot that is running already carries the settings; "restart needed" follows from the running kernel's command line, on both paths.
- The diagnostics report carries the boot path and `/boot/syslinux.cfg`.

### Fixed

- At a cold start, before the display server is up, the boot file was planned as "normal" and rewritten with the configured turn only once the display came up; the console could turn to normal and back in between. The boot layer is now planned from the profile alone, so it is written once and holds even when the display never starts.

### Changed

- Uninstalling takes the plugin's tokens off the syslinux kernel line before the helper goes.

## [1.0.0] - 2026-11-01

A rework from the ground up. Settings made under 0.0.43 are carried over on the first start.

### Added

- Every connected screen gets its own section: turn (the four orientations, each with a mirror), the panel's mounting as the kernel reports it with an override, the mode, a software fit (scale and move, for screens that overscan), the driver's underscan where it has one, and a position in a multi-screen layout.
- Touch and pointer devices follow the turn of their screen, with an offset per device for controllers mounted differently from the panel. The matrices persist across a display restart through an Xorg `InputClass`, so the touch is right from the first frame.
- Named profiles: use, copy, rename, delete; each a complete set of settings. A "follow the panel" mode turns the screen by the kernel's report of the panel.
- Backup, restore and reset. Backups are kept under Internal Storage and survive uninstalling the plugin.
- Virtual machines: the hypervisor is recognised and a fixed resolution can be written for the guest's display server and kernel line.
- The settings page refreshes itself after every save; after a change of geometry the kiosk page reloads.
- The console turns at once when the turn changes; the boot file is written for the next start.
- Eleven languages: English, German, Spanish, French, Italian, Japanese, Dutch, Polish, Portuguese, Russian, Chinese.
- The orientation model, the parsers for `xrandr` and `xinput`, the boot-file renderer, the planner and the device runners are separate modules with tests against captures from real devices.

### Changed

- Root work goes through one small helper installed to `/usr/local/bin` and named in `/etc/sudoers.d`; the plugin runs no shell strings and carries no password.
- The 0.0.43 degree tables are replaced by one vocabulary (`normal`, `right`, `inverted`, `left`, with `+mirror`) and conversions whose sources are cited in the code.
- The screensaver's "not while playing" is driven by the player's own state broadcast, without a second socket connection.
- Dependencies pinned (`fs-extra`, `kew`, `v-conf`); `socket.io-client` dropped.

### Removed

- The hard-coded `sudo` password, the shell-string command execution, and the browser hard-refresh instruction.

## [0.0.43] - 2026-06-23

The plugin as the Volumio store ships it, the starting point of this repository.

- Display scaling (overscan) in the advanced settings, through the GPU's underscan property where the output has one and X11 scaling with panning otherwise.
- Screen rotation with brightness, touch and pointer rotation offsets, console and boot logo orientation, screensaver (DPMS or xscreensaver) with a playback guard, hidden cursor, lid switch handling, a debug logging switch, a display session restart and a diagnostics report.
