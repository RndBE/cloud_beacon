/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require, global */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { beforeEach, test } = require('node:test');
const ts = require('typescript');

// logger-toast.ts is dependency-free, so it can be transpiled and exercised for real instead of
// being grep-matched. The dedupe rules are timing + accumulated state — the two things a regex
// over the source cannot check.
const modulePath = path.resolve(
    __dirname,
    '../../resources/js/lib/logger-toast.ts',
);

let clock = 0;
let toastModule;

function loadToastModule() {
    const transpiled = ts.transpileModule(readFileSync(modulePath, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
    }).outputText;
    const shim = { exports: {} };
    new Function('exports', 'require', 'module', transpiled)(
        shim.exports,
        require,
        shim,
    );
    return shim.exports;
}

beforeEach(() => {
    // Fresh module state per test — the store is a module-level singleton.
    clock = 1_000_000;
    global.Date.now = () => clock;
    toastModule = loadToastModule();
});

/**
 * Count the toasts actually pushed while running `run`, and return them.
 *
 * Counts emissions rather than reading the final store, because the store caps itself at 4 — a
 * regression that pushed 12 toasts would otherwise look like 4 and could slip past an assertion.
 * subscribeToasts() emits once on subscribe, so that first call isn't a push.
 */
function captureToasts(run) {
    let emissions = 0;
    let latest = [];
    const unsubscribe = toastModule.subscribeToasts((toasts) => {
        emissions += 1;
        latest = toasts;
    });
    run();
    unsubscribe();
    return { pushes: emissions - 1, toasts: latest };
}

function ewsAlarm(levelTo, nilai) {
    return {
        module: 'EWS_ALARM',
        level_from: levelTo - 1,
        level_to: levelTo,
        source: 'Test',
        nilai,
    };
}

const ewsEventErr = { module: 'EWS_EVENT', status: 'ERR', level: 3 };

test('out BOTH with the module absent does not toast on every 5s retry', () => {
    // ews-out-mode-changes.md §4: a failed level is retried ~every 5s, and §8 shows out BOTH
    // emitting EWS_ALARM + EWS_EVENT ERR per attempt. Six attempts = 30s of retrying.
    const { pushes, toasts } = captureToasts(() => {
        for (let attempt = 0; attempt < 6; attempt++) {
            toastModule.notifyModuleResponse(
                'EWS_ALARM',
                true,
                ewsAlarm(3, 51),
                {
                    spontaneous: true,
                },
            );
            toastModule.notifyModuleResponse('EWS_EVENT', true, ewsEventErr, {
                spontaneous: true,
            });
            clock += 5000;
        }
    });

    // One alarm + one event for the first attempt; the five retries are suppressed.
    assert.equal(pushes, 2);
    assert.deepEqual(
        toasts.map((t) => t.title),
        ['EWS Level 3', 'EWS Level 3'],
    );
    assert.deepEqual(
        toasts.map((t) => t.variant),
        ['success', 'error'],
    );
});

test('a retried alarm is re-surfaced once the repeat window elapses', () => {
    const { pushes } = captureToasts(() => {
        toastModule.notifyModuleResponse('EWS_ALARM', true, ewsAlarm(3, 51), {
            spontaneous: true,
        });
        clock += 31_000; // past PUSH_DEDUPE_MS — the condition still hasn't recovered
        toastModule.notifyModuleResponse('EWS_ALARM', true, ewsAlarm(3, 51), {
            spontaneous: true,
        });
    });

    assert.equal(pushes, 2);
});

test('a drifting nilai does not defeat alarm dedupe', () => {
    // The reading moves between retries; same level + same source is still the same alarm.
    const { pushes } = captureToasts(() => {
        toastModule.notifyModuleResponse('EWS_ALARM', true, ewsAlarm(3, 51.0), {
            spontaneous: true,
        });
        clock += 5000;
        toastModule.notifyModuleResponse(
            'EWS_ALARM',
            true,
            ewsAlarm(3, 51.372),
            { spontaneous: true },
        );
    });

    assert.equal(pushes, 1);
});

test('a genuine level change is never suppressed', () => {
    const { pushes, toasts } = captureToasts(() => {
        toastModule.notifyModuleResponse('EWS_ALARM', true, ewsAlarm(3, 51), {
            spontaneous: true,
        });
        clock += 5000;
        toastModule.notifyModuleResponse('EWS_ALARM', true, ewsAlarm(2, 81), {
            spontaneous: true,
        });
    });

    assert.equal(pushes, 2);
    assert.deepEqual(
        toasts.map((t) => t.title),
        ['EWS Level 3', 'EWS Level 2'],
    );
});

test('alternating pushes cannot slip past dedupe', () => {
    // The old single-slot check compared only against the immediately preceding toast, so two
    // interleaved messages defeated it regardless of how wide the window was.
    const { pushes } = captureToasts(() => {
        for (let i = 0; i < 4; i++) {
            toastModule.notifyModuleResponse(
                'EWS_ALARM',
                true,
                ewsAlarm(3, 51),
                {
                    spontaneous: true,
                },
            );
            toastModule.notifyModuleResponse('EWS_EVENT', true, ewsEventErr, {
                spontaneous: true,
            });
            clock += 1000;
        }
    });

    assert.equal(pushes, 2);
});

test('operator-triggered replies keep the short window', () => {
    // Pressing a button twice must answer twice — the wide window is only for device pushes.
    const { pushes } = captureToasts(() => {
        toastModule.notifyModuleResponse('GCM_GATE', true, {
            GCM_GATE: { id: 4, msg: 'Gate OPENING', pos: 10 },
        });
        clock += 4000; // past DEDUPE_MS, far short of PUSH_DEDUPE_MS
        toastModule.notifyModuleResponse('GCM_GATE', true, {
            GCM_GATE: { id: 4, msg: 'Gate OPENING', pos: 10 },
        });
    });

    assert.equal(pushes, 2);
});

test('a burst of near-identical gate frames still collapses', () => {
    const { pushes } = captureToasts(() => {
        for (let i = 0; i < 3; i++) {
            toastModule.notifyModuleResponse('GCM_GATE', true, {
                GCM_GATE: { id: 4, msg: 'Gate OPENING', pos: 10 },
            });
            clock += 500;
        }
    });

    assert.equal(pushes, 1);
});
