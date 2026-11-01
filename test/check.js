'use strict';
// Static checks for the plugin, run by `npm test` and by CI. Fails on the first
// class of error that would reach a user: a file that does not parse, a UI key
// with no translation, a language missing keys, a button naming a field or a
// method that does not exist, an install script that does not end as the store
// requires.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..', 'plugin');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const json = (f) => JSON.parse(read(f));
let failures = 0;
const fail = (msg) => { failures += 1; console.error('FAIL ' + msg); };

for (const f of ['index.js', ...fs.readdirSync(path.join(root, 'lib')).filter((n) => n.endsWith('.js')).map((n) => 'lib/' + n)]) {
    try { execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }); }
    catch (e) { fail(f + ': ' + e.stderr.toString().trim()); }
}

const languages = fs.readdirSync(path.join(root, 'i18n')).filter((f) => /^strings_[a-z]{2}(_[A-Z]{2})?\.json$/.test(f));
for (const f of ['package.json', 'config.json', 'UIConfig.json', ...languages.map((l) => 'i18n/' + l)]) {
    try { json(f); if (!read(f).endsWith('\n')) fail(f + ': no final newline'); } catch (e) { fail(f + ': ' + e.message); }
}

// Volumio offers these languages (volumio3-backend appearance/languages.json); a file
// for any other code is never loaded.
const VOLUMIO_LANGUAGES = new Set(['ca', 'cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'gr', 'hr', 'hu', 'it', 'ja', 'ko', 'lt', 'nl', 'no', 'pl', 'pt', 'ru', 'sk', 'sv', 'th', 'tr', 'ua', 'vi', 'zh', 'zh_TW']);
for (const f of languages) {
    const code = f.slice('strings_'.length, -'.json'.length);
    if (!VOLUMIO_LANGUAGES.has(code)) fail(f + ': Volumio has no language ' + code);
}

const pkg = json('package.json');
if (pkg.name !== 'display_configuration') fail('package.json: name is ' + pkg.name + ', the store knows display_configuration');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) fail('package.json: version ' + pkg.version + ' is not X.Y.Z');
for (const k of ['prettyName', 'plugin_type', 'icon', 'architectures', 'os', 'details', 'changelog']) {
    if (!pkg.volumio_info || !(k in pkg.volumio_info)) fail('package.json: volumio_info.' + k + ' missing');
}
if (pkg.volumio_info && pkg.volumio_info.plugin_type !== 'user_interface') fail('package.json: plugin_type is not user_interface');

// Translations live under one namespace, so the core's merge of plugin strings never
// drops them as duplicates of its own keys: every TRANSLATE.DISPLAY_CONFIGURATION.<KEY>
// in the UI is a key of strings_en.json's DISPLAY_CONFIGURATION object.
const NS = 'DISPLAY_CONFIGURATION';
const ui = json('UIConfig.json');
const enFile = json('i18n/strings_en.json');
if (!enFile[NS] || Object.keys(enFile).length !== 1) fail('strings_en.json: must hold exactly the ' + NS + ' namespace');
const en = enFile[NS] || {};
const idx = read('index.js');
const walk = (o, where) => {
    if (typeof o === 'string') {
        if (o.startsWith('TRANSLATE.')) {
            const key = o.slice('TRANSLATE.'.length);
            if (!key.startsWith(NS + '.') || !(key.slice(NS.length + 1) in en)) fail(where + ': unresolvable key ' + o);
        }
    } else if (o && typeof o === 'object') {
        Object.entries(o).forEach(([k, v]) => walk(v, where + '.' + k));
    }
};
walk(ui, 'UIConfig');

// Every button names a field the section has and a method the plugin defines, on its own endpoint.
// Volumio's UI takes onSave as "controller" and a button's onClick as "plugin"; both call the plugin.
const methods = new Set([...idx.matchAll(/^\w+\.prototype\.(\w+)\s*=/gm)].map((m) => m[1]));
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

// Strings the code asks for by name must exist too: t('KEY'), toast(type, 'KEY').
const libUi = fs.existsSync(path.join(root, 'lib', 'ui.js')) ? read('lib/ui.js') : '';
for (const src of [idx, libUi]) {
    for (const m of src.matchAll(/\b(?:t|i18n|toast\([^,]+,)\s*\(?\s*'([A-Z][A-Z_0-9]+)'/g)) {
        if (!(m[1] in en)) fail('code uses missing string ' + m[1]);
    }
}

// Every language carries every English key with the same placeholders, and nothing else.
const placeholders = (s) => (String(s).match(/{{\w+}}/g) || []).sort().join(',');
for (const f of languages) {
    const file = json('i18n/' + f);
    if (!file[NS] || Object.keys(file).length !== 1) { fail(f + ': must hold exactly the ' + NS + ' namespace'); continue; }
    const b = file[NS];
    for (const k of Object.keys(en)) {
        if (!(k in b)) fail(`${f}: missing ${k}`);
        else if (placeholders(en[k]) !== placeholders(b[k])) fail(`${f}: placeholders differ in ${k}`);
        else if (typeof b[k] !== 'string' || b[k].trim() === '') fail(`${f}: empty ${k}`);
    }
    for (const k of Object.keys(b)) if (!(k in en)) fail(`${f}: extra key ${k}`);
}

// The store's installer waits for these words.
if (!/^echo "plugininstallend"\s*$/m.test(read('install.sh'))) fail('install.sh does not end with echo "plugininstallend"');
if (!/^echo "pluginuninstallend"\s*$/m.test(read('uninstall.sh'))) fail('uninstall.sh does not end with echo "pluginuninstallend"');

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('check: ok');
