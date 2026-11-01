'use strict';
// The plugin shell against a fake Volumio and a fake machine: lifecycle, the one-key
// settings store, the 0.0.x migration on first start, the saves, the backups, and
// the page. No process is started; the runners get the same fake executor the
// runners tests use.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Plugin = require('../plugin/index.js');
const P = require('../plugin/lib/profile');
const { createRunners } = require('../plugin/lib/runners');
const { createStore } = require('../plugin/lib/backup');
const { fixture, skip } = require('./fixtures');

const captured = (name, fn) => test(name, { skip }, fn);

function fakeVolumio(configJson) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-shell-'));
    const configFile = path.join(dir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify(configJson));
    const toasts = [];
    const broadcasts = [];
    const logs = [];
    const callbacks = {};
    const commandRouter = {
        logger: { info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]), error: (m) => logs.push(['error', m]) },
        pluginManager: { getConfigurationFile: () => configFile },
        sharedVars: { get: (k) => (k === 'language_code' ? 'en' : undefined) },
        loadI18nStrings: () => undefined,
        getI18nString: (k) => k,
        pushToastMessage: (type, title, text) => toasts.push({ type, title, text }),
        broadcastMessage: (name, payload) => broadcasts.push({ name, payload }),
        reloadUi: () => broadcasts.push({ name: 'reloadUi' }),
        getUIConfigOnPlugin: () => plugin.getUIConfig(),
        addCallback: (name, fn) => { (callbacks[name] = callbacks[name] || []).push(fn); },
        callbacks,
        volumioGetState: () => ({ status: 'stop' }),
        i18nJson: (langFile, enFile, uiFile) => {
            const kew = require(require.resolve('kew', { paths: [path.join(__dirname, '..', 'plugin')] }));
            const en = JSON.parse(fs.readFileSync(enFile, 'utf8'));
            const tr = (o) => { if (typeof o === 'string' && o.startsWith('TRANSLATE.')) { const [ns, key] = o.slice(10).split('.'); return (en[ns] || {})[key] || o; } if (Array.isArray(o)) return o.map(tr); if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o)) r[k] = tr(o[k]); return r; } return o; };
            return kew.resolve(tr(JSON.parse(fs.readFileSync(uiFile, 'utf8'))));
        },
    };
    const plugin = new Plugin({ coreCommand: commandRouter });
    return { plugin, commandRouter, toasts, broadcasts, logs, dir, configFile, callbacks };
}

function fakeMachine({ xrandrVerbose = '', xinputList = '', xinputProps = {}, files = {} } = {}) {
    const calls = [];
    const fsys = Object.assign({}, files);
    async function run(cmd, args, opts = {}) {
        calls.push({ cmd, args: args.slice(), env: opts.env || null, input: opts.input });
        const ok = (stdout = '') => ({ code: 0, stdout, stderr: '', error: null });
        if (cmd === 'xset' && args[0] === 'q') return xrandrVerbose ? ok('ok') : { code: 1, stdout: '', stderr: 'no display', error: 'no display' };
        if (cmd === 'systemd-detect-virt') return { code: 1, stdout: 'none\n', stderr: '', error: null };
        if (cmd === 'which') return ['xrandr', 'xinput', 'xset', 'unclutter'].includes(args[0]) ? ok('/usr/bin/' + args[0]) : { code: 1, stdout: '', stderr: '', error: '' };
        if (cmd === 'xrandr' && (args[0] === '--verbose' || args[0] === '--query')) return ok(xrandrVerbose);
        if (cmd === 'xrandr' && args[0] === '--listproviders') return ok('');
        if (cmd === 'xinput' && args[0] === 'list') return ok(xinputList);
        if (cmd === 'xinput' && args[0] === 'list-props') return ok(xinputProps[args[1]] || '');
        if (cmd === 'pidof') return xrandrVerbose ? ok('1234\n') : { code: 1, stdout: '', stderr: '', error: '' };
        return ok('');
    }
    return { run, calls, fsys, readFile: (f) => (f in fsys ? fsys[f] : null), writeFile: (f, text) => { fsys[f] = text; }, listDir: () => [] };
}

function wire(v, m) {
    v.plugin.runners = createRunners({ run: m.run, readFile: m.readFile, writeFile: m.writeFile, listDir: m.listDir });
    const backupDir = path.join(v.dir, 'backups');
    v.plugin.store = createStore({ dir: backupDir });
    return v.plugin;
}

const flush = () => new Promise((r) => setTimeout(r, 20));

test('first start on a fresh install writes the defaults into the one "state" key', async () => {
    const v = fakeVolumio({ state: { type: 'string', value: '' } });
    const plugin = wire(v, fakeMachine({}));
    plugin.onVolumioStart();
    plugin.onStart();
    await flush();
    assert.deepEqual(plugin.cfg, P.defaults());
    const saved = JSON.parse(fs.readFileSync(v.configFile, 'utf8'));
    assert.deepEqual(Object.keys(saved), ['state']);
    assert.deepEqual(P.validate(JSON.parse(saved.state.value)), P.defaults());
    plugin.onStop();
    assert.deepEqual(v.callbacks.volumioPushState, [], 'the state callback is removed on stop');
});

captured('first start over a 0.0.40 config.json migrates it once, drops the old keys, and plans what the device runs', async () => {
    const old = JSON.parse(fixture('config.gole2.0.0.40.json'));
    const v = fakeVolumio(old);
    const m = fakeMachine({ xrandrVerbose: fixture('xrandr-verbose.gole2-dsi.txt'), xinputList: fixture('xinput-list.gole2.txt'), xinputProps: { 10: fixture('xinput-props.gole2-goodix.txt') }, files: { '/data/plugins/user_interface/display_configuration/rotation.cfg': 'set screen=plymouth=90\nset efifb=video=efifb\nset fbcon=fbcon=rotate:1\n' } });
    const plugin = wire(v, m);
    plugin.onVolumioStart();
    plugin.onStart();
    await plugin.applying;
    assert.equal(plugin.cfg.profiles.default.outputs['*'].orientation, 'right');
    assert.equal(plugin.cfg.profiles.default.inputs['*'].offset, 'inverted');
    const saved = JSON.parse(fs.readFileSync(v.configFile, 'utf8'));
    assert.deepEqual(Object.keys(saved), ['state'], 'the flat keys are gone');
    assert.ok(v.logs.some(([, msg]) => /migrated from the 0.0.x/.test(msg)));
    assert.deepEqual(plugin.lastReport.errors, []);
    assert.equal(plugin.lastReport.rebootNeeded, false, 'the boot file already matches');
    assert.ok(m.calls.some((c) => c.cmd === 'xrandr' && c.args.join(' ') === '--output DSI-1 --auto --rotate right --reflect normal --transform none'));
    plugin.onStop();
});

captured('saveOutput: a turn change applies, is saved, toasts the reboot note, refreshes the page and reloads the kiosk UI', async () => {
    const v = fakeVolumio({ state: { type: 'string', value: '' } });
    let turned = false;
    const right = fixture('xrandr-verbose.gole2-dsi.txt');
    const upright = right.replace('1280x720+0+0 (0x45) right', '720x1280+0+0 (0x45) normal');
    assert.notEqual(upright, right);
    const m = fakeMachine({ xrandrVerbose: right, xinputList: fixture('xinput-list.gole2.txt'), xinputProps: { 10: fixture('xinput-props.gole2-goodix.txt') } });
    const run = m.run;
    m.run = async (cmd, args, opts) => {
        if (cmd === 'xrandr' && args[0] === '--output' && args.includes('--rotate')) turned = args[args.indexOf('--rotate') + 1] !== 'normal';
        if (cmd === 'xrandr' && (args[0] === '--query' || args[0] === '--verbose')) return { code: 0, stdout: turned ? right : upright, stderr: '', error: null };
        return run(cmd, args, opts);
    };
    const plugin = wire(v, m);
    plugin.onVolumioStart();
    plugin.onStart();
    await plugin.applying;
    await plugin.getUIConfig();
    await plugin.saveOutput({ DSI_1__enabled: true, DSI_1__orientation: { value: 'right', label: 'Right' }, DSI_1__panel: { value: 'auto' }, DSI_1__mode: { value: 'preferred' }, DSI_1__fit: false, DSI_1__fit_w: 100, DSI_1__fit_h: 100, DSI_1__fit_x: 0, DSI_1__fit_y: 0 });
    assert.equal(plugin.cfg.profiles.default.outputs['*'].orientation, 'right', 'one screen: saved on the "*" entry');
    assert.equal(v.toasts.length, 1);
    assert.equal(v.toasts[0].type, 'success');
    assert.match(v.toasts[0].text, /next restart/, 'the boot file changed');
    assert.ok(v.broadcasts.some((b) => b.name === 'pushUiConfig'), 'the page refreshes itself');
    assert.ok(v.broadcasts.some((b) => b.name === 'reloadUi'), 'the geometry changed: the kiosk page reloads');
    assert.equal(m.fsys['/data/plugins/user_interface/display_configuration/rotation.cfg'], 'set screen=plymouth=90\nset efifb=video=efifb\nset fbcon=fbcon=rotate:1\n');
    plugin.onStop();
});

test('an invalid save is refused with a toast and the saved settings are untouched', async () => {
    const v = fakeVolumio({ state: { type: 'string', value: '' } });
    const plugin = wire(v, fakeMachine({}));
    plugin.onVolumioStart();
    plugin.onStart();
    await flush();
    await plugin.saveScreensaver({ screensaver_type: { value: 'dpms' }, screensaver_timeout: 999999, not_while_playing: true, hide_cursor: false, brightness: 50 });
    assert.equal(v.toasts[0].type, 'error');
    assert.match(v.toasts[0].text, /timeout/);
    assert.equal(plugin.cfg.profiles.default.screensaver.timeout, 120);
    plugin.onStop();
});

test('profiles: copy, switch, rename, delete; the last one cannot go', async () => {
    const v = fakeVolumio({ state: { type: 'string', value: '' } });
    const plugin = wire(v, fakeMachine({}));
    plugin.onVolumioStart();
    plugin.onStart();
    await flush();
    await plugin.saveProfiles({ active_profile: { value: 'default' }, profile_action: { value: 'copy' }, profile_name: 'Bedroom', profile_mode: { value: 'follow' } });
    assert.equal(plugin.cfg.activeProfile, 'Bedroom');
    assert.equal(plugin.cfg.profiles.Bedroom.mode, 'follow');
    assert.equal(plugin.cfg.profiles.default.mode, 'manual');
    await plugin.saveProfiles({ active_profile: { value: 'Bedroom' }, profile_action: { value: 'rename' }, profile_name: 'Hall', profile_mode: { value: 'manual' } });
    assert.deepEqual(Object.keys(plugin.cfg.profiles).sort(), ['Hall', 'default']);
    assert.equal(plugin.cfg.activeProfile, 'Hall');
    await plugin.saveProfiles({ active_profile: { value: 'default' }, profile_action: { value: 'use' }, profile_name: '', profile_mode: { value: 'manual' } });
    assert.equal(plugin.cfg.activeProfile, 'default');
    await plugin.saveProfiles({ active_profile: { value: 'Hall' }, profile_action: { value: 'delete' }, profile_name: '', profile_mode: { value: 'manual' } });
    assert.deepEqual(Object.keys(plugin.cfg.profiles), ['default']);
    await plugin.saveProfiles({ active_profile: { value: 'default' }, profile_action: { value: 'delete' }, profile_name: '', profile_mode: { value: 'manual' } });
    assert.equal(v.toasts[v.toasts.length - 1].type, 'error');
    assert.deepEqual(Object.keys(plugin.cfg.profiles), ['default']);
    await plugin.saveProfiles({ active_profile: { value: 'default' }, profile_action: { value: 'copy' }, profile_name: '../x', profile_mode: { value: 'manual' } });
    assert.equal(v.toasts[v.toasts.length - 1].type, 'error');
    plugin.onStop();
});

test('backups: create with a suggested name, restore applies and reports, delete, reset to defaults', async () => {
    const v = fakeVolumio({ state: { type: 'string', value: '' } });
    const plugin = wire(v, fakeMachine({}));
    plugin.onVolumioStart();
    plugin.onStart();
    await flush();
    plugin.cfg.profiles.default.brightness = 40;
    plugin.saveState(plugin.cfg);
    await plugin.runBackup({ backup_action: { value: 'create' }, backup_name: '', selected_backup: { value: '' } });
    const list = plugin.store.list();
    assert.equal(list.length, 1);
    assert.match(list[0].name, /^\d{4}-\d{2}-\d{2} \d{4}$/);
    await plugin.runBackup({ backup_action: { value: 'reset' }, backup_name: '', selected_backup: { value: '' } });
    assert.equal(plugin.cfg.profiles.default.brightness, 100);
    await plugin.runBackup({ backup_action: { value: 'restore' }, backup_name: '', selected_backup: { value: list[0].name } });
    assert.equal(plugin.cfg.profiles.default.brightness, 40);
    assert.match(v.toasts[v.toasts.length - 1].text, /restored/);
    await plugin.runBackup({ backup_action: { value: 'delete' }, backup_name: '', selected_backup: { value: list[0].name } });
    assert.equal(plugin.store.list().length, 0);
    await plugin.runBackup({ backup_action: { value: 'restore' }, backup_name: '', selected_backup: { value: '' } });
    assert.equal(v.toasts[v.toasts.length - 1].type, 'error');
    plugin.onStop();
});

test('player state: playing holds the screensaver off, stopping arms it again', async () => {
    const v = fakeVolumio({ state: { type: 'string', value: '' } });
    const m = fakeMachine({ xrandrVerbose: 'Screen 0: minimum 8 x 8, current 1280 x 720, maximum 32767 x 32767\n' });
    const plugin = wire(v, m);
    plugin.onVolumioStart();
    plugin.onStart();
    await plugin.applying;
    m.calls.length = 0;
    v.callbacks.volumioPushState[0]({ status: 'play' });
    await flush();
    assert.ok(m.calls.some((c) => c.cmd === 'xset' && c.args.join(' ') === 's off -dpms'));
    m.calls.length = 0;
    v.callbacks.volumioPushState[0]({ status: 'pause' });
    await flush();
    assert.ok(m.calls.some((c) => c.cmd === 'xset' && c.args.join(' ') === 's off +dpms dpms 0 0 120'));
    plugin.onStop();
});

test('the settings page is built from a fresh probe and names only methods this plugin has', async () => {
    const v = fakeVolumio({ state: { type: 'string', value: '' } });
    const plugin = wire(v, fakeMachine({}));
    plugin.onVolumioStart();
    plugin.onStart();
    await flush();
    const ui = await plugin.getUIConfig();
    for (const s of ui.sections) {
        if (s.onSave) assert.equal(typeof plugin[s.onSave.method], 'function', s.onSave.method);
        for (const c of s.content) if (c.onClick) assert.equal(typeof plugin[c.onClick.method], 'function', c.onClick.method);
    }
    assert.equal(ui.sections[0].description.includes('TRANSLATE'), false);
    plugin.onStop();
});
