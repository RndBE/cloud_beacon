/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildSync } = require('esbuild');

const sourcePath = path.resolve(
    __dirname,
    '../../resources/js/lib/sidebar-group-preference.ts',
);

function loadPreferenceHelper() {
    assert.ok(
        existsSync(sourcePath),
        'Sidebar group preference helper must exist',
    );

    const result = buildSync({
        entryPoints: [sourcePath],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        write: false,
    });
    const module = { exports: {} };
    const execute = new Function(
        'module',
        'exports',
        'require',
        result.outputFiles[0].text,
    );
    execute(module, module.exports, require);

    return module.exports;
}

test('defaults every sidebar group to open', () => {
    const { DEFAULT_SIDEBAR_GROUP_STATE, SIDEBAR_GROUP_IDS } =
        loadPreferenceHelper();

    assert.deepEqual(SIDEBAR_GROUP_IDS, [
        'overview',
        'monitoring',
        'production',
        'operations',
        'management',
    ]);
    assert.deepEqual(DEFAULT_SIDEBAR_GROUP_STATE, {
        overview: true,
        monitoring: true,
        production: true,
        operations: true,
        management: true,
    });
});

test('reads and stores the last sidebar group state', () => {
    const { readStoredSidebarGroups, storeSidebarGroups } =
        loadPreferenceHelper();
    const values = new Map();
    const storage = {
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, value);
        },
    };
    const state = {
        overview: true,
        monitoring: false,
        production: true,
        operations: false,
        management: true,
    };

    storeSidebarGroups(state, storage);

    assert.deepEqual(readStoredSidebarGroups(storage), state);
});

test('falls back safely when stored sidebar group state is invalid or blocked', () => {
    const { DEFAULT_SIDEBAR_GROUP_STATE, readStoredSidebarGroups } =
        loadPreferenceHelper();
    const invalidStorage = {
        getItem() {
            return '{"overview":"yes"}';
        },
        setItem() {},
    };
    const blockedStorage = {
        getItem() {
            throw new Error('blocked');
        },
        setItem() {
            throw new Error('blocked');
        },
    };

    assert.deepEqual(
        readStoredSidebarGroups(invalidStorage),
        DEFAULT_SIDEBAR_GROUP_STATE,
    );
    assert.deepEqual(
        readStoredSidebarGroups(blockedStorage),
        DEFAULT_SIDEBAR_GROUP_STATE,
    );
});
