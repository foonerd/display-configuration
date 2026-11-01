'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../plugin/lib/xrandr');
const { fixture, skip } = require('./fixtures');

const captured = (name, fn) => test(name, { skip }, fn);

// Captured on virtbookworm (VirtualBox, VMSVGA, no KMS): the legacy vmware DDX offers
// one output named "default" with no rotations and no properties.
captured('VMSVGA capture: one legacy output, no rotation, no properties', () => {
    const r = X.parseVerbose(fixture('xrandr-verbose.vmsvga.txt'));
    assert.deepEqual(r.screen.current, [1280, 720]);
    assert.equal(r.warnings[0], 'Failed to get size of gamma for output default');
    assert.equal(r.outputs.length, 1);
    const o = r.outputs[0];
    assert.equal(o.name, 'default');
    assert.equal(o.connected, true);
    assert.equal(o.active, true);
    assert.deepEqual(o.geometry, { width: 1280, height: 720, x: 0, y: 0 });
    assert.equal(o.rotation, 'normal');
    assert.deepEqual(o.rotationsSupported, ['normal']);
    assert.equal(X.canRotate(o), false);
    assert.equal(o.panelOrientation, null);
    assert.deepEqual(Object.keys(o.properties), []);
    assert.equal(o.currentMode.width, 1280);
    assert.equal(o.currentMode.refreshHz, 60);
    assert.equal(o.modes.length, 44);
    assert.equal(o.preferredMode, null, 'a non-KMS output marks no preferred mode');
});

captured('VMSVGA capture: timings are read per mode', () => {
    const r = X.parseVerbose(fixture('xrandr-verbose.vmsvga.txt'));
    const m = r.outputs[0].modes[1];
    assert.equal(m.id, '0x520');
    assert.equal(m.clockMHz, 46.08);
    assert.deepEqual(m.h, { width: 1280, start: 0, end: 0, total: 1280, skew: 0, clockKHz: 36 });
    assert.equal(m.v.clockHz, 50);
});

// The header words for a reflected output are xrandr's reflection_name(): "X axis",
// "Y axis", "X and Y axis", printed after the rotation word and before the capability
// list (confirmed in the 1.5.3 binary's strings; the live form is to be seen on a KMS bench).
test('header: a reflected output parses its rotation and reflection; an unreflected one reads normal', () => {
    const head = (tail) => 'Screen 0: minimum 8 x 8, current 1280 x 720, maximum 32767 x 32767\nHDMI-1 connected primary 1280x720+0+0 (0x4b) ' + tail + ' (normal left inverted right x axis y axis) 527mm x 296mm\n\tIdentifier: 0x42\n';
    let o = X.parseVerbose(head('right X axis')).outputs[0];
    assert.equal(o.rotation, 'right');
    assert.equal(o.reflection, 'x');
    assert.deepEqual(o.physical, { widthMm: 527, heightMm: 296 });
    o = X.parseVerbose(head('normal X and Y axis')).outputs[0];
    assert.equal(o.reflection, 'xy');
    o = X.parseVerbose(head('inverted Y axis')).outputs[0];
    assert.equal(o.reflection, 'y');
    o = X.parseVerbose(head('left')).outputs[0];
    assert.equal(o.rotation, 'left');
    assert.equal(o.reflection, 'normal');
    assert.deepEqual(o.rotationsSupported, ['normal', 'left', 'inverted', 'right']);
    assert.deepEqual(o.reflectionsSupported, ['x', 'y']);
    const off = X.parseVerbose('Screen 0: minimum 8 x 8, current 1280 x 720, maximum 32767 x 32767\nDP-1 disconnected (normal left inverted right x axis y axis)\n').outputs[0];
    assert.equal(off.rotation, null);
    assert.equal(off.reflection, null);
    assert.deepEqual(off.rotationsSupported, ['normal', 'left', 'inverted', 'right']);
});

// Synthetic, in modesetting's exact print format, for a quirked eDP panel on i915.
// To be replaced by the GOLE 2 Pro capture.
captured('KMS fixture: panel orientation and driver properties are read', () => {
    const r = X.parseVerbose(fixture('xrandr-verbose.i915-quirked.synthetic.txt'));
    assert.equal(r.outputs.length, 3);
    const [edp, hdmi, dp] = r.outputs;
    assert.equal(edp.name, 'eDP-1');
    assert.equal(edp.primary, true);
    assert.equal(edp.panelOrientation, 'Right Side Up');
    assert.deepEqual(edp.properties['panel orientation'].supported, ['Normal', 'Upside Down', 'Left Side Up', 'Right Side Up']);
    assert.equal(edp.properties['scaling mode'].value, 'Full aspect');
    assert.deepEqual(edp.properties['max bpc'].range, [6, 12]);
    assert.deepEqual(edp.rotationsSupported, ['normal', 'left', 'inverted', 'right']);
    assert.deepEqual(edp.reflectionsSupported, ['x', 'y']);
    assert.equal(X.canRotate(edp), true);
    assert.deepEqual(edp.physical, { widthMm: 94, heightMm: 151 });
    assert.equal(edp.crtc, 0);
    assert.equal(edp.preferredMode.id, '0x47');
    assert.equal(edp.currentMode.hSync, '+');
    assert.equal(edp.currentMode.vSync, '-');
    assert.equal(hdmi.connected, false);
    assert.equal(hdmi.active, false);
    assert.equal(X.hasProperty(hdmi, 'audio'), true);
    assert.equal(X.hasProperty(hdmi, 'underscan'), false, 'i915 has no underscan property');
    assert.equal(dp.name, 'DP-1');
    assert.equal(X.connectedOutputs(r).length, 1);
});

captured('EDID hex continuation lines do not become properties', () => {
    const r = X.parseVerbose(fixture('xrandr-verbose.i915-quirked.synthetic.txt'));
    assert.equal(Object.keys(r.outputs[0].properties).some((k) => /^[0-9a-f]{20,}$/.test(k)), false);
});

test('providers: none on the legacy driver, one or more on KMS', () => {
    assert.deepEqual(X.parseProviders('Providers: number : 0\n'), []);
    const p = X.parseProviders('Providers: number : 2\nProvider 0: id: 0x47 cap: 0xf, Source Output, Sink Output, Source Offload, Sink Offload crtcs: 3 outputs: 3 associated providers: 1 name:modesetting\nProvider 1: id: 0x12d cap: 0x2, Sink Output crtcs: 1 outputs: 1 associated providers: 1 name:modesetting\n');
    assert.equal(p.length, 2);
    assert.equal(p[0].name, 'modesetting');
    assert.deepEqual(p[1].capabilityNames, ['Sink Output']);
    assert.equal(p[1].outputs, 1);
});

test('command builders produce argv tokens, not shell strings', () => {
    assert.deepEqual(X.rotateArgs('eDP-1', { rotate: 'right', reflect: 'normal' }), ['--output', 'eDP-1', '--rotate', 'right', '--reflect', 'normal']);
    assert.deepEqual(X.modeArgs('HDMI-A-1', '1280x720'), ['--output', 'HDMI-A-1', '--mode', '1280x720']);
    assert.deepEqual(X.positionArgs('HDMI-A-1', 800, 0), ['--output', 'HDMI-A-1', '--pos', '800x0']);
    assert.deepEqual(X.offArgs('DP-1'), ['--output', 'DP-1', '--off']);
    assert.deepEqual(X.setPropertyArgs('HDMI-A-1', 'underscan hborder', 32), ['--output', 'HDMI-A-1', '--set', 'underscan hborder', '32']);
    assert.deepEqual(X.resetTransformArgs('eDP-1'), ['--output', 'eDP-1', '--transform', 'none']);
});

// Overscan compensation: a 1920x1080 TV that cuts 5% needs the picture at 95% in
// the middle. xrandr's transform maps output pixels to framebuffer pixels, so the
// scale is 1/0.95 and the translation puts the framebuffer's origin at the output's
// (48, 27) pixel: x' = (1/0.95) * x - 48/0.95.
test('fitArgs shrinks and centres through a transform', () => {
    const args = X.fitArgs('HDMI-A-1', 1920, 1080, { scaleX: 0.95, scaleY: 0.95 });
    assert.equal(args[0], '--output');
    assert.equal(args[2], '--transform');
    const m = args[3].split(',').map(Number);
    assert.ok(Math.abs(m[0] - 1 / 0.95) < 1e-6);
    assert.ok(Math.abs(m[2] - (-48 / 0.95)) < 1e-6);
    assert.ok(Math.abs(m[5] - (-27 / 0.95)) < 1e-6);
    assert.deepEqual(m.slice(6), [0, 0, 1]);
    assert.deepEqual(args.slice(4), ['--filter', 'bilinear']);
});

test('fitArgs moves the picture by the requested pixels', () => {
    const m = X.fitArgs('HDMI-A-1', 1920, 1080, { scaleX: 1, scaleY: 1, offsetX: 10, offsetY: -4 })[3].split(',').map(Number);
    assert.deepEqual(m, [1, 0, -10, 0, 1, 4, 0, 0, 1]);
    assert.throws(() => X.fitArgs('x', 1, 1, { scaleX: 0 }), RangeError);
});

captured('a modeline is rebuilt from the parsed timings, so porches can be edited and re-added', () => {
    const r = X.parseVerbose(fixture('xrandr-verbose.i915-quirked.synthetic.txt'));
    const mode = r.outputs[0].currentMode;
    const line = X.modeline(mode, { name: 'panel_fixed' });
    assert.equal(line, 'panel_fixed 68.7 800 848 880 960 1280 1283 1288 1193 +hsync -vsync');
    assert.deepEqual(X.newModeArgs('panel_fixed', line.slice('panel_fixed '.length)), ['--newmode', 'panel_fixed', '68.7', '800', '848', '880', '960', '1280', '1283', '1288', '1193', '+hsync', '-vsync']);
    assert.deepEqual(X.addModeArgs('eDP-1', 'panel_fixed'), ['--addmode', 'eDP-1', 'panel_fixed']);
});
