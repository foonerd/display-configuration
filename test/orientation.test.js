'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../plugin/lib/orientation');

test('eight distinct orientations, closed under composition', () => {
    const all = O.all();
    assert.equal(all.length, 8);
    const seen = new Set(all.map(O.toString));
    assert.equal(seen.size, 8);
    for (const a of all) for (const b of all) assert.ok(seen.has(O.toString(O.compose(a, b))));
});

test('every orientation has an inverse and normal is the identity', () => {
    for (const o of O.all()) {
        assert.ok(O.equals(O.compose(o, O.invert(o)), O.NORMAL), O.toString(o));
        assert.ok(O.equals(O.compose(O.NORMAL, o), o));
        assert.ok(O.equals(O.compose(o, O.NORMAL), o));
    }
});

test('four quarter turns compose like a clock', () => {
    const r = O.make('right', false);
    assert.equal(O.compose(r, r).turn, 'inverted');
    assert.equal(O.compose(O.compose(r, r), r).turn, 'left');
    assert.equal(O.compose(O.compose(O.compose(r, r), r), r).turn, 'normal');
    assert.equal(O.compose(O.make('left', false), r).turn, 'normal');
});

// The baseline 0.0.43 shipped these exact matrices (index.js rotationMatrices); users'
// screens work with them today, so the new model must reproduce them byte for byte.
test('input matrices equal the baseline tables for the four turns', () => {
    assert.equal(O.toInputMatrix(O.make('normal', false)), '1 0 0 0 1 0 0 0 1');
    assert.equal(O.toInputMatrix(O.make('inverted', false)), '-1 0 1 0 -1 1 0 0 1');
    assert.equal(O.toInputMatrix(O.make('left', false)), '0 -1 1 1 0 0 0 0 1');
    assert.equal(O.toInputMatrix(O.make('right', false)), '0 1 0 -1 0 1 0 0 1');
});

// The baseline composed display rotation x touch offset by matrix product; the offset
// matrices were the same tables keyed by degrees (90 = right). compose must agree.
test('baseline composition display x offset is compose(display, offset)', () => {
    const cases = [['right', 90, 'inverted'], ['left', 90, 'normal'], ['inverted', 180, 'normal'], ['normal', 270, 'left']];
    for (const [display, offsetDeg, expected] of cases) {
        const r = O.compose(O.make(display, false), O.fromDegreesClockwise(offsetDeg, false));
        assert.equal(r.turn, expected, display + ' x ' + offsetDeg);
    }
});

test('mirror is its own inverse and is not a turn', () => {
    const m = O.make('normal', true);
    assert.ok(O.equals(O.compose(m, m), O.NORMAL));
    assert.equal(O.toInputMatrix(m), '-1 0 1 0 1 0 0 0 1');
    for (const o of O.all()) assert.equal(O.compose(o, m).mirror, !o.mirror);
});

test('input matrix round-trips for all eight, including xinput float formatting', () => {
    for (const o of O.all()) {
        assert.ok(O.equals(O.fromInputMatrix(O.toInputMatrix(o)), o));
    }
    const asXinput = '0.000000, 1.000000, 0.000000, -1.000000, 0.000000, 1.000000, 0.000000, 0.000000, 1.000000';
    assert.equal(O.fromInputMatrix(asXinput).turn, 'right');
});

test('degrees clockwise match the baseline rotationToDegrees table', () => {
    assert.equal(O.toDegreesClockwise(O.make('normal')), 0);
    assert.equal(O.toDegreesClockwise(O.make('right')), 90);
    assert.equal(O.toDegreesClockwise(O.make('inverted')), 180);
    assert.equal(O.toDegreesClockwise(O.make('left')), 270);
    assert.equal(O.fromDegreesClockwise(450).turn, 'right');
    assert.equal(O.fromDegreesClockwise(-90).turn, 'left');
    assert.throws(() => O.fromDegreesClockwise(45), RangeError);
});

test('fbcon and plymouth values follow the baseline formula degrees/90 and degrees', () => {
    assert.deepEqual(O.toFbcon(O.make('right')), { value: 1, exact: true });
    assert.deepEqual(O.toFbcon(O.make('left')), { value: 3, exact: true });
    assert.deepEqual(O.toPlymouth(O.make('inverted')), { degrees: 180, exact: true });
    assert.equal(O.toFbcon(O.make('right', true)).exact, false, 'fbcon cannot mirror');
});

test('kernel panel orientation names map through drm_client_rotation to xrandr turns', () => {
    assert.equal(O.fromPanelOrientation('Normal').turn, 'normal');
    assert.equal(O.fromPanelOrientation('Upside Down').turn, 'inverted');
    assert.equal(O.fromPanelOrientation('Left Side Up').turn, 'left');
    assert.equal(O.fromPanelOrientation('Right Side Up').turn, 'right');
    assert.equal(O.fromPanelOrientation(''), null);
    assert.throws(() => O.fromPanelOrientation('Sideways'), RangeError);
});

test('cmdline rotate is DRM counter-clockwise, the mirror image of xrandr clockwise', () => {
    assert.equal(O.toCmdline(O.make('right')).rotate, 270);
    assert.equal(O.toCmdline(O.make('left')).rotate, 90);
    assert.equal(O.toCmdline(O.make('inverted')).rotate, 180);
    assert.equal(O.toCmdline(O.make('normal')).rotate, 0);
    assert.deepEqual(O.toCmdline(O.make('normal', true)), { rotate: 0, reflect_x: true, exact: false });
    assert.equal(O.toCmdlinePanelOrientation(O.make('right')).value, 'right_side_up');
});

test('xrandr reflect words fold into the eight: y is x plus a half turn, xy is a half turn', () => {
    assert.ok(O.equals(O.fromXrandr('normal', 'xy'), O.make('inverted', false)));
    assert.ok(O.equals(O.fromXrandr('normal', 'y'), O.make('inverted', true)));
    assert.ok(O.equals(O.fromXrandr('right', 'x'), O.compose(O.make('right'), O.make('normal', true))));
    for (const o of O.all()) {
        const x = O.toXrandr(o);
        assert.ok(O.equals(O.fromXrandr(x.rotate, x.reflect), o), O.toString(o));
    }
});

test('string form parses and prints', () => {
    for (const o of O.all()) assert.ok(O.equals(O.parse(O.toString(o)), o));
    assert.throws(() => O.parse('right+flip'), RangeError);
    assert.throws(() => O.make('up'), RangeError);
});

// The case the plugin exists for: the kernel already turned the console for a
// quirked panel (GPD: Right Side Up); the user wants the picture upright. X comes up
// unturned (xserver 21.1.7 never reads panel orientation), so X needs the panel's
// turn; the kernel line needs nothing more; touch needs the same as X.
test('quirked panel: X gets the panel turn, the kernel line the remainder (none)', () => {
    const panel = O.fromPanelOrientation('Right Side Up');
    const wanted = O.NORMAL; // upright, relative to the panel's natural picture
    const forX = O.compose(wanted, panel);
    assert.equal(forX.turn, 'right');
    const remainderForKernel = O.compose(wanted, O.NORMAL); // kernel already applied panel
    assert.equal(O.toCmdline(remainderForKernel).rotate, 0);
    assert.equal(O.toInputMatrix(forX), '0 1 0 -1 0 1 0 0 1');
});

// The GOLE case: no quirk; the user says the panel is mounted right side up. Every
// layer needs the full turn: X right, fbcon 1, plymouth 90, cmdline rotate=270.
test('unquirked panel: every layer receives the whole turn', () => {
    const panel = null;
    const wanted = O.make('right', false);
    const forX = panel ? O.compose(wanted, panel) : wanted;
    assert.equal(forX.turn, 'right');
    assert.equal(O.toFbcon(forX).value, 1);
    assert.equal(O.toPlymouth(forX).degrees, 90);
    assert.equal(O.toCmdline(forX).rotate, 270);
});
