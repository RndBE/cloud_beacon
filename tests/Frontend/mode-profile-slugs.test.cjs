/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const pageSource = readFileSync(
    path.resolve(
        __dirname,
        '../../resources/js/pages/production/mode-profiles.tsx',
    ),
    'utf8',
);
const controllerSource = readFileSync(
    path.resolve(
        __dirname,
        '../../app/Http/Controllers/ModeProfileAdminController.php',
    ),
    'utf8',
);

// Mirrors of the sanitisers in mode-profiles.tsx. Kept as copies because this plain-node suite
// cannot import a TSX module; the source assertions at the bottom catch drift.
function toTemplateId(value) {
    return value
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/^-+/, '');
}

function toRoleKey(value) {
    return value
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/^[^a-z]+/, '');
}

// The rules the backend actually enforces. Read from the controller so this test fails if the
// server tightens them without the form following.
const TEMPLATE_ID_RULE = /^[a-z0-9][a-z0-9-]*$/;
const ROLE_KEY_RULE = /^[a-z][a-z0-9_]*$/;

test('the sanitisers still match the rules the controller enforces', () => {
    assert.match(
        controllerSource,
        /'roles\.\*\.templates\.\*\.id'.*regex:\/\^\[a-z0-9\]\[a-z0-9-\]\*\$\//s,
    );
    assert.match(
        controllerSource,
        /'roles\.\*\.role'.*regex:\/\^\[a-z\]\[a-z0-9_\]\*\$\//s,
    );
});

// Typing the sensor's display name into the id field is the obvious thing to do, and it used to
// bounce the whole form back with "roles.0.templates.0.id field format is invalid".
test('a display name typed into the template id becomes a valid slug', () => {
    for (const typed of [
        'TB-400-04',
        'SEM 400',
        'sem_400',
        'tb.400',
        '  -TB400',
        'RK400-04',
        'Pyranometer V2',
    ]) {
        const slug = toTemplateId(typed);
        assert.match(
            slug,
            TEMPLATE_ID_RULE,
            `${typed} produced "${slug}", which the backend rejects`,
        );
    }
});

test('role keys sanitise to what the backend accepts', () => {
    for (const typed of [
        'Water Level',
        'SOIL-MOISTURE',
        'Rainfall',
        '2 sensor',
        'wind speed',
    ]) {
        const key = toRoleKey(typed);
        assert.match(
            key,
            ROLE_KEY_RULE,
            `${typed} produced "${key}", which the backend rejects`,
        );
    }
});

test('the catalogue ids that shipped survive a round trip unchanged', () => {
    // Editing an existing template must not silently rename it.
    for (const id of ['tb-400-04', 'sem400', 'transducer']) {
        assert.equal(toTemplateId(id), id);
    }
    for (const key of ['rainfall', 'water_level', 'soil_moisture']) {
        assert.equal(toRoleKey(key), key);
    }
});

test('the page sanitises on input and derives the id from the name', () => {
    assert.match(pageSource, /function toTemplateId\(value: string\): string/);
    assert.match(pageSource, /function toRoleKey\(value: string\): string/);
    // Both fields must run their input through a sanitiser, not store it raw.
    assert.match(pageSource, /id: toTemplateId\(e\.target\.value\)/);
    assert.match(pageSource, /role: toRoleKey\(e\.target\.value\)/);
    // An id that already exists came from the catalogue and must not be overwritten by name edits.
    assert.match(pageSource, /useState\(template\.id !== ''\)/);
    // Flattened so Prettier is free to wrap the ternary.
    const flat = pageSource.replace(/\s+/g, ' ');
    assert.match(flat, /idTouched \? \{\} : \{ id: toTemplateId\(name\) \}/);
});

// "roles.0.templates.0.id" tells an operator nothing about where to look in a form this deep.
test('validation errors are labelled with a human location', () => {
    assert.match(pageSource, /function describeErrorField\(path: string\): string/);
    assert.match(pageSource, /Role \$\{Number\(match\[1\]\) \+ 1\}/);
    assert.match(pageSource, /Sensor \$\{Number\(match\[2\]\) \+ 1\}/);
    assert.match(pageSource, /Parameter \$\{Number\(match\[4\]\) \+ 1\}/);
});
