'use strict';
// The device side against a fake executor: every command the runners issue is an argv
// (never a shell string), goes to the right binary with the right environment, and a
// plan turns into exactly the commands the layers expect.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createRunners } = require('../plugin/lib/runners');
const P = require('../plugin/lib/profile');
const O = require('../plugin/lib/orientation');
const { fixture, skip } = require('./fixtures');

const captured = (name, fn) => test(name, { skip }, fn);

// A fake machine: canned stdout per command, a record of every call, an in-memory
// file system for the few files the runners read and write.
function fakeMachine({ xrandrVerbose = '', xinputList = '', xinputProps = {}, files = {}, tools = ['xrandr', 'xinput', 'xset', 'unclutter'], xUp = true, rootFails = false } = {}) {
    const calls = [];
    const fs = Object.assign({}, files);
    async function run(cmd, args, opts = {}) {
        calls.push({ cmd, args: args.slice(), env: opts.env || null, input: opts.input, detached: Boolean(opts.detached) });
        const ok = (stdout = '') => ({ code: 0, stdout, stderr: '', error: null });
        const fail = (stderr = 'failed') => ({ code: 1, stdout: '', stderr, error: stderr });
        if (cmd === 'xset' && args[0] === 'q') return xUp ? ok('Keyboard Control:') : fail('unable to open display');
        if (cmd === 'systemd-detect-virt') return { code: 1, stdout: 'none\n', stderr: '', error: null };
        if (cmd === 'which') return tools.includes(args[0]) ? ok('/usr/bin/' + args[0]) : fail('');
        if (cmd === 'xrandr' && args[0] === '--verbose') return ok(xrandrVerbose);
        if (cmd === 'xrandr' && args[0] === '--query') return ok(xrandrVerbose);
        if (cmd === 'xrandr' && args[0] === '--listproviders') return ok('Providers: number : 1\nProvider 0: id: 0x47 cap: 0xf, Source Output, Sink Output, Source Offload, Sink Offload crtcs: 3 outputs: 3 associated providers: 0 name:modesetting\n');
        if (cmd === 'xinput' && args[0] === 'list') return ok(xinputList);
        if (cmd === 'xinput' && args[0] === 'list-props') return ok(xinputProps[args[1]] || '');
        if (cmd === 'sudo') return rootFails ? fail('sudo: a password is required') : ok('');
        return ok('');
    }
    const readFile = (f) => (f in fs ? fs[f] : null);
    const writeFile = (f, text) => { fs[f] = text; };
    const listDir = (d) => (d === '/sys/class/backlight' && fs['/sys/class/backlight/intel_backlight/max_brightness'] ? ['intel_backlight'] : []);
    return { run, calls, fs, readFile, writeFile, listDir };
}

const ROOT = '/usr/local/bin/display-configuration-root';
const argvOf = (calls, cmd) => calls.filter((c) => c.cmd === cmd).map((c) => c.args);

test('every X command carries DISPLAY and XAUTHORITY for the volumio user; root work goes through sudo -n and the helper', async () => {
    const m = fakeMachine({ xrandrVerbose: 'Screen 0: minimum 8 x 8, current 1280 x 720, maximum 32767 x 32767\n' });
    const r = createRunners({ run: m.run, readFile: m.readFile, writeFile: m.writeFile, listDir: m.listDir });
    await r.probe();
    const xcalls = m.calls.filter((c) => ['xrandr', 'xinput', 'xset'].includes(c.cmd));
    assert.ok(xcalls.length > 0);
    for (const c of xcalls) assert.deepEqual(c.env, { DISPLAY: ':0', XAUTHORITY: '/home/volumio/.Xauthority' });
    for (const c of m.calls) assert.ok(Array.isArray(c.args), 'argv, never a string');
    await r.kiosk('restart');
    assert.deepEqual(m.calls[m.calls.length - 1].args, ['-n', ROOT, 'kiosk', 'restart']);
});

test('when X refuses the first xset, the helper copies the cookie and X is asked again', async () => {
    let attempts = 0;
    const m = fakeMachine({});
    const run = async (cmd, args, opts) => {
        if (cmd === 'xset' && args[0] === 'q') { attempts += 1; return attempts === 1 ? { code: 1, stdout: '', stderr: 'no', error: 'no' } : { code: 0, stdout: '', stderr: '', error: null }; }
        return m.run(cmd, args, opts);
    };
    const r = createRunners({ run, readFile: m.readFile, writeFile: m.writeFile, listDir: m.listDir });
    assert.equal(await r.ensureXAccess(), true);
    assert.ok(m.calls.some((c) => c.cmd === 'sudo' && c.args[2] === 'xauth'));
    assert.equal(attempts, 2);
});

test('probe without X reports it and still reads the boot file, DMI and backlight', async () => {
    const m = fakeMachine({ xUp: false, files: { '/proc/cmdline': 'BOOT_IMAGE=/boot/vmlinuz quiet plymouth=90 video=efifb fbcon=rotate:1\n', '/data/plugins/user_interface/display_configuration/rotation.cfg': 'set screen=plymouth=90\nset efifb=video=efifb\nset fbcon=fbcon=rotate:1\n', '/sys/class/backlight/intel_backlight/max_brightness': '96000\n', '/sys/class/backlight/intel_backlight/brightness': '96000\n', '/sys/class/graphics/fbcon/rotate': '1\n', '/sys/class/dmi/id/bios_version': 'GOLE2_JSL_D88R2_720P_U0T9G3L1\n' } });
    const r = createRunners({ run: m.run, readFile: m.readFile, writeFile: m.writeFile, listDir: m.listDir });
    const p = await r.probe();
    assert.equal(p.xAvailable, false);
    assert.deepEqual(p.outputs, []);
    assert.equal(p.rotationCfg.plymouth, 90);
    assert.equal(p.rotationCfg.fbcon, 1);
    assert.equal(p.fbconRotate, 1);
    assert.deepEqual(p.backlight, { device: 'intel_backlight', max: 96000, current: 96000 });
    assert.equal(p.dmi.bios_version, 'GOLE2_JSL_D88R2_720P_U0T9G3L1');
    assert.equal(p.virt.virtual, false);
    assert.ok(p.errors.some((e) => /X server not reachable/.test(e)));
});

test('xrandrArgsFor: one call per output carrying mode, rotation, reflection, position and transform', () => {
    const r = createRunners({ run: async () => ({ code: 0, stdout: '', stderr: '', error: null }) });
    const steps = [
        { layer: 'x', output: 'HDMI-1', action: 'rotate', rotate: 'right', reflect: 'x' },
        { layer: 'x', output: 'HDMI-1', action: 'mode', mode: '1920x1080' },
        { layer: 'x', output: 'HDMI-1', action: 'position', x: 1280, y: 0 },
        { layer: 'x', output: 'HDMI-1', action: 'fit', width: 1920, height: 1080, fit: { scaleX: 0.95, scaleY: 0.95, offsetX: 0, offsetY: 0 } },
    ];
    const args = r.xrandrArgsFor('HDMI-1', steps);
    assert.deepEqual(args.slice(0, 9), ['--output', 'HDMI-1', '--mode', '1920x1080', '--rotate', 'right', '--reflect', 'x', '--pos']);
    assert.equal(args[9], '1280x0');
    assert.equal(args[10], '--transform');
    assert.ok(/^1\.052632,0,-50\.526316,0,1\.052632,-28\.421053,0,0,1$/.test(args[11]), args[11]);
    assert.deepEqual(r.xrandrArgsFor('DP-1', [{ layer: 'x', output: 'DP-1', action: 'off' }]), ['--output', 'DP-1', '--off']);
    assert.deepEqual(r.xrandrArgsFor('eDP-1', [{ layer: 'x', output: 'eDP-1', action: 'rotate', rotate: 'normal', reflect: 'normal' }, { layer: 'x', output: 'eDP-1', action: 'fit-reset' }]),
        ['--output', 'eDP-1', '--auto', '--rotate', 'normal', '--reflect', 'normal', '--transform', 'none']);
});

test('inputClassConf: one InputClass per matrix, matched by product name, the nine-value TransformationMatrix (the live property, so it never stacks)', () => {
    const r = createRunners({ run: async () => ({ code: 0, stdout: '', stderr: '', error: null }) });
    const conf = r.inputClassConf([{ layer: 'input', device: 10, name: 'Goodix Capacitive TouchScreen', action: 'matrix', matrix: O.toInputMatrix(O.make('left')) }], [{ id: 10, name: 'Goodix Capacitive TouchScreen' }]);
    assert.match(conf, /Section "InputClass"/);
    assert.match(conf, /MatchProduct "Goodix Capacitive TouchScreen"/);
    assert.match(conf, /Option "TransformationMatrix" "0 -1 1 1 0 0 0 0 1"/);
    assert.doesNotMatch(conf, /CalibrationMatrix|Driver/);
    assert.ok(conf.endsWith('EndSection\n'));
    // Only lines the root helper's allowlist accepts.
    for (const line of conf.split('\n')) assert.match(line, /^\s*(#.*|Section "InputClass"|EndSection|Identifier\s.*|MatchProduct\s.*|Option\s.*)?\s*$/, line);
});

captured('apply on the GOLE 2 Pro plan: xrandr right, the Goodix matrix, the InputClass through the helper, the boot file unchanged', async () => {
    const m = fakeMachine({
        xrandrVerbose: fixture('xrandr-verbose.gole2-dsi.txt'), xinputList: fixture('xinput-list.gole2.txt'), xinputProps: { 10: fixture('xinput-props.gole2-goodix.txt') },
        files: { '/data/plugins/user_interface/display_configuration/rotation.cfg': 'set screen=plymouth=90\nset efifb=video=efifb\nset fbcon=fbcon=rotate:1\n', '/sys/class/graphics/fbcon/rotate': '1\n', '/sys/class/backlight/intel_backlight/max_brightness': '96000\n', '/sys/class/backlight/intel_backlight/brightness': '96000\n' },
        tools: ['xrandr', 'xinput', 'xset', 'unclutter-xfixes', 'unclutter', 'xscreensaver', 'xscreensaver-command'],
    });
    const r = createRunners({ run: m.run, readFile: m.readFile, writeFile: m.writeFile, listDir: m.listDir });
    const probe = await r.probe();
    assert.equal(probe.xAvailable, true);
    assert.equal(probe.inputs.find((i) => i.id === 10).kind, 'absolute');
    const cfg = P.migrateFrom043(JSON.parse(fixture('config.gole2.0.0.40.json')));
    const plan = P.plan(cfg, probe);
    const report = await r.apply(plan, probe, { playing: false });
    assert.deepEqual(report.errors, []);
    const xr = argvOf(m.calls, 'xrandr').filter((a) => a[0] === '--output');
    assert.deepEqual(xr, [['--output', 'DSI-1', '--auto', '--rotate', 'right', '--reflect', 'normal', '--transform', 'none']]);
    const xi = argvOf(m.calls, 'xinput').filter((a) => a[0] === 'set-prop');
    assert.deepEqual(xi, [['set-prop', '10', '--type=float', 'Coordinate Transformation Matrix', '0', '-1', '1', '1', '0', '0', '0', '0', '1']], 'the property the GOLE runs live');
    const helper = m.calls.filter((c) => c.cmd === 'sudo').map((c) => c.args.slice(2));
    assert.ok(helper.some((a) => a[0] === 'xorg-conf' && a[1] === 'write' && a[2] === 'touch'));
    assert.ok(helper.some((a) => a[0] === 'xorg-conf' && a[1] === 'remove' && a[2] === 'resolution'));
    assert.ok(!helper.some((a) => a[0] === 'fbcon'), 'the console already stands at 1');
    assert.equal(report.rebootNeeded, false, 'the boot file already says what the plan says');
    assert.equal(m.fs['/data/plugins/user_interface/display_configuration/rotation.cfg'], 'set screen=plymouth=90\nset efifb=video=efifb\nset fbcon=fbcon=rotate:1\n');
    // DPMS 120 s, not while playing (idle here), brightness 1 -> 100 % on the backlight.
    assert.ok(argvOf(m.calls, 'xset').some((a) => a.join(' ') === 's off +dpms dpms 0 0 120'));
    assert.ok(helper.some((a) => a[0] === 'backlight' && a[1] === 'intel_backlight' && a[2] === '96000'));
});

captured('apply: a changed turn rewrites the boot file, turns the console now, and flags the reboot', async () => {
    const m = fakeMachine({
        xrandrVerbose: fixture('xrandr-verbose.gole2-dsi.txt'), xinputList: fixture('xinput-list.gole2.txt'), xinputProps: { 10: fixture('xinput-props.gole2-goodix.txt') },
        files: { '/data/plugins/user_interface/display_configuration/rotation.cfg': 'set screen=plymouth=90\nset efifb=video=efifb\nset fbcon=fbcon=rotate:1\n', '/sys/class/graphics/fbcon/rotate': '1\n' },
    });
    const r = createRunners({ run: m.run, readFile: m.readFile, writeFile: m.writeFile, listDir: m.listDir });
    const probe = await r.probe();
    const cfg = P.defaults();
    cfg.profiles.default.outputs['*'].orientation = 'left';
    const report = await r.apply(P.plan(cfg, probe), probe, {});
    assert.equal(report.rebootNeeded, true);
    assert.deepEqual(report.changed, ['rotation.cfg']);
    assert.equal(m.fs['/data/plugins/user_interface/display_configuration/rotation.cfg'], 'set screen=plymouth=270\nset efifb=video=efifb\nset fbcon=fbcon=rotate:3\n');
    assert.ok(m.calls.some((c) => c.cmd === 'sudo' && c.args[2] === 'fbcon' && c.args[3] === '3'));
});

captured('apply: when the root helper refuses, display settings still apply and the loss of persistence is a warning, not an error', async () => {
    const m = fakeMachine({ xrandrVerbose: fixture('xrandr-verbose.gole2-dsi.txt'), xinputList: fixture('xinput-list.gole2.txt'), xinputProps: { 10: fixture('xinput-props.gole2-goodix.txt') }, rootFails: true });
    const r = createRunners({ run: m.run, readFile: m.readFile, writeFile: m.writeFile, listDir: m.listDir });
    const probe = await r.probe();
    const report = await r.apply(P.plan(P.defaults(), probe), probe, {});
    assert.deepEqual(report.errors, []);
    assert.ok(report.warnings.some((w) => /will not persist/.test(w)));
    assert.ok(argvOf(m.calls, 'xinput').some((a) => a[0] === 'set-prop'));
});

captured('apply on the VMSVGA guest: the legacy output is left unturned and said so; no backlight means xrandr --brightness', async () => {
    const m = fakeMachine({ xrandrVerbose: fixture('xrandr-verbose.vmsvga.txt'), xinputList: fixture('xinput-list.virtualbox.txt'), xinputProps: {} });
    const r = createRunners({ run: m.run, readFile: m.readFile, writeFile: m.writeFile, listDir: m.listDir });
    const probe = await r.probe();
    const cfg = P.defaults();
    cfg.profiles.default.outputs['*'].orientation = 'right';
    cfg.profiles.default.brightness = 60;
    const report = await r.apply(P.plan(cfg, probe), probe, {});
    assert.deepEqual(report.errors, []);
    const xr = argvOf(m.calls, 'xrandr').filter((a) => a[0] === '--output');
    assert.ok(xr.some((a) => a[1] === 'default' && a.includes('--rotate') && a[a.indexOf('--rotate') + 1] === 'normal'));
    assert.ok(xr.some((a) => a[1] === 'default' && a.includes('--brightness') && a[a.indexOf('--brightness') + 1] === '0.60'));
    assert.ok(report.warnings.some((w) => /no rotation to RandR/.test(w)));
});

test('screensaver: playing with notWhilePlaying turns blanking off; stopped turns DPMS on; off type stays off; cursor hiding starts unclutter', async () => {
    const m = fakeMachine({ tools: ['xset', 'unclutter-xfixes'] });
    const r = createRunners({ run: m.run, readFile: m.readFile, writeFile: m.writeFile, listDir: m.listDir });
    const probe = { tools: { 'unclutter-xfixes': true, unclutter: false, xscreensaver: false, 'xscreensaver-command': false }, outputs: [] };
    const report = { warnings: [] };
    await r.applyScreensaver({ type: 'dpms', timeout: 120, notWhilePlaying: true, hideCursor: true }, probe, report, { playing: true });
    assert.deepEqual(argvOf(m.calls, 'xset').pop(), ['s', 'off', '-dpms']);
    assert.ok(m.calls.some((c) => c.cmd === 'unclutter-xfixes' && c.detached));
    m.calls.length = 0;
    await r.applyScreensaver({ type: 'dpms', timeout: 120, notWhilePlaying: true, hideCursor: false }, probe, report, { playing: false });
    assert.deepEqual(argvOf(m.calls, 'xset').pop(), ['s', 'off', '+dpms', 'dpms', '0', '0', '120']);
    assert.ok(m.calls.some((c) => c.cmd === 'pkill' && c.args[1] === 'unclutter-xfixes'));
    m.calls.length = 0;
    await r.applyScreensaver({ type: 'off', timeout: 120, notWhilePlaying: false, hideCursor: false }, probe, report, { playing: false });
    assert.deepEqual(argvOf(m.calls, 'xset').pop(), ['s', 'off', '-dpms']);
});

test('backlight: percent maps onto max_brightness through the helper, never below 1', async () => {
    const m = fakeMachine({});
    const r = createRunners({ run: m.run, readFile: m.readFile, writeFile: m.writeFile, listDir: m.listDir });
    const report = { warnings: [] };
    await r.applyBrightness(1, { backlight: { device: 'intel_backlight', max: 96000, current: 96000 }, outputs: [] }, report);
    assert.deepEqual(m.calls.pop().args, ['-n', ROOT, 'backlight', 'intel_backlight', '960']);
    await r.applyBrightness(50, { backlight: { device: 'intel_backlight', max: 7, current: 7 }, outputs: [] }, report);
    assert.deepEqual(m.calls.pop().args.slice(2), ['backlight', 'intel_backlight', '4']);
});
