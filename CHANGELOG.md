# Changelog

All notable changes to Display Configuration are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- The orientation model: the eight ways a rectangle can face (four turns, with or without a mirror), with conversions to every layer's own notation (xrandr rotate and reflect, fbcon, Plymouth, the kernel's panel orientation and `video=` options, the input transformation matrix), tested against the tables the shipped plugin used and against the kernel's conventions.
- Parsers for `xrandr --verbose`, `xrandr --listproviders`, `xinput list` and `xinput list-props`, and builders for the xrandr and xinput commands and the boot file GRUB reads, each validated before anything is rendered.
- Named profiles with a single schema, a migration from the 0.0.43 settings, and a planner that turns a profile and the probed screens and inputs into the actions for X, the inputs, the boot files and the session.
- Virtual guests: recognition of the hypervisor and the fixed-resolution Xorg file.

## [0.0.43] - 2026-06-23

The plugin as the Volumio store ships it, the starting point of this repository.

- Display scaling (overscan) in the advanced settings, through the GPU's underscan property where the output has one and X11 scaling with panning otherwise.
- Screen rotation with brightness, touch and pointer rotation offsets, console and boot logo orientation, screensaver (DPMS or xscreensaver) with a playback guard, hidden cursor, lid switch handling, a debug logging switch, a display session restart and a diagnostics report.
