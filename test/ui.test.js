'use strict';
// The settings page: built from the template, the configuration and a probe; what the
// page sends back reads into the same profile fields. Round trips must be exact.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const UI = require('../plugin/lib/ui');
const P = require('../plugin/lib/profile');
const X = require('../plugin/lib/xrandr');
const { fixture, skip } = require('./fixtures');

const captured = (name, fn) => test(name, { skip }, fn);
const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'i18n', 'strings_en.json'), 'utf8')).DISPLAY_CONFIGURATION;
const template = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'UIConfig.json'), 'utf8'));
const t = (key, vars) => { let s = en[key] || key; if (vars) for (const k of Object.keys(vars)) s = s.split('{{' + k + '}}').join(String(vars[k])); return s; };
const ENDPOINT = 'user_interface/display_configuration';
const ALL_TOOLS = { xrandr: true, xinput: true, xset: true, 'unclutter-xfixes': true, unclutter: true, xscreensaver: true, 'xscreensaver-command': true, 'xscreensaver-settings': true };

// What the page sends: selects as {value,label}, switches as booleans, inputs as typed.
function submit(section) {
    const data = {};
    for (const f of section.content) if (f.element !== 'button') data[f.id] = f.value;
    return data;
}

test('every key the builder asks for exists in English', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'lib', 'ui.js'), 'utf8');
    const asked = new Set([...src.matchAll(/\bt\('([A-Z_0-9]+)'/g)].map((m) => m[1]));
    for (const o of UI.ORIENTATIONS) asked.add('ORIENT_' + o.toUpperCase().replace('+', '_'));
    for (const p of UI.PANEL_ORIENTATIONS) asked.add('PANEL_' + p.toUpperCase().replace(/ /g, '_'));
    for (const k of asked) assert.ok(k in en, 'missing ' + k);
});

test('the boot section names the boot path and whether the running boot carries the turn', () => {
    const cfg = P.defaults();
    cfg.profiles.default.outputs['*'].orientation = 'inverted';
    const probe = (bootloader, cmdline) => ({ xAvailable: false, outputs: [], inputs: [], tools: {}, bootloader, cmdline });
    const desc = (p) => UI.build(template(), { cfg, probe: p, backups: [], t, endpoint: ENDPOINT, tools: {} }).sections.find((s) => s.id === 'boot').description;
    const dell = 'BOOT_IMAGE=vmlinuz quiet hwdevice=x86 use_kmsg=no initrd=volumio.initrd';
    assert.match(desc(probe('syslinux', dell)), /legacy BIOS \(syslinux\)/);
    assert.match(desc(probe('syslinux', dell)), /does not carry these settings yet/);
    assert.match(desc(probe('syslinux', dell + ' plymouth=180 video=efifb fbcon=rotate:2')), /carries these settings/);
    assert.match(desc(probe('grub', 'BOOT_IMAGE=/vmlinuz quiet plymouth=180 video=efifb fbcon=rotate:2')), /UEFI \(GRUB\).*carries these settings/);
    assert.match(desc(probe('none', 'console=tty1')), /cannot be turned here/);
    assert.doesNotMatch(desc(probe('none', 'console=tty1')), /restart/);
    assert.equal(desc(probe(undefined, '')), 'TRANSLATE.DISPLAY_CONFIGURATION.BOOT_DESC', 'a probe without the field changes nothing');
});

test('build without X: one placeholder screen section, inputs section without a save button, status says so', () => {
    const ui = UI.build(template(), { cfg: P.defaults(), probe: { xAvailable: false, outputs: [], inputs: [], tools: {} }, backups: [], t, endpoint: ENDPOINT, tools: {} });
    const ids = ui.sections.map((s) => s.id);
    assert.deepEqual(ids, ['profiles', 'output_none', 'inputs', 'boot', 'screensaver', 'virtual', 'backup', 'maintenance']);
    assert.match(ui.sections[0].description, /not running/);
    assert.equal(ui.sections.find((s) => s.id === 'inputs').saveButton, undefined);
    const ss = ui.sections.find((s) => s.id === 'screensaver');
    assert.equal(ss.content.some((c) => c.id === 'xscreensaver_settings'), false, 'no xscreensaver on this player: the button is gone');
    assert.deepEqual(ss.content.find((c) => c.id === 'screensaver_type').options.map((o) => o.value), ['dpms', 'off']);
});

captured('build on the GOLE: a DSI-1 section with its modes, the Goodix offset, status text, then the saved page reads back to the same profile', () => {
    const cfg = P.migrateFrom043(JSON.parse(fixture('config.gole2.0.0.40.json')));
    const probe = {
        xAvailable: true, outputs: X.parseVerbose(fixture('xrandr-verbose.gole2-dsi.txt')).outputs,
        inputs: [{ id: 10, name: 'Goodix Capacitive TouchScreen', kind: 'absolute' }],
        tools: ALL_TOOLS, virt: { virtual: false },
    };
    const ui = UI.build(template(), { cfg, probe, backups: [{ name: 'first', created: '2026-11-01T20:00:00.000Z' }], t, endpoint: ENDPOINT, tools: ALL_TOOLS });
    const out = ui.sections.find((s) => s.id === 'output_DSI_1');
    assert.ok(out, 'a section for DSI-1');
    assert.equal(out.onSave.method, 'saveOutput');
    assert.deepEqual(out.saveButton.data, out.content.map((c) => c.id));
    assert.equal(out.content.find((c) => c.id === 'DSI_1__orientation').value.value, 'right');
    const modes = out.content.find((c) => c.id === 'DSI_1__mode');
    assert.equal(modes.value.value, 'preferred');
    assert.ok(modes.options.some((o) => o.value === '720x1280'));
    assert.equal(out.content.some((c) => c.id === 'DSI_1__underscan_h'), false, 'i915 has no underscan property');
    assert.equal(out.content.some((c) => c.id === 'DSI_1__pos_x'), false, 'one screen: no layout position');
    assert.match(ui.sections[0].description, /DSI-1: 720x1280, Right \(90°\), panel reported Normal/);
    assert.match(ui.sections[0].description, /Touch: Goodix Capacitive TouchScreen/);
    const inputs = ui.sections.find((s) => s.id === 'inputs');
    assert.equal(inputs.content.find((c) => c.id === 'input_10__offset').value.value, 'inverted');
    assert.equal(inputs.content.some((c) => c.id === 'input_10__output'), false, 'one screen: no screen select');
    const backup = ui.sections.find((s) => s.id === 'backup');
    assert.equal(backup.content.find((c) => c.id === 'selected_backup').options[0].value, 'first');

    // Round trip: the page as built, submitted unchanged, reads into the same fields.
    const p = cfg.profiles.default;
    assert.deepEqual(UI.readOutput(submit(out), 'DSI-1', probe.outputs[0]), p.outputs['*']);
    assert.deepEqual(UI.readInputs(submit(inputs), probe.inputs), { 'Goodix Capacitive TouchScreen': p.inputs['*'] });
    assert.deepEqual(UI.readBoot(submit(ui.sections.find((s) => s.id === 'boot'))), p.boot);
    const ss = UI.readScreensaver(submit(ui.sections.find((s) => s.id === 'screensaver')));
    assert.deepEqual(ss.screensaver, p.screensaver);
    assert.equal(ss.brightness, p.brightness);
    assert.deepEqual(UI.readVirtual(submit(ui.sections.find((s) => s.id === 'virtual'))), p.virtual);
    assert.deepEqual(UI.readProfiles(submit(ui.sections[0])), { action: 'use', profile: 'default', mode: 'manual', name: '' });
    assert.deepEqual(UI.readBackup(submit(backup)), { action: 'create', name: '', selected: 'first' });
});

test('readOutput: fit switch off drops the fit; on reads percentages and pixels; select values arrive wrapped or bare', () => {
    const base = { X__enabled: true, X__orientation: { value: 'left', label: 'Left' }, X__panel: 'auto', X__mode: { value: 'preferred' }, X__fit: false, X__fit_w: 95, X__fit_h: '90', X__fit_x: 10, X__fit_y: -5 };
    const off = UI.readOutput(base, 'X');
    assert.equal(off.fit, null);
    assert.equal(off.orientation, 'left');
    assert.equal(off.panelOrientation, null);
    const on = UI.readOutput(Object.assign({}, base, { X__fit: true, X__panel: { value: 'Right Side Up' } }), 'X');
    assert.deepEqual(on.fit, { scaleX: 0.95, scaleY: 0.9, offsetX: 10, offsetY: -5 });
    assert.equal(on.panelOrientation, 'Right Side Up');
    assert.equal(UI.readOutput({}, 'X'), null, 'fields of another screen: nothing to read');
    const two = UI.readOutput(Object.assign({}, base, { X__pos_x: 1280, X__pos_y: 0, X__underscan_h: 32, X__underscan_v: 0 }), 'X');
    assert.deepEqual(two.position, { x: 1280, y: 0 });
    assert.deepEqual(two.underscan, { hborder: 32, vborder: 0 });
});

test('every built page validates after a round trip through the readers', () => {
    const cfg = P.defaults();
    const probe = { xAvailable: true, outputs: X.parseVerbose(fs.existsSync(path.join(__dirname, '..', '..', 'display-configuration-journal')) ? '' : '').outputs, inputs: [], tools: ALL_TOOLS, virt: { virtual: true, hypervisor: 'oracle' } };
    const ui = UI.build(template(), { cfg, probe, backups: [], t, endpoint: ENDPOINT, tools: ALL_TOOLS });
    const p = cfg.profiles.default;
    p.boot = UI.readBoot(submit(ui.sections.find((s) => s.id === 'boot')));
    Object.assign(p, UI.readScreensaver(submit(ui.sections.find((s) => s.id === 'screensaver'))));
    p.virtual = UI.readVirtual(submit(ui.sections.find((s) => s.id === 'virtual')));
    assert.doesNotThrow(() => P.validate(cfg));
    assert.match(ui.sections.find((s) => s.id === 'virtual').description, /oracle/);
});
