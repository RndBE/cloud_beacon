/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const showSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/loggers/show.tsx'),
    'utf8',
);
const wizardSource = readFileSync(
    path.resolve(
        __dirname,
        '../../resources/js/components/loggers/mode-profile-wizard.tsx',
    ),
    'utf8',
);
const idLocaleSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/locales/id.json'),
    'utf8',
);
const enLocaleSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/locales/en.json'),
    'utf8',
);

test('Quick Setup uses the guided mode profile wizard instead of direct mode-only setup', () => {
    const quickSetupStart = showSource.indexOf('function QuickSetupWizard');
    const nextSectionStart = showSource.indexOf(
        '// =============================================================================',
        quickSetupStart + 1,
    );
    const quickSetupSource = showSource.slice(quickSetupStart, nextSectionStart);

    assert.ok(quickSetupStart > -1, 'Quick Setup component should exist');
    assert.match(quickSetupSource, /<ModeProfileWizard/);
    assert.match(quickSetupSource, /variant="inline"/);
    assert.match(quickSetupSource, /bg-card p-0 shadow-2xl/);
    assert.match(quickSetupSource, /bg-muted\/30 px-6 pt-6 pb-4/);
    assert.match(quickSetupSource, /Pilih mode, template sensor, dan Slave ID/);
    assert.match(quickSetupSource, /availableModes: allowedModes/);
    assert.match(quickSetupSource, /disabled=\{false\}/);
    assert.match(quickSetupSource, /router\.reload\(\{ only: \['logger'\] \}\)/);
    assert.doesNotMatch(quickSetupSource, /preserveState/);
    assert.doesNotMatch(quickSetupSource, /preserveScroll/);
    assert.doesNotMatch(quickSetupSource, /setActiveTab\('sensors'\)/);
    assert.doesNotMatch(quickSetupSource, /disabled=\{logger\.status === 'offline'\}/);
    assert.doesNotMatch(
        quickSetupSource,
        /api\/mqtt\/system\/set-mode/,
        'Quick Setup should no longer send mode directly without sensor preview',
    );
});

test('Quick Setup changes from mode page to sensor page when a profile has sensor roles', () => {
    assert.match(wizardSource, /inlineStep, setInlineStep/);
    assert.match(wizardSource, /setInlineStep\('mode'\)/);
    assert.match(wizardSource, /setInlineStep\('sensor'\)/);
    assert.match(wizardSource, /loadedProfile\.roles\.length > 0/);
    assert.match(wizardSource, /showModeStep/);
    assert.match(wizardSource, /showSensorStep/);
    assert.match(wizardSource, /mode_profile\.choose_sensor_title/);
    assert.match(wizardSource, /mode_profile\.choose_sensor_description/);
    assert.match(wizardSource, /mode_profile\.change_mode/);
    assert.doesNotMatch(showSource, /const \[activeTab, setActiveTab\]/);
    assert.doesNotMatch(showSource, /value=\{activeTab\}/);
});

test('Mode profile wizard presents an operator-friendly setup flow', () => {
    assert.match(wizardSource, /variant\?: 'card' \| 'inline'/);
    assert.match(wizardSource, /selectionUnavailable/);
    assert.match(wizardSource, /commandUnavailable/);
    assert.match(wizardSource, /mode_profile\.offline_notice/);
    assert.match(wizardSource, /setupSteps/);
    assert.match(wizardSource, /allowedModes\.map/);
    assert.match(wizardSource, /sm:grid-cols-2/);
    assert.match(wizardSource, /hover:border-primary\/30 hover:bg-primary\/5/);
    assert.match(wizardSource, /h-10 w-full gap-2 rounded-xl/);
    assert.match(wizardSource, /mode_profile\.impact_title/);
    assert.match(wizardSource, /Lihat detail teknis/);
    assert.match(wizardSource, /mode_profile\.slave_conflict_title/);
    assert.match(wizardSource, /mode_profile\.slave_conflict_action/);
    assert.match(wizardSource, /SET Mode Profile/);
    assert.match(wizardSource, /SET Sensor RS485/);
    assert.match(wizardSource, /SET Mapping Data/);
    assert.match(wizardSource, /mode_profile\.replace_old_sensor/);
    assert.match(wizardSource, /mode_profile\.calibration_title/);
});

test('Quick Setup step labels are localized', () => {
    assert.match(idLocaleSource, /"choose_sensor_title": "Pilih Sensor"/);
    assert.match(idLocaleSource, /"change_mode": "Ganti mode"/);
    assert.match(enLocaleSource, /"choose_sensor_title": "Choose Sensor"/);
    assert.match(enLocaleSource, /"change_mode": "Change mode"/);
});
