'use strict';
// The backup store against an in-memory file system: names are constrained, a backup
// is the validated configuration with provenance, a damaged file is refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, NAME } = require('../plugin/lib/backup');
const P = require('../plugin/lib/profile');

function memfs() {
    const files = {};
    return {
        files,
        readdirSync: (d) => Object.keys(files).filter((f) => f.startsWith(d + '/')).map((f) => f.slice(d.length + 1)),
        readFileSync: (f) => { if (!(f in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files[f]; },
        writeFileSync: (f, text) => { files[f] = text; },
        renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
        unlinkSync: (f) => { if (!(f in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } delete files[f]; },
        mkdirSync: () => undefined,
    };
}

const DIR = '/data/INTERNAL/display_configuration/backups';
const fixedNow = () => new Date('2026-11-01T21:30:00Z');

test('write, list, read, remove round trip with provenance; newest first', () => {
    const fsys = memfs();
    const store = createStore({ dir: DIR, fsys, now: fixedNow });
    const cfg = P.defaults();
    cfg.profiles.default.outputs['*'].orientation = 'right';
    const body = store.write('Living room', cfg, { pluginVersion: '1.0.0', hostname: 'gole2' });
    assert.equal(body.kind, 'display_configuration.backup');
    assert.equal(body.created, '2026-11-01T21:30:00.000Z');
    assert.ok(fsys.files[DIR + '/Living room.json'].endsWith('\n'));
    const later = createStore({ dir: DIR, fsys, now: () => new Date('2026-11-02T08:00:00Z') });
    later.write('Second', P.defaults(), { pluginVersion: '1.0.0' });
    assert.deepEqual(store.list().map((b) => b.name), ['Second', 'Living room']);
    assert.equal(store.list()[1].activeProfile, 'default');
    const back = store.read('Living room');
    assert.equal(back.config.profiles.default.outputs['*'].orientation, 'right');
    assert.equal(back.hostname, 'gole2');
    store.remove('Living room');
    assert.deepEqual(store.list().map((b) => b.name), ['Second']);
});

test('names: the same rule as profile names; path separators and dots-only are refused', () => {
    const store = createStore({ dir: DIR, fsys: memfs(), now: fixedNow });
    for (const bad of ['', '../etc', 'a/b', '.hidden', 'x'.repeat(41), 'name\n']) {
        assert.throws(() => store.write(bad, P.defaults()), RangeError, bad);
        assert.equal(NAME.test(bad), false, bad);
    }
    for (const good of ['2026-11-01 2130', 'Before the new screen', 'a.b_c-d']) assert.ok(NAME.test(good), good);
});

test('a backup that fails validation or is not ours is refused on read and skipped in list', () => {
    const fsys = memfs();
    const store = createStore({ dir: DIR, fsys, now: fixedNow });
    store.write('good', P.defaults());
    fsys.files[DIR + '/broken.json'] = '{not json';
    fsys.files[DIR + '/foreign.json'] = JSON.stringify({ kind: 'other', config: {} });
    const bad = P.defaults(); bad.profiles.default.brightness = 500;
    fsys.files[DIR + '/invalid.json'] = JSON.stringify({ kind: 'display_configuration.backup', config: bad });
    fsys.files[DIR + '/notes.txt'] = 'ignored';
    assert.deepEqual(store.list().map((b) => b.name).sort(), ['foreign', 'good', 'invalid']);
    assert.throws(() => store.read('broken'), SyntaxError);
    assert.throws(() => store.read('foreign'), RangeError);
    assert.throws(() => store.read('invalid'), /brightness/);
    assert.throws(() => store.read('missing'), /ENOENT/);
});

test('write refuses an invalid configuration before touching the disk', () => {
    const fsys = memfs();
    const store = createStore({ dir: DIR, fsys, now: fixedNow });
    const bad = P.defaults(); bad.activeProfile = 'nope';
    assert.throws(() => store.write('x', bad), RangeError);
    assert.deepEqual(Object.keys(fsys.files), []);
});

test('suggestName is the local date and time to the minute', () => {
    const store = createStore({ dir: DIR, fsys: memfs(), now: () => new Date(2026, 10, 1, 21, 5) });
    assert.equal(store.suggestName(), '2026-11-01 2105');
});
