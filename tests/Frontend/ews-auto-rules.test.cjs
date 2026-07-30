/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// buildEwsRulesPayload reads one piece of component state (ewsRules) and is otherwise pure, so it
// can be lifted out and driven with real rule tables. Rules are evaluated `min <= nilai < max` and
// a value landing in a gap triggers nothing at all (ews-out-mode-changes.md §8) — exactly the kind
// of silent misconfiguration worth an executable test.
const protocolPath = path.resolve(
    __dirname,
    '../../resources/js/pages/loggers/protocol.tsx',
);

function loadRuleBuilder() {
    const source = readFileSync(protocolPath, 'utf8');
    const start = source.indexOf('function buildEwsRulesPayload()');
    const end = source.indexOf('// Attach `out` only when', start);
    assert.ok(
        start !== -1 && end > start,
        'buildEwsRulesPayload not found in protocol.tsx — did it move or get renamed?',
    );
    // The function closes over `ewsRules`; expose it as a parameter instead.
    const body = source
        .slice(start, end)
        .replace(
            'function buildEwsRulesPayload()',
            'function buildEwsRulesPayload(ewsRules)',
        )
        .replace(/: EwsResult<JsonValue\[\]>/, '')
        .replace(/const out: JsonValue\[\] = \[\];/, 'const out = [];');
    const transpiled = ts.transpileModule(body, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
    }).outputText;
    const shim = { exports: {} };
    new Function(
        'exports',
        'module',
        `${transpiled}; module.exports = buildEwsRulesPayload;`,
    )(shim.exports, shim);
    return shim.exports;
}

const buildEwsRulesPayload = loadRuleBuilder();

/** Shorthand: [[min, max, level], …] → the string rows the form actually holds. */
function rows(...triples) {
    return triples.map(([min, max, level]) => ({
        min: String(min),
        max: String(max),
        level: String(level),
    }));
}

test('contiguous rules are accepted', () => {
    // The §8 ONLINE example, boundaries meeting exactly.
    const result = buildEwsRulesPayload(
        rows([0, 21, 0], [21, 51, 3], [51, 81, 2], [81, 100, 1]),
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, [
        { min: 0, max: 21, level: 0 },
        { min: 21, max: 51, level: 3 },
        { min: 51, max: 81, level: 2 },
        { min: 81, max: 100, level: 1 },
    ]);
});

test('a gap between rules is rejected with the dead range named', () => {
    const result = buildEwsRulesPayload(rows([0, 21, 0], [25, 51, 3]));

    assert.equal(result.ok, false);
    assert.match(result.error, /Rule #2/);
    assert.match(result.error, /21/);
    assert.match(result.error, /25/);
});

test('overlapping rules are rejected', () => {
    const result = buildEwsRulesPayload(rows([0, 51, 0], [21, 81, 3]));

    assert.equal(result.ok, false);
    assert.match(result.error, /menumpuk/);
});

test('decimal boundaries that meet are accepted', () => {
    // "21.0" and "21" are the same number — differing notation must not be flagged as a gap.
    const result = buildEwsRulesPayload(
        rows(['0.0', '21.0', 0], ['21', 51, 3]),
    );

    assert.equal(result.ok, true);
});

test('per-row validation still applies', () => {
    assert.equal(buildEwsRulesPayload([]).ok, false);
    assert.match(buildEwsRulesPayload([]).error, /minimal 1 rule/);

    assert.match(
        buildEwsRulesPayload(rows([0, 0, 0])).error,
        /max harus > min/,
    );
    assert.match(
        buildEwsRulesPayload(rows(['abc', 21, 0])).error,
        /min\/max harus angka/,
    );
    assert.match(
        buildEwsRulesPayload(rows([0, 21, 9])).error,
        /level harus integer 0–8/,
    );
    assert.equal(
        buildEwsRulesPayload(
            rows(
                [0, 1, 0],
                [1, 2, 0],
                [2, 3, 0],
                [3, 4, 0],
                [4, 5, 0],
                [5, 6, 0],
                [6, 7, 0],
                [7, 8, 0],
                [8, 9, 0],
            ),
        ).ok,
        false,
    );
});

test('a single rule needs no neighbour check', () => {
    assert.equal(buildEwsRulesPayload(rows([0, 9999, 3])).ok, true);
});
