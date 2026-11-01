'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../lib/profile');
const V = require('../lib/virt');
const O = require('../lib/orientation');
const X = require('../lib/xrandr');

const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const baselineConfig = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));

test('defaults validate and name one active profile', () => {
    const cfg = P.validate(P.defaults());
    assert.equal(cfg.activeProfile, 'default');
    assert.equal(cfg.profiles.default.outputs['*'].orientation, 'normal');
    assert.equal(cfg.profiles.default.mode, 'manual');
});

test('validation refuses what the layers would refuse', () => {
    const bad = (mutate) => { const c = P.defaults(); mutate(c); assert.throws(() => P.validate(c), RangeError); };
    bad((c) => { c.profiles.default.outputs['*'].orientation = 'sideways'; });
    bad((c) => { c.profiles.default.outputs['*'].mode = '1280x720;rm'; });
    bad((c) => { c.profiles.default.outputs['*'].fit = { scaleX: 0.2, scaleY: 1, offsetX: 0, offsetY: 0 }; });
    bad((c) => { c.profiles.default.outputs['HDMI;1'] = P.defaultOutput(); });
    bad((c) => { c.profiles.default.screensaver.timeout = -1; });
    bad((c) => { c.profiles.default.brightness = 0; });
    bad((c) => { c.activeProfile = 'nope'; });
    bad((c) => { c.profiles.other = P.defaultProfile('mismatch'); });
    bad((c) => { c.profiles.default.name = 'a'.repeat(41); });
    bad((c) => { c.profiles.default.inputs['*'].offset = 'left+flip'; });
    bad((c) => { c.profiles.default.boot.console = 'up'; });
    bad((c) => { c.profiles.default.virtual.resolution = '1280'; });
});

test('the shipped 0.0.43 config.json migrates to the defaults', () => {
    const old = baselineConfig();
    assert.ok(P.isLegacy(old));
    const cfg = P.migrateFrom043(old);
    const p = cfg.profiles.default;
    assert.equal(p.outputs['*'].orientation, 'normal');
    assert.equal(p.outputs['*'].fit, null);
    assert.equal(p.inputs['*'].offset, 'normal');
    assert.equal(p.inputs['relative:*'], undefined);
    assert.deepEqual(p.boot, { console: 'follow', splash: 'follow' });
    assert.deepEqual(p.screensaver, { type: 'dpms', timeout: 120, notWhilePlaying: true, hideCursor: false });
    assert.equal(p.brightness, 100);
    assert.equal(cfg.debug, true);
});

test('a 0.0.43 config with every knob turned migrates with the same meaning', () => {
    const old = baselineConfig();
    old.rotatescreen.value = 'right';
    old.touch_offset.value = '180';
    old.pointer_offset.value = '90';
    old.fbcon_offset.value = '90';     // console = display(right) + 90 = inverted
    old.plymouth_offset.value = 'same';
    old.overscan.value = '6';
    old.hidecursor.value = true;
    old.screensavertype.value = 'xscreensaver';
    old.timeout.value = 300;
    old.noifplay.value = false;
    old.brightness.value = 0.5;
    const p = P.migrateFrom043(old).profiles.default;
    assert.equal(p.outputs['*'].orientation, 'right');
    assert.deepEqual(p.outputs['*'].fit, { scaleX: 0.94, scaleY: 0.94, offsetX: 0, offsetY: 0 });
    assert.equal(p.inputs['*'].offset, 'inverted');
    assert.equal(p.inputs['relative:*'].offset, 'right');
    assert.equal(p.boot.console, 'inverted');
    assert.equal(p.boot.splash, 'follow');
    assert.deepEqual(p.screensaver, { type: 'xscreensaver', timeout: 300, notWhilePlaying: false, hideCursor: true });
    assert.equal(p.brightness, 50);
});

test('migration tolerates garbage values by falling back, never by throwing', () => {
    const old = baselineConfig();
    old.rotatescreen.value = 'diagonal';
    old.touch_offset.value = '45';
    old.overscan.value = 'lots';
    old.timeout.value = 'soon';
    old.brightness.value = 7;
    const p = P.migrateFrom043(old).profiles.default;
    assert.equal(p.outputs['*'].orientation, 'normal');
    assert.equal(p.inputs['*'].offset, 'normal');
    assert.equal(p.outputs['*'].fit, null);
    assert.equal(p.screensaver.timeout, 120);
    assert.equal(p.brightness, 100);
});

// A probe as index.js will assemble it from the parsers.
function probeFrom(xrandrFixture, inputs) {
    const r = X.parseVerbose(fixture(xrandrFixture));
    return { outputs: r.outputs, inputs };
}

test('plan, VMSVGA guest: legacy output cannot rotate, boot keeps video=efifb, tablet matrix is identity', () => {
    const cfg = P.defaults();
    cfg.profiles.default.outputs['*'].orientation = 'right';
    const plan = P.plan(cfg, probeFrom('xrandr-verbose.vmsvga.txt', [{ id: 10, name: 'VirtualBox USB Tablet', kind: 'absolute' }, { id: 12, name: 'ImExPS/2 Generic Explorer Mouse', kind: 'relative' }]));
    const rot = plan.steps.find((s) => s.action === 'rotate');
    assert.deepEqual(rot, { layer: 'x', output: 'default', action: 'rotate', rotate: 'normal', reflect: 'normal' });
    assert.ok(plan.notes.some((n) => /no rotation to RandR/.test(n)));
    const boot = plan.steps.find((s) => s.action === 'rotation.cfg');
    assert.equal(boot.plymouth, 90, 'the console and splash still follow the wanted turn');
    assert.equal(boot.fbcon, 1);
    assert.equal(boot.video, null, 'a legacy "default" output names no connector');
    const touch = plan.steps.find((s) => s.action === 'matrix' && s.device === 10);
    assert.equal(touch.matrix, O.toInputMatrix(O.make('right')), 'the tablet follows the wanted turn even when X cannot show it');
    assert.equal(plan.steps.some((s) => s.action === 'matrix' && s.device === 12), false, 'relative pointers are left to xrandr');
    assert.equal(plan.steps.some((s) => s.action === 'map-to-output'), false, 'one output, no mapping needed');
});

// The GPD-class case: the kernel knows the panel is Right Side Up. Manual mode with
// orientation "normal" means "upright": X gets right, the kernel line gets nothing
// extra, the touch gets right.
test('plan, quirked eDP, manual upright: X right, kernel remainder none, touch right', () => {
    const cfg = P.defaults();
    const plan = P.plan(cfg, probeFrom('xrandr-verbose.i915-quirked.synthetic.txt', [{ id: 9, name: 'Goodix Capacitive TouchScreen', kind: 'absolute' }]));
    const rot = plan.steps.find((s) => s.action === 'rotate');
    assert.equal(rot.output, 'eDP-1');
    assert.equal(rot.rotate, 'right');
    const boot = plan.steps.find((s) => s.action === 'rotation.cfg');
    assert.equal(boot.fbcon, 0, 'the kernel already turns fbcon by the quirk');
    assert.equal(boot.video, null);
    assert.equal(plan.steps.find((s) => s.action === 'matrix').matrix, O.toInputMatrix(O.make('right')));
});

test('plan, quirked eDP, user wants it inverted on top: X left (right + inverted), kernel line rotate=180', () => {
    const cfg = P.defaults();
    cfg.profiles.default.outputs['*'].orientation = 'inverted';
    cfg.profiles.default.outputs['*'].mode = '800x1280';
    const plan = P.plan(cfg, probeFrom('xrandr-verbose.i915-quirked.synthetic.txt', []));
    assert.equal(plan.steps.find((s) => s.action === 'rotate').rotate, 'left');
    const boot = plan.steps.find((s) => s.action === 'rotation.cfg');
    assert.equal(boot.fbcon, 2);
    assert.equal(boot.plymouth, 180);
    assert.deepEqual(boot.video, { connector: 'eDP-1', mode: '800x1280', rotate: 180 });
});

test('plan, follow mode: X takes the panel turn, the user turn is ignored', () => {
    const cfg = P.defaults();
    cfg.profiles.default.mode = 'follow';
    cfg.profiles.default.outputs['*'].orientation = 'inverted';
    const plan = P.plan(cfg, probeFrom('xrandr-verbose.i915-quirked.synthetic.txt', []));
    assert.equal(plan.steps.find((s) => s.action === 'rotate').rotate, 'right');
    assert.equal(plan.steps.find((s) => s.action === 'rotation.cfg').fbcon, 0);
});

test('plan: a panel orientation override replaces what the kernel reported', () => {
    const cfg = P.defaults();
    cfg.profiles.default.outputs['*'].panelOrientation = 'Normal';
    const plan = P.plan(cfg, probeFrom('xrandr-verbose.i915-quirked.synthetic.txt', []));
    assert.equal(plan.steps.find((s) => s.action === 'rotate').rotate, 'normal');
});

test('plan: fit becomes a transform step with the output geometry; underscan without the property becomes a note', () => {
    const cfg = P.defaults();
    cfg.profiles.default.outputs['*'].fit = { scaleX: 0.95, scaleY: 0.95, offsetX: 0, offsetY: 0 };
    cfg.profiles.default.outputs['*'].underscan = { hborder: 32, vborder: 18 };
    const plan = P.plan(cfg, probeFrom('xrandr-verbose.i915-quirked.synthetic.txt', []));
    const fit = plan.steps.find((s) => s.action === 'fit');
    assert.deepEqual([fit.width, fit.height], [800, 1280]);
    assert.ok(plan.notes.some((n) => /no underscan property/.test(n)));
    assert.equal(plan.steps.some((s) => s.action === 'underscan'), false);
});

test('plan: mirrored touch controller composes with the output turn', () => {
    const cfg = P.defaults();
    cfg.profiles.default.inputs['Goodix Capacitive TouchScreen'] = { offset: 'normal+mirror', output: null };
    const plan = P.plan(cfg, probeFrom('xrandr-verbose.i915-quirked.synthetic.txt', [{ id: 9, name: 'Goodix Capacitive TouchScreen', kind: 'absolute' }]));
    const m = plan.steps.find((s) => s.action === 'matrix').matrix;
    assert.equal(m, O.toInputMatrix(O.compose(O.make('right'), O.make('normal', true))));
});

test('plan: virtual guest enabled adds gfxpayload, a video mode on the KMS connector and the xorg file', () => {
    const cfg = P.defaults();
    cfg.profiles.default.virtual = { enabled: true, resolution: '1280x720' };
    const probe = probeFrom('xrandr-verbose.i915-quirked.synthetic.txt', []);
    probe.outputs[0].name = 'Virtual-1';
    const plan = P.plan(cfg, probe);
    const boot = plan.steps.find((s) => s.action === 'rotation.cfg');
    assert.equal(boot.gfxpayload, 'keep');
    assert.deepEqual(boot.video, { connector: 'Virtual-1', mode: '1280x720', rotate: 0 });
    assert.ok(plan.steps.some((s) => s.action === 'fixed-resolution' && s.resolution === '1280x720'));
});

test('virt: classification from systemd-detect-virt first, DMI second', () => {
    assert.deepEqual(V.classify({ detectVirt: 'oracle' }), { virtual: true, hypervisor: 'oracle', source: 'systemd-detect-virt' });
    assert.deepEqual(V.classify({ detectVirt: 'none', sysVendor: 'HIGOLE' }), { virtual: false, hypervisor: null, source: 'systemd-detect-virt' });
    assert.equal(V.classify({ sysVendor: 'innotek GmbH', productName: 'VirtualBox' }).hypervisor, 'oracle');
    assert.equal(V.classify({ sysVendor: 'VMware, Inc.' }).hypervisor, 'vmware');
    assert.equal(V.classify({ sysVendor: 'QEMU' }).hypervisor, 'kvm');
    assert.equal(V.classify({ sysVendor: 'Dell Inc.' }).virtual, false);
});

test('virt: the xorg file equals what set-resolution.sh writes', () => {
    const want = fs.readFileSync(path.join(__dirname, 'fixtures', '10-resolution.1280x720.conf'), 'utf8');
    assert.equal(V.xorgConf('1280x720'), want);
    assert.throws(() => V.xorgConf('1280'), RangeError);
    assert.equal(V.connectorFor(X.parseVerbose(fixture('xrandr-verbose.vmsvga.txt')).outputs), null);
    assert.equal(V.connectorFor(X.parseVerbose(fixture('xrandr-verbose.i915-quirked.synthetic.txt')).outputs), 'eDP-1');
});
