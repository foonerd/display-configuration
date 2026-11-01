'use strict';
// Static checks for the plugin, run by `npm test` and by CI. Fails on the first
// class of error that would reach a user: a file that does not parse, a UI key
// with no translation, a language missing keys, a button naming a field or a
// method that does not exist, an install script that does not end as the store
// requires.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const json = (f) => JSON.parse(read(f));
let failures = 0;
const fail = (msg) => { failures += 1; console.error('FAIL ' + msg); };

try { execFileSync(process.execPath, ['--check', path.join(root, 'index.js')], { stdio: 'pipe' }); }
catch (e) { fail('index.js: ' + e.stderr.toString().trim()); }

const languages = fs.readdirSync(path.join(root, 'i18n')).filter((f) => /^strings_[a-z]{2}\.json$/.test(f));
for (const f of ['package.json', 'config.json', 'UIConfig.json', ...languages.map((l) => 'i18n/' + l)]) {
    try { json(f); if (!read(f).endsWith('\n')) fail(f + ': no final newline'); } catch (e) { fail(f + ': ' + e.message); }
}

const pkg = json('package.json');
if (pkg.name !== 'display_configuration') fail('package.json: name is ' + pkg.name + ', the store knows display_configuration');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) fail('package.json: version ' + pkg.version + ' is not X.Y.Z');
for (const k of ['prettyName', 'plugin_type', 'icon', 'architectures', 'os', 'details', 'changelog']) {
    if (!pkg.volumio_info || !(k in pkg.volumio_info)) fail('package.json: volumio_info.' + k + ' missing');
}
if (pkg.volumio_info && pkg.volumio_info.plugin_type !== 'user_interface') fail('package.json: plugin_type is not user_interface');

// Translations are flat: every TRANSLATE.<KEY> in the UI is a key of strings_en.json.
const ui = json('UIConfig.json');
const en = json('i18n/strings_en.json');
const idx = read('index.js');
const walk = (o, where) => {
    if (typeof o === 'string') {
        if (o.startsWith('TRANSLATE.') && !(o.slice('TRANSLATE.'.length) in en)) fail(where + ': unresolvable key ' + o);
    } else if (o && typeof o === 'object') {
        Object.entries(o).forEach(([k, v]) => walk(v, where + '.' + k));
    }
};
walk(ui, 'UIConfig');

// Every button names a field the section has and a method the plugin defines, on its own endpoint.
// Volumio's UI takes onSave as "controller" and a button's onClick as "plugin"; both call the plugin.
const methods = new Set([...idx.matchAll(/^display_configuration\.prototype\.(\w+)\s*=/gm)].map((m) => m[1]));
const endpoint = 'user_interface/' + pkg.name;
const checkCall = (call, where) => {
    if (!call) return;
    if (call.type !== 'controller' && call.type !== 'plugin') fail(where + ': type is ' + call.type);
    if (call.endpoint !== endpoint) fail(where + ': endpoint ' + call.endpoint + ' is not ' + endpoint);
    if (!methods.has(call.method)) fail(where + ': method ' + call.method + ' is not defined in index.js');
};
for (const s of ui.sections) {
    checkCall(s.onSave, 'UIConfig section ' + s.id + ' onSave');
    for (const id of (s.saveButton && s.saveButton.data) || []) {
        if (!s.content.find((c) => c.id === id)) fail(`UIConfig section ${s.id}: saveButton names missing field ${id}`);
    }
    for (const c of s.content || []) checkCall(c.onClick, `UIConfig section ${s.id} field ${c.id} onClick`);
}

// Strings the code asks for by name must exist too.
for (const m of idx.matchAll(/getI18nString\('([A-Z_0-9]+)'\)/g)) {
    if (!(m[1] in en)) fail('index.js uses missing string ' + m[1]);
}

// Every language carries every English key with the same placeholders, and nothing else.
const placeholders = (s) => (String(s).match(/{{\w+}}/g) || []).sort().join(',');
for (const f of languages) {
    const b = json('i18n/' + f);
    for (const k of Object.keys(en)) {
        if (!(k in b)) fail(`${f}: missing ${k}`);
        else if (placeholders(en[k]) !== placeholders(b[k])) fail(`${f}: placeholders differ in ${k}`);
    }
    for (const k of Object.keys(b)) if (!(k in en)) fail(`${f}: extra key ${k}`);
}

// The store's installer waits for these words.
if (!/^echo "plugininstallend"\s*$/m.test(read('install.sh'))) fail('install.sh does not end with echo "plugininstallend"');
if (!/^echo "pluginuninstallend"\s*$/m.test(read('uninstall.sh'))) fail('uninstall.sh does not end with echo "pluginuninstallend"');

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('check: ok');
