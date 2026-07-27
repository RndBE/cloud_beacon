/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/loggers/show.tsx'),
    'utf8',
);
const enLocale = readFileSync(
    path.resolve(__dirname, '../../resources/js/locales/en.json'),
    'utf8',
);
const idLocale = readFileSync(
    path.resolve(__dirname, '../../resources/js/locales/id.json'),
    'utf8',
);

test('logger detail renders one Kondisi Logger card with health tabs in the System tab', () => {
    assert.match(source, /interface DataHealthSummary/);
    assert.match(source, /dataHealth: DataHealthSummary/);
    assert.match(source, /function LoggerConditionCard/);
    assert.match(source, /loggerDetail\.logger_condition/);
    assert.match(source, /healthView/);
    assert.match(source, /logger_condition_tab_data/);
    assert.match(source, /Forwarding/);
    assert.match(source, /logger_condition_tab_internal/);
    assert.match(source, /logger_condition_tab_diagnostics/);
    assert.match(source, /function InternalSensorsPanel/);
    assert.match(source, /function HealthDiagnosticsPanel/);
    assert.match(source, /setHealthView/);
    assert.match(source, /logger_condition_missing_times/);
    assert.match(source, /dataHealth\.missingWindows\.map/);
    assert.match(source, /missingWindowCount/);
    assert.match(source, /dataHealth\.missing/);
    assert.match(source, /forwardingFailed/);
    assert.match(source, /href=\{dataHealth\.auditUrl\}/);

    const systemTab = source.slice(source.indexOf('value="system"'));
    assert.match(systemTab, /<LoggerConditionCard/);
    assert.doesNotMatch(systemTab, /<HealthDiagnosticsCard/);
});

test('Logger Condition card has English and Indonesian translations', () => {
    assert.match(enLocale, /"logger_condition": "Logger Condition"/);
    assert.match(idLocale, /"logger_condition": "Kondisi Logger"/);
    assert.match(enLocale, /"logger_condition_tab_diagnostics": "Diagnostics"/);
    assert.match(idLocale, /"logger_condition_tab_diagnostics": "Diagnosa"/);
});

test('System tab shows System Information and Storage above Logger Condition with Firmware embedded as a tab', () => {
    const systemTab = source.slice(source.indexOf('value="system"'));
    const systemInfoIndex = systemTab.indexOf('loggerDetail.system_information');
    const storageIndex = systemTab.indexOf('loggerDetail.storage_overview');
    const conditionIndex = systemTab.indexOf('<LoggerConditionCard');
    const firmwareIndex = systemTab.indexOf('value="firmware"');

    assert.ok(systemInfoIndex > -1, 'System Information card should exist');
    assert.ok(storageIndex > -1, 'Storage card should exist');
    assert.ok(conditionIndex > -1, 'Logger Condition card should exist');
    assert.ok(firmwareIndex > -1, 'Firmware tab should exist');
    assert.ok(
        systemInfoIndex < conditionIndex,
        'System Information should render above Logger Condition',
    );
    assert.ok(
        storageIndex < conditionIndex,
        'Storage should render above Logger Condition',
    );
    assert.match(systemTab, /<Tabs defaultValue="info">/);
    assert.match(systemTab, /<FirmwareCard[\s\S]*embedded/);

    const conditionTail = systemTab.slice(conditionIndex);
    assert.doesNotMatch(
        conditionTail,
        /<FirmwareCard[\s\S]*currentVersion=\{\s*logger\.firmwareVersion\s*\}[\s\S]*\/>/,
        'Firmware should not render as a standalone card below Logger Condition',
    );
});

test('Logger Condition tabs put Internal Sensor before Logger Data and mark missing data', () => {
    const conditionCard = source.slice(source.indexOf('function LoggerConditionCard'));
    const tabsList = conditionCard.slice(
        conditionCard.indexOf('<TabsList'),
        conditionCard.indexOf('</TabsList>'),
    );

    const internalIndex = tabsList.indexOf('value="internal"');
    const dataIndex = tabsList.indexOf('value="data"');

    assert.ok(internalIndex > -1, 'Internal Sensor tab should exist');
    assert.ok(dataIndex > -1, 'Logger Data tab should exist');
    assert.ok(
        internalIndex < dataIndex,
        'Internal Sensor tab should appear before Logger Data',
    );
    assert.match(conditionCard, /hasMissingLoggerData/);
    assert.match(
        conditionCard,
        /useState<\s*'data' \| 'forwarding' \| 'internal' \| 'diagnostics'\s*>\('internal'\)/,
    );
    assert.match(conditionCard, /<div className="relative">\s*<TabsTrigger value="data">/);
    assert.match(
        conditionCard,
        /absolute top-1 right-1 size-1\.5 animate-pulse rounded-full bg-red-500/,
    );
    assert.doesNotMatch(conditionCard, /before:animate-ping/);
});

test('Device Configuration card renders in the Mode tab', () => {
    const modeTab = source.slice(source.indexOf('value="mode"'));
    assert.match(modeTab, /<Zap className="size-5" \/> Device/);
    assert.match(modeTab, /ioRow/);
    assert.doesNotMatch(modeTab, /__device_configuration_commented__/);
});

test('System tab Device Configuration card render is commented out', () => {
    const systemTab = source.slice(source.indexOf('value="system"'));
    assert.match(systemTab, /Device Configuration card hidden by request/);
});
