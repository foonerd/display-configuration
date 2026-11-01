'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../plugin/lib/xinput');
const G = require('../plugin/lib/grub');
const O = require('../plugin/lib/orientation');
const { fixture, skip } = require('./fixtures');

const captured = (name, fn) => test(name, { skip }, fn);

captured('xinput list from VirtualBox: eleven devices, roles and kinds read through the box-drawing glyphs', () => {
    const d = I.parseList(fixture('xinput-list.virtualbox.txt'));
    assert.equal(d.length, 11);
    const tablet = d.find((x) => x.name === 'VirtualBox USB Tablet');
    assert.deepEqual(tablet, { name: 'VirtualBox USB Tablet', id: 10, role: 'slave', kind: 'pointer', attachedTo: 2, virtual: false });
    assert.equal(d.find((x) => x.id === 2).role, 'master');
    assert.equal(d.find((x) => x.id === 2).virtual, true);
    assert.equal(d.find((x) => x.id === 11).name, 'AT Translated Set 2 keyboard');
    assert.deepEqual(I.pointerSlaves(d).map((x) => x.id), [9, 10, 12]);
});

captured('xinput list-props: the matrix and libinput properties are read', () => {
    const { device, props } = I.parseProps(fixture('xinput-props.vbox-tablet.txt'));
    assert.equal(device, 'VirtualBox USB Tablet');
    assert.equal(props['Device Enabled'].value, '1');
    assert.equal(I.currentMatrix(props), '1.000000, 0.000000, 0.000000, 0.000000, 1.000000, 0.000000, 0.000000, 0.000000, 1.000000');
    assert.ok(O.equals(O.fromInputMatrix(I.currentMatrix(props)), O.NORMAL));
    assert.equal(I.nodeOf(props), '/dev/input/event6');
});

captured('classification: absolute by libinput calibration property, relative by accel speed, names as fallback', () => {
    const list = I.parseList(fixture('xinput-list.virtualbox.txt'));
    const tablet = list.find((x) => x.id === 10);
    const { props } = I.parseProps(fixture('xinput-props.vbox-tablet.txt'));
    assert.equal(I.classify(tablet, props), 'absolute');
    assert.equal(I.classify(list.find((x) => x.id === 12), {}), 'relative', 'ImExPS/2 Generic Explorer Mouse by name');
    assert.equal(I.classify(list.find((x) => x.id === 9), {}), 'relative', 'VirtualBox mouse integration by name');
    assert.equal(I.classify(list.find((x) => x.id === 2), {}), 'other', 'master pointer');
    assert.equal(I.classify(list.find((x) => x.id === 11), {}), 'other', 'keyboard');
    assert.equal(I.classify({ name: 'Goodix Capacitive TouchScreen', id: 7, role: 'slave', kind: 'pointer', virtual: false }, {}), 'absolute');
    assert.equal(I.classify({ name: 'SIPODEV USB Composite Device', id: 7, role: 'slave', kind: 'pointer', virtual: false }, {}), 'pointer', 'unknown until its props are read');
});

test('xinput command builders', () => {
    assert.deepEqual(I.setMatrixArgs(10, O.toInputMatrix(O.make('right'))), ['set-prop', '10', '--type=float', 'Coordinate Transformation Matrix', '0', '1', '0', '-1', '0', '1', '0', '0', '1']);
    assert.deepEqual(I.mapToOutputArgs(10, 'eDP-1'), ['map-to-output', '10', 'eDP-1']);
    assert.equal(I.udevRule('Goodix Capacitive TouchScreen', O.toInputMatrix(O.make('left'))), 'ACTION=="add|change", KERNEL=="event[0-9]*", ATTRS{name}=="Goodix Capacitive TouchScreen", ENV{LIBINPUT_CALIBRATION_MATRIX}="0 -1 1 1 0 0"\n');
});

// The file the baseline wrote for "right": plymouth=90, bare video=efifb, fbcon 1.
test('grub: the baseline file is reproduced exactly for the same inputs', () => {
    const o = O.make('right');
    const text = G.render({ plymouth: O.toPlymouth(o).degrees, fbcon: O.toFbcon(o).value });
    assert.equal(text, 'set screen=plymouth=90\nset efifb=video=efifb\nset fbcon=fbcon=rotate:1\n');
    assert.deepEqual(G.parse(text), { plymouth: 90, fbcon: 1, video: 'video=efifb', gfxpayload: null, unknown: [] });
});

test('grub: a connector mode and a DRM rotation ride the efifb variable', () => {
    const o = O.make('right');
    const text = G.render({
        plymouth: 90, fbcon: 1,
        video: { connector: 'eDP-1', mode: '800x1280', rotate: O.toCmdline(o).rotate },
    });
    assert.ok(text.includes('set efifb=video=eDP-1:800x1280,rotate=270\n'));
    const virt = G.render({ video: { connector: 'Virtual-1', mode: '1280x720@60' }, gfxpayload: 'keep' });
    assert.equal(virt, 'set screen=plymouth=0\nset efifb=video=Virtual-1:1280x720@60\nset fbcon=fbcon=rotate:0\nset gfxpayload=keep\n');
    assert.equal(G.videoOption({ connector: 'HDMI-A-1', reflectX: true }), 'video=HDMI-A-1:e,reflect_x');
    assert.equal(G.videoOption({}), 'video=efifb');
});

test('grub: nothing malformed is ever rendered', () => {
    assert.throws(() => G.render({ plymouth: 45 }), RangeError);
    assert.throws(() => G.render({ fbcon: 4 }), RangeError);
    assert.throws(() => G.render({ video: { connector: 'eDP-1; rm -rf /', mode: '800x1280' } }), RangeError);
    assert.throws(() => G.render({ video: { connector: 'eDP-1', mode: '800x1280', rotate: 45 } }), RangeError);
    assert.throws(() => G.render({ video: { mode: '800x1280' } }), RangeError, 'mode without connector');
    assert.throws(() => G.render({ gfxpayload: 'auto' }), RangeError);
    assert.throws(() => G.render({ video: { connector: 'eDP-1', mode: '800x1280$(x)' } }), RangeError);
});

test('grub: parse tolerates comments, blanks and unknown lines', () => {
    const p = G.parse('# written by hand\n\nset screen=plymouth=180\nset fbcon=fbcon=rotate:2\nset foo=bar\n');
    assert.equal(p.plymouth, 180);
    assert.equal(p.fbcon, 2);
    assert.equal(p.video, null);
    assert.deepEqual(p.unknown, ['set foo=bar']);
});
