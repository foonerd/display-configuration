'use strict';
// A GOLE 2 Pro captured 2026-11-01 while running the shipped plugin 0.0.40 with
// settings verified on the device: splash, screen and touch all upright. Whatever
// the new model derives from those settings must equal what the device is doing,
// byte for byte. Captures: xrandr --verbose, xinput list and list-props, the live
// config.json and rotation.cfg.
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../plugin/lib/orientation');
const X = require('../plugin/lib/xrandr');
const I = require('../plugin/lib/xinput');
const G = require('../plugin/lib/grub');
const P = require('../plugin/lib/profile');
const { fixture, skip } = require('./fixtures');

const captured = (name, fn) => test(name, { skip }, fn);

// What the device is doing (the oracle).
const LIVE = {
    xrandrRotation: 'right',
    touchMatrix: '0.000000, -1.000000, 1.000000, 1.000000, 0.000000, 0.000000, 0.000000, 0.000000, 1.000000',
    rotationCfg: 'set screen=plymouth=90\nset efifb=video=efifb\nset fbcon=fbcon=rotate:1\n',
};

captured('GOLE 2 Pro: the capture is what the research expected of an unquirked portrait panel', () => {
    const r = X.parseVerbose(fixture('xrandr-verbose.gole2-dsi.txt'));
    const dsi = r.outputs.find((o) => o.name === 'DSI-1');
    assert.equal(dsi.connected, true);
    assert.equal(dsi.primary, true);
    assert.equal(dsi.panelOrientation, 'Normal', 'no kernel quirk: the kernel believes the panel is upright');
    assert.equal(dsi.preferredMode.width, 720);
    assert.equal(dsi.preferredMode.height, 1280, 'the panel scans portrait');
    assert.equal(dsi.rotation, LIVE.xrandrRotation, 'the shipped plugin turned X right');
    assert.deepEqual(dsi.geometry, { width: 1280, height: 720, x: 0, y: 0 }, 'and the screen is landscape');
    assert.deepEqual(dsi.rotationsSupported, ['normal', 'left', 'inverted', 'right']);
    assert.equal(dsi.properties['scaling mode'].value, 'Full aspect');
    assert.equal(X.hasProperty(dsi, 'underscan'), false, 'i915: no underscan property');
    assert.equal(r.outputs.filter((o) => o.connected).length, 1);
    assert.deepEqual(r.outputs.map((o) => o.name), ['DSI-1', 'HDMI-1', 'DP-1']);
});

captured('GOLE 2 Pro: the Goodix is an absolute pointer and its live matrix is the "left" element', () => {
    const list = I.parseList(fixture('xinput-list.gole2.txt'));
    const touch = list.find((d) => d.id === 10);
    assert.equal(touch.name, 'Goodix Capacitive TouchScreen');
    const { props } = I.parseProps(fixture('xinput-props.gole2-goodix.txt'));
    assert.equal(I.classify(touch, props), 'absolute');
    assert.equal(I.nodeOf(props), '/dev/input/event14');
    assert.equal(I.currentMatrix(props), LIVE.touchMatrix);
    assert.ok(O.equals(O.fromInputMatrix(LIVE.touchMatrix), O.make('left')));
    // right (the screen) composed with the 180 offset the user needed = left
    assert.ok(O.equals(O.compose(O.make('right'), O.make('inverted')), O.make('left')));
});

captured('GOLE 2 Pro: the live 0.0.40 settings migrate and plan to exactly what the device runs', () => {
    const old = JSON.parse(fixture('config.gole2.0.0.40.json'));
    assert.ok(P.isLegacy(old));
    const cfg = P.migrateFrom043(old);
    const p = cfg.profiles.default;
    assert.equal(p.outputs['*'].orientation, 'right');
    assert.equal(p.inputs['*'].offset, 'inverted');
    assert.deepEqual(p.boot, { console: 'follow', splash: 'follow' });
    assert.equal(p.brightness, 100);

    const r = X.parseVerbose(fixture('xrandr-verbose.gole2-dsi.txt'));
    const list = I.parseList(fixture('xinput-list.gole2.txt'));
    const { props } = I.parseProps(fixture('xinput-props.gole2-goodix.txt'));
    const inputs = I.pointerSlaves(list).map((d) => ({ id: d.id, name: d.name, kind: I.classify(d, d.id === 10 ? props : {}) }));
    const plan = P.plan(cfg, { outputs: r.outputs, inputs });

    const rotate = plan.steps.find((s) => s.action === 'rotate');
    assert.deepEqual(rotate, { layer: 'x', output: 'DSI-1', action: 'rotate', rotate: 'right', reflect: 'normal' });

    const matrix = plan.steps.find((s) => s.action === 'matrix' && s.device === 10);
    assert.equal(matrix.matrix, O.toInputMatrix(O.fromInputMatrix(LIVE.touchMatrix)));

    const boot = plan.steps.find((s) => s.action === 'rotation.cfg');
    assert.equal(G.render({ plymouth: boot.plymouth, fbcon: boot.fbcon, video: boot.video || {}, gfxpayload: boot.gfxpayload }), LIVE.rotationCfg);
    assert.equal(boot.video, null, 'the shipped plugin never wrote a connector; the default stays bare video=efifb until the user asks for a mode');

    assert.deepEqual(plan.notes, [], 'nothing on this device needs a caveat');
});

// The same device, described the way the new UI will: the panel is mounted right
// side up (a fact about the hardware, entered once), the user wants it upright.
// The derived actions must be the same as above.
captured('GOLE 2 Pro: declaring the panel mount instead of a screen turn yields the same actions', () => {
    const cfg = P.defaults();
    cfg.profiles.default.outputs['*'].panelOrientation = 'Right Side Up';
    cfg.profiles.default.outputs['*'].orientation = 'normal';
    cfg.profiles.default.inputs['Goodix Capacitive TouchScreen'] = { offset: 'inverted', output: null };
    const r = X.parseVerbose(fixture('xrandr-verbose.gole2-dsi.txt'));
    const plan = P.plan(cfg, { outputs: r.outputs, inputs: [{ id: 10, name: 'Goodix Capacitive TouchScreen', kind: 'absolute' }] });
    assert.equal(plan.steps.find((s) => s.action === 'rotate').rotate, 'right');
    assert.equal(plan.steps.find((s) => s.action === 'matrix').matrix, '0 -1 1 1 0 0 0 0 1');
    const boot = plan.steps.find((s) => s.action === 'rotation.cfg');
    // Here the kernel line gets nothing: with the mount declared, the plugin can tell the
    // kernel about it (panel_orientation=) and let it turn the console itself. That is
    // a later stage; today the console and splash stay as the shipped plugin set them.
    assert.equal(boot.fbcon, 0);
});
