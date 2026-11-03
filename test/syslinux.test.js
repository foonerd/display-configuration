'use strict';
// The legacy BIOS boot path: the tokens the plugin owns on the APPEND line of
// /boot/syslinux.cfg, rendered by syslinux.js and written by the root helper, which
// must agree byte for byte. The Dell Latitude 3189 (Marco, 2026-11-03) is the device
// that found the gap; its file and the VM's are the captured fixtures, a template
// rendering with placeholder UUIDs runs everywhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const S = require('../plugin/lib/syslinux');
const { createRunners } = require('../plugin/lib/runners');
const P = require('../plugin/lib/profile');
const { fixture, skip } = require('./fixtures');

const captured = (name, fn) => test(name, { skip }, fn);

// recipes/devices/families/x86.sh lines 411 to 418, rendered as the image does.
const PARAMS = 'initramfs.clear splash plymouth.ignore-serial-consoles quiet loglevel=0 bootdelay=5 biosdevname=0 imgpart=UUID=11111111-2222-3333-4444-555555555555 bootpart=UUID=ABCD-1234 datapart=UUID=66666666-7777-8888-9999-000000000000 hwdevice=x86 uuidconfig=syslinux.cfg,efi/BOOT/grub.cfg imgfile=/volumio_current.sqsh logo.nologo vt.global_cursor_default=0 acpi_backlight=native net.ifnames=0 use_kmsg=no';
const STOCK = 'DEFAULT volumio\nLABEL volumio\nSAY Booting Volumio Audiophile Music Player...\n  LINUX vmlinuz\n  APPEND ' + PARAMS + '\n  INITRD volumio.initrd\n';
const INVERTED = ['plymouth=180', 'video=efifb', 'fbcon=rotate:2'];
const withTokens = (stock, tokens) => stock.replace('  APPEND ' + PARAMS, '  APPEND ' + PARAMS + ' ' + tokens.join(' '));

test('tokens: the GRUB order plymouth, video, fbcon; the all-default turn needs none', () => {
    assert.deepEqual(S.tokens({ plymouth: 0, fbcon: 0, video: {} }), []);
    assert.deepEqual(S.tokens({ plymouth: 180, fbcon: 2, video: {} }), INVERTED);
    assert.deepEqual(S.tokens({ plymouth: 90, fbcon: 1, video: { connector: 'DSI-1', mode: '720x1280' } }), ['plymouth=90', 'video=DSI-1:720x1280', 'fbcon=rotate:1']);
    assert.deepEqual(S.tokens({ plymouth: 0, fbcon: 0, video: { connector: 'Virtual-1', mode: '1280x720' } }), ['plymouth=0', 'video=Virtual-1:1280x720', 'fbcon=rotate:0']);
    assert.throws(() => S.tokens({ plymouth: 45, fbcon: 0 }), RangeError);
    assert.throws(() => S.tokens({ plymouth: 0, fbcon: 4 }), RangeError);
});

test('render: the tokens go on the end of the APPEND line and every other byte stays', () => {
    const out = S.render(STOCK, INVERTED);
    assert.equal(out, withTokens(STOCK, INVERTED));
    assert.equal(S.render(out, INVERTED), out, 'idempotent');
    assert.equal(S.render(out, ['plymouth=90', 'video=efifb', 'fbcon=rotate:1']), withTokens(STOCK, ['plymouth=90', 'video=efifb', 'fbcon=rotate:1']), 'a new turn replaces the old tokens');
    assert.equal(S.render(out, []), STOCK, 'clearing gives the stock file back byte for byte');
    assert.equal(S.render(STOCK, []), STOCK);
});

test('render: a hand-written video= of another shape and the stock parameters are never touched', () => {
    const custom = STOCK.replace(' use_kmsg=no', ' use_kmsg=no video=1280x720@60');
    const out = S.render(custom, INVERTED);
    assert.ok(out.includes(' use_kmsg=no video=1280x720@60 plymouth=180 video=efifb fbcon=rotate:2\n'));
    assert.equal(S.render(out, []), custom);
});

test('render: refuses anything that is not the one syslinux.cfg the image writes', () => {
    assert.throws(() => S.render(STOCK + '  APPEND other\n', INVERTED), /exactly one APPEND/);
    assert.throws(() => S.render(STOCK.replace('  APPEND', '  # APPEND'), INVERTED), /exactly one APPEND/);
    assert.throws(() => S.render(STOCK.replace('LABEL volumio', 'LABEL other'), INVERTED), /LABEL volumio/);
    assert.throws(() => S.render(null, INVERTED), /not readable/);
    assert.throws(() => S.render(STOCK, ['quiet']), /does not own/);
    assert.throws(() => S.render(STOCK, ['plymouth=180 init=/bin/sh']), /does not own/);
    assert.throws(() => S.render(STOCK, ['video=efifb;reboot']), /does not own/);
    assert.throws(() => S.render(STOCK, ['video=1280x720@60']), /does not own/, 'a connector-less mode is not one of ours');
});

test('effective and inEffect: the turn the running kernel was given, read from the command line', () => {
    const dell = 'BOOT_IMAGE=vmlinuz ' + PARAMS + ' initrd=volumio.initrd';
    assert.deepEqual(S.effective(dell), { plymouth: 0, fbcon: 0, video: null });
    assert.equal(S.inEffect(dell, { plymouth: 0, fbcon: 0 }), true);
    assert.equal(S.inEffect(dell, { plymouth: 180, fbcon: 2 }), false);
    const gole = 'BOOT_IMAGE=/vmlinuz ' + PARAMS + ' plymouth=90 video=efifb fbcon=rotate:1';
    assert.deepEqual(S.effective(gole), { plymouth: 90, fbcon: 1, video: null });
    assert.equal(S.inEffect(gole, { plymouth: 90, fbcon: 1 }), true);
    assert.equal(S.inEffect(gole, { plymouth: 90, fbcon: 1, video: { connector: 'DSI-1', mode: '720x1280' } }), false);
    const vm = 'BOOT_IMAGE=/vmlinuz ' + PARAMS + ' plymouth=0 video=efifb fbcon=rotate:0 video=1280x720@60';
    assert.equal(S.inEffect(vm, { plymouth: 0, fbcon: 0 }), true, 'the guest\'s own video= mode is not one of ours and does not count');
    assert.equal(S.inEffect(dell + ' plymouth=180 video=efifb fbcon=rotate:2', { plymouth: 180, fbcon: 2 }), true);
});

test('parse and detect', () => {
    assert.deepEqual(S.parse(STOCK).ours, []);
    assert.deepEqual(S.parse(withTokens(STOCK, INVERTED)), { plymouth: 180, fbcon: 2, video: null, ours: INVERTED });
    assert.deepEqual(S.parse(null).ours, []);
    assert.equal(S.detect({ efi: true, syslinuxCfg: true }), 'grub');
    assert.equal(S.detect({ efi: false, syslinuxCfg: true }), 'syslinux');
    assert.equal(S.detect({ efi: false, syslinuxCfg: false }), 'none');
});

// ---------------------------------------------------------------- the root helper

const HELPER = path.join(__dirname, '..', 'plugin', 'scripts', 'display-configuration-root.sh');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

function helper(file, ...args) {
    return spawnSync('sh', [HELPER, 'syslinux', ...args], { encoding: 'utf8', env: Object.assign({}, process.env, { DISPLAY_CONFIGURATION_TEST_SYSLINUX_CFG: file }) });
}

function tmpCopy(text) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-syslinux-'));
    const file = path.join(dir, 'syslinux.cfg');
    fs.writeFileSync(file, text);
    return file;
}

test('helper: set writes exactly what syslinux.js renders, keeps the stock file once, and clear gives it back', { skip: isRoot ? 'the test hook is for non-root runs' : false }, () => {
    const file = tmpCopy(STOCK);
    let r = helper(file, 'set', ...INVERTED);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(file, 'utf8'), S.render(STOCK, INVERTED));
    assert.equal(fs.readFileSync(file + '.display-configuration.bak', 'utf8'), STOCK);
    const mtime = fs.statSync(file).mtimeMs;
    r = helper(file, 'set', ...INVERTED);
    assert.equal(r.status, 0, 'a second set with the same tokens is a no-op');
    assert.equal(fs.statSync(file).mtimeMs, mtime, 'the file was not rewritten');
    r = helper(file, 'set', 'plymouth=90', 'video=efifb', 'fbcon=rotate:1');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(file, 'utf8'), S.render(STOCK, ['plymouth=90', 'video=efifb', 'fbcon=rotate:1']));
    assert.equal(fs.readFileSync(file + '.display-configuration.bak', 'utf8'), STOCK, 'the backup is the stock file, not the last turn');
    r = helper(file, 'clear');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(file, 'utf8'), STOCK);
    assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith('.')), [], 'no temp file left behind');
});

test('helper: refuses tokens it does not own, too many tokens, and a file that is not the image\'s', { skip: isRoot ? 'the test hook is for non-root runs' : false }, () => {
    const file = tmpCopy(STOCK);
    for (const bad of [['set', 'quiet'], ['set', 'plymouth=45'], ['set', 'fbcon=rotate:4'], ['set', 'plymouth=180 init=/bin/sh'], ['set', 'video=efifb;id'], ['set', 'video=1280x720@60'], ['set', 'plymouth=0', 'video=efifb', 'fbcon=rotate:0', 'plymouth=0'], ['clear', 'plymouth=0'], ['write'], []]) {
        const r = helper(file, ...bad);
        assert.notEqual(r.status, 0, 'accepted ' + JSON.stringify(bad));
        assert.equal(fs.readFileSync(file, 'utf8'), STOCK, 'touched the file on ' + JSON.stringify(bad));
    }
    assert.ok(!fs.existsSync(file + '.display-configuration.bak'));
    for (const text of [STOCK + '  APPEND other\n', STOCK.replace('LABEL volumio', 'LABEL other'), STOCK.replace('  APPEND', '  # APPEND')]) {
        const f = tmpCopy(text);
        const r = helper(f, 'set', ...INVERTED);
        assert.notEqual(r.status, 0);
        assert.equal(fs.readFileSync(f, 'utf8'), text);
    }
    assert.notEqual(helper(path.join(os.tmpdir(), 'dc-no-such-file-' + process.pid), 'set', ...INVERTED).status, 0);
});

captured('helper against the Dell Latitude 3189 and virtbookworm files: the same bytes as syslinux.js, and the stock file back', { skip: isRoot ? 'the test hook is for non-root runs' : false }, () => {
    for (const name of ['syslinux.dell3189.cfg', 'syslinux.virtbookworm.cfg']) {
        const stock = fixture(name);
        const file = tmpCopy(stock);
        assert.equal(helper(file, 'set', ...INVERTED).status, 0);
        const written = fs.readFileSync(file, 'utf8');
        assert.equal(written, S.render(stock, INVERTED));
        assert.equal(written.length, stock.length + 1 + INVERTED.join(' ').length);
        assert.ok(written.endsWith(' use_kmsg=no plymouth=180 video=efifb fbcon=rotate:2\n  INITRD volumio.initrd\n'));
        assert.equal(helper(file, 'clear').status, 0);
        assert.equal(fs.readFileSync(file, 'utf8'), stock);
    }
});

test('the helper passes sh -n under the shell the image has', () => {
    execFileSync('sh', ['-n', HELPER]);
});

// ---------------------------------------------------------------- the runners

function machine({ efi, files }) {
    const fsm = Object.assign({}, files);
    const calls = [];
    async function run(cmd, args, opts = {}) {
        calls.push({ cmd, args: args.slice(), env: opts.env || null });
        const ok = { code: 0, stdout: '', stderr: '', error: null };
        if (cmd === 'xset') return { code: 1, stdout: '', stderr: 'no display', error: 'no display' };
        if (cmd === 'systemd-detect-virt') return { code: 1, stdout: 'none\n', stderr: '', error: null };
        if (cmd === 'which') return { code: 1, stdout: '', stderr: '', error: null };
        if (cmd === 'sudo' && args[2] === 'syslinux') {
            // The helper, as the suite proved it: the rendering syslinux.js predicts.
            fsm[S.PATH] = S.render(fsm[S.PATH], args[3] === 'set' ? args.slice(4) : []);
        }
        return ok;
    }
    return { run, calls, fs: fsm, readFile: (f) => (f in fsm ? fsm[f] : null), writeFile: (f, t) => { fsm[f] = t; }, listDir: (d) => (d === S.EFI_DIR && efi ? ['efivars', 'fw_platform_size'] : []) };
}

const DELL_CMDLINE = 'BOOT_IMAGE=vmlinuz ' + PARAMS + ' initrd=volumio.initrd\n';

test('apply on a legacy BIOS boot: syslinux detected, the tokens set through the helper, read back, reboot flagged; a second apply is quiet', async () => {
    const m = machine({ efi: false, files: { [S.PATH]: STOCK, '/proc/cmdline': DELL_CMDLINE, '/sys/class/graphics/fbcon/rotate': '0\n' } });
    const r = createRunners(m);
    const probe = await r.probe();
    assert.equal(probe.bootloader, 'syslinux');
    const cfg = P.defaults();
    cfg.profiles.default.outputs['*'].orientation = 'inverted';
    const plan = P.plan(cfg, probe);
    const report = await r.apply(plan, probe, {});
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.changed, ['rotation.cfg', 'syslinux.cfg']);
    assert.equal(report.rebootNeeded, true);
    assert.deepEqual(report.boot, { loader: 'syslinux', inEffect: false });
    const call = m.calls.find((c) => c.cmd === 'sudo' && c.args[2] === 'syslinux');
    assert.deepEqual(call.args, ['-n', '/usr/local/bin/display-configuration-root', 'syslinux', 'set', 'plymouth=180', 'video=efifb', 'fbcon=rotate:2']);
    assert.equal(m.fs[S.PATH], withTokens(STOCK, INVERTED));
    assert.ok(m.calls.some((c) => c.cmd === 'sudo' && c.args[2] === 'fbcon' && c.args[3] === '2'), 'the console is turned now as well');

    m.calls.length = 0;
    const again = await r.apply(plan, await r.probe(), {});
    assert.deepEqual(again.changed, [], 'nothing to write when the file already reads as it must');
    assert.ok(!m.calls.some((c) => c.cmd === 'sudo' && c.args[2] === 'syslinux'));
    assert.equal(again.rebootNeeded, true, 'until the kernel line carries the turn');

    // After the restart the kernel line carries the tokens: in effect, no reboot asked.
    m.fs['/proc/cmdline'] = DELL_CMDLINE.replace(' initrd=', ' plymouth=180 video=efifb fbcon=rotate:2 initrd=');
    m.fs['/sys/class/graphics/fbcon/rotate'] = '2\n';
    const after = await r.apply(plan, await r.probe(), {});
    assert.deepEqual(after.boot, { loader: 'syslinux', inEffect: true });
    assert.equal(after.rebootNeeded, false);
});

test('apply on a legacy BIOS boot after an OS update put the stock file back: the tokens are set again', async () => {
    const m = machine({ efi: false, files: { [S.PATH]: STOCK, '/proc/cmdline': DELL_CMDLINE.replace(' initrd=', ' plymouth=180 video=efifb fbcon=rotate:2 initrd='), '/data/plugins/user_interface/display_configuration/rotation.cfg': 'set screen=plymouth=180\nset efifb=video=efifb\nset fbcon=fbcon=rotate:2\n' } });
    const r = createRunners(m);
    const cfg = P.defaults();
    cfg.profiles.default.outputs['*'].orientation = 'inverted';
    const probe = await r.probe();
    const report = await r.apply(P.plan(cfg, probe), probe, {});
    assert.deepEqual(report.changed, ['syslinux.cfg']);
    assert.equal(m.fs[S.PATH], withTokens(STOCK, INVERTED));
    assert.equal(report.boot.inEffect, true, 'the running kernel still has the turn; the file is made ready for the next boot');
});

test('apply on a legacy BIOS boot with the default turn: the stock file is left alone; a turn removed is cleared', async () => {
    const m = machine({ efi: false, files: { [S.PATH]: STOCK, '/proc/cmdline': DELL_CMDLINE } });
    const r = createRunners(m);
    const probe = await r.probe();
    const report = await r.apply(P.plan(P.defaults(), probe), probe, {});
    assert.ok(!m.calls.some((c) => c.cmd === 'sudo' && c.args[2] === 'syslinux'));
    assert.equal(m.fs[S.PATH], STOCK);
    assert.deepEqual(report.boot, { loader: 'syslinux', inEffect: true });

    m.fs[S.PATH] = withTokens(STOCK, INVERTED);
    const back = await r.apply(P.plan(P.defaults(), await r.probe()), await r.probe(), {});
    assert.deepEqual(back.changed, ['syslinux.cfg']);
    assert.equal(m.fs[S.PATH], STOCK);
    assert.deepEqual(m.calls.filter((c) => c.cmd === 'sudo' && c.args[2] === 'syslinux').pop().args.slice(2), ['syslinux', 'clear']);
});

test('apply on a UEFI boot: GRUB detected, syslinux.cfg never touched, the kernel line decides "in effect"', async () => {
    const m = machine({ efi: true, files: { [S.PATH]: STOCK, '/proc/cmdline': 'BOOT_IMAGE=/vmlinuz ' + PARAMS + ' plymouth=0 video=efifb fbcon=rotate:0 video=1280x720@60\n' } });
    const r = createRunners(m);
    const probe = await r.probe();
    assert.equal(probe.bootloader, 'grub');
    const cfg = P.defaults();
    cfg.profiles.default.outputs['*'].orientation = 'inverted';
    const report = await r.apply(P.plan(cfg, probe), probe, {});
    assert.deepEqual(report.changed, ['rotation.cfg']);
    assert.ok(!m.calls.some((c) => c.cmd === 'sudo' && c.args[2] === 'syslinux'));
    assert.equal(m.fs[S.PATH], STOCK);
    assert.deepEqual(report.boot, { loader: 'grub', inEffect: false });
    assert.equal(report.rebootNeeded, true);
    const quiet = await r.apply(P.plan(P.defaults(), probe), probe, {});
    assert.deepEqual(quiet.boot, { loader: 'grub', inEffect: true });
});

test('apply where neither boot file exists: said once as a warning, nothing written, no reboot asked', async () => {
    const m = machine({ efi: false, files: { '/proc/cmdline': 'console=tty1 quiet\n' } });
    const r = createRunners(m);
    const probe = await r.probe();
    assert.equal(probe.bootloader, 'none');
    const cfg = P.defaults();
    cfg.profiles.default.outputs['*'].orientation = 'inverted';
    const report = await r.apply(P.plan(cfg, probe), probe, {});
    assert.ok(report.warnings.some((w) => /no GRUB or syslinux/.test(w)));
    assert.ok(!(S.PATH in m.fs));
    assert.deepEqual(report.boot, { loader: 'none', inEffect: false });
});

test('apply: when the helper refuses or the file does not read back, it is an error and the file is not pretended written', async () => {
    const m = machine({ efi: false, files: { [S.PATH]: STOCK, '/proc/cmdline': DELL_CMDLINE } });
    const refusing = async (cmd, args, opts) => (cmd === 'sudo' && args[2] === 'syslinux' ? { code: 2, stdout: '', stderr: 'display-configuration-root: syslinux: refused token', error: null } : m.run(cmd, args, opts));
    const r = createRunners(Object.assign({}, m, { run: refusing }));
    const cfg = P.defaults();
    cfg.profiles.default.outputs['*'].orientation = 'inverted';
    const probe = await r.probe();
    const report = await r.apply(P.plan(cfg, probe), probe, {});
    assert.ok(report.errors.some((e) => /syslinux\.cfg: .*refused token/.test(e)));
    assert.deepEqual(report.changed, ['rotation.cfg']);
    assert.equal(m.fs[S.PATH], STOCK);
});
