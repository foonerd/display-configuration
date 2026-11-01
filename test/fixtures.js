'use strict';
// Captured command output from real devices lives in the private journal repository,
// not here. Tests that need it skip when the journal is not beside this checkout
// (as on CI); on a development machine every test runs.
const fs = require('fs');
const path = require('path');

const DIR = process.env.DISPLAY_CONFIGURATION_FIXTURES
    || path.resolve(__dirname, '..', '..', 'display-configuration-journal', 'fixtures', 'test');

const available = fs.existsSync(DIR);
const skip = available ? false : 'device captures not present (journal repository not beside this checkout)';

function fixture(name) {
    return fs.readFileSync(path.join(DIR, name), 'utf8');
}

module.exports = { DIR, available, skip, fixture };
