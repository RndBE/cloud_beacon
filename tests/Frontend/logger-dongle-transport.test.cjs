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
const protocolSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/loggers/protocol.tsx'),
    'utf8',
);
const modeProfileWizardSource = readFileSync(
    path.resolve(
        __dirname,
        '../../resources/js/components/loggers/mode-profile-wizard.tsx',
    ),
    'utf8',
);
const sensorControllerSource = readFileSync(
    path.resolve(__dirname, '../../app/Http/Controllers/SensorController.php'),
    'utf8',
);
const routesSource = readFileSync(
    path.resolve(__dirname, '../../routes/web.php'),
    'utf8',
);

test('logger detail exposes a Dongle toggle that switches protocol transport to serial', () => {
    assert.match(showSource, /useLoggerSerial/);
    assert.match(showSource, /dongleEnabled/);
    assert.match(showSource, /disconnect: disconnectDongle/);
    // The transport switch is an icon pair (Wifi / Cable), not the old
    // "Serial ON"/"Serial OFF" text button.
    assert.match(showSource, /aria-label="Gunakan MQTT"/);
    assert.match(showSource, /aria-label="Gunakan Serial"/);
    assert.match(showSource, /enableMqttTransport/);
    assert.match(showSource, /enableSerialTransport/);
    assert.match(showSource, /await disconnectDongle\(\)/);
    assert.doesNotMatch(showSource, /Serial Dongle/);
    assert.doesNotMatch(showSource, /formatSerialDongleName/);
    assert.doesNotMatch(showSource, /Dongle ON/);
    assert.doesNotMatch(showSource, /Dongle OFF/);
    assert.doesNotMatch(showSource, /hidden max-w-40 text-right/);
    assert.match(showSource, /serialProtocolCommand/);
    // Transport is derived once so the LEO-only path can force 'serial';
    // re-inlining `dongleEnabled ? 'serial' : 'mqtt'` would bypass that.
    assert.match(
        showSource,
        /const transportMode: 'mqtt' \| 'serial' =\s*\n?\s*serialOnly \|\| dongleEnabled \? 'serial' : 'mqtt';/,
    );
    assert.doesNotMatch(showSource, /transportMode=\{\s*dongleEnabled \?/);
    assert.match(
        showSource,
        /commandTransport=\{\s*dongleEnabled\s*\?\s*serialProtocolCommand\s*:\s*undefined\s*\}/,
    );
    assert.match(showSource, /api\/serial\/info\/import/);
    assert.match(showSource, /api\/serial\/sensors\/preview/);
    assert.match(showSource, /SENSORS: \{ cmd: 'GET' \}/);
    assert.match(showSource, /SENSORS: \{ cmd: 'GET_ALL' \}/);
    assert.match(showSource, /SENSORS: \{ cmd: 'GET_NAME' \}/);
    assert.match(showSource, /MAP_DATA: \{ cmd: 'GET' \}/);
    assert.match(showSource, /setCachedSensorNames/);
    assert.match(showSource, /setCachedMapSlots/);
    assert.match(showSource, /commandTransport\('REBOOT', \{ REBOOT: 1 \}\)/);
    assert.match(showSource, /SYSTEM: \{ cmd: 'SET_MODE', mode: selectedMode \}/);
    assert.match(showSource, /api\/serial\/system\/set-mode\/import/);
    assert.match(showSource, /api\/serial\/calibration\/import/);
    assert.match(showSource, /api\/serial\/sensors\/ctrl\/import/);
    assert.match(showSource, /api\/serial\/sensors\/confirm/);
    assert.match(showSource, /serialSensorSetPayloadFromForm/);
    assert.match(showSource, /serialRs485DeviceSetPayload/);
    assert.match(showSource, /serialRs232DeviceSetPayload/);
    assert.match(showSource, /serialSensorDeletePayload/);
    assert.match(showSource, /_device_synced: 'serial'/);
    assert.match(showSource, /commandTransport\('CAL', payload\)/);
    assert.match(showSource, /subscribe: subscribeDongle/);
    assert.match(showSource, /applySerialTelemetry/);
    assert.match(showSource, /ina_input/);
    assert.match(showSource, /liveLogger/);
});

test('a LEO logger hides the transport choice and forces serial', () => {
    // Transport comes from the server, never from a string test in the page.
    assert.match(showSource, /transport: 'mqtt' \| 'serial';/);
    assert.match(showSource, /const serialOnly = logger\.transport === 'serial';/);
    assert.doesNotMatch(showSource, /model.*\.includes\('LEO'\)/i);

    // The MQTT/Serial toggle only renders for devices that actually have both.
    assert.match(showSource, /\{serialOnly \? \(/);
    assert.match(showSource, /USB belum tersambung/);

    // Reopening a previously-authorized port needs no port picker, so a LEO
    // page reconnects itself. requestPort() still requires a click, hence the
    // Hubungkan button must survive.
    assert.match(showSource, /tryReconnect: tryReconnectDongle/);
    assert.match(showSource, /await tryReconnectDongle\(\)/);
    assert.match(showSource, /Hubungkan/);
});

test('protocol panel routes generic commands through the selected transport', () => {
    assert.match(protocolSource, /ProtocolTransportMode/);
    assert.match(protocolSource, /ProtocolCommandTransport/);
    assert.match(protocolSource, /transportMode = 'mqtt'/);
    assert.match(protocolSource, /runProtocolCommand/);
    assert.match(protocolSource, /commandTransport\(module, payload\)/);
    assert.match(protocolSource, /postJson\('\/api\/mqtt\/protocol\/command'/);
});

test('mode profile wizard applies guided setup through serial transport when enabled', () => {
    assert.match(modeProfileWizardSource, /transportMode = 'mqtt'/);
    assert.match(modeProfileWizardSource, /commandTransport/);
    assert.match(modeProfileWizardSource, /commandTransport\('SYSTEM'/);
    assert.match(modeProfileWizardSource, /commandTransport\(\s*'SENSORS'/);
    assert.match(modeProfileWizardSource, /commandTransport\(\s*'MAP_DATA'/);
    assert.match(modeProfileWizardSource, /api\/serial\/mode-profile\/import/);
    assert.match(modeProfileWizardSource, /api\/serial\/system\/set-mode\/import/);
    assert.match(modeProfileWizardSource, /api\/serial\/calibration\/import/);
});

test('manual sensor set and delete skip backend MQTT after serial ACK', () => {
    assert.match(routesSource, /api\/serial\/sensors\/confirm/);
    assert.match(sensorControllerSource, /deviceAlreadySynced/);
    assert.match(sensorControllerSource, /_device_synced/);
    assert.match(sensorControllerSource, /skipDevicePush/);
    assert.match(sensorControllerSource, /sendMqttSet/);
    assert.match(sensorControllerSource, /sendMqttDel/);
});
