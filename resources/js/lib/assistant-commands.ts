/**
 * Commands the AI assistant can run on the user's behalf, one per action of the
 * logger menu. `assistantTools` is the tool list for the LLM (OpenAI function
 * format: name, description, JSON-schema parameters); `runAssistantCommand`
 * executes a tool call in the browser through the same endpoints the UI uses,
 * so the user's session, CSRF and server-side permission checks still apply.
 *
 * Everything with risk other than `read`/`navigate` must be confirmed by the user
 * in the chat before it runs (see `needsConfirmation`). Full element inventory and
 * what is intentionally left out: docs/assistant-logger-catalog.md.
 */
import type { Page, RequestPayload } from '@inertiajs/core';
import { getInitialPageFromDOM } from '@inertiajs/core';
import { router } from '@inertiajs/react';
import { csrfHeaders } from '@/lib/csrf-fetch';
import { EMPTY_SENSOR_FORM, guessSensorType } from '@/lib/sensor-form';

export type Risk = 'read' | 'navigate' | 'config' | 'device' | 'destructive';
export type CommandResult = { ok: boolean; message?: string; data?: unknown };

// LLM output is untyped JSON; each command's schema documents its shape.
type Input = Record<string, any>;
type Schema = Record<string, unknown>;
type Json = any;

type AssistantCommand = {
    name: string;
    description: string;
    risk: Risk;
    input_schema: Schema;
    run: (input: Input) => Promise<CommandResult>;
};

export const needsConfirmation = (risk: Risk) =>
    risk !== 'read' && risk !== 'navigate';

// ---------------------------------------------------------------- transport

/** JSON endpoints (/api/mqtt/*, /api/check-serial, …). */
async function api(
    method: string,
    url: string,
    body?: unknown,
): Promise<CommandResult> {
    const res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...csrfHeaders(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return {
        ok: res.ok && json?.success !== false,
        message: json?.message ?? (res.ok ? undefined : `HTTP ${res.status}`),
        data: json,
    };
}

let inertiaVersion: string | null | undefined;
if (typeof window !== 'undefined') {
    router.on('navigate', (event) => {
        inertiaVersion = event.detail.page.version;
    });
}

/** Read a page's Inertia props without navigating (same data the page renders). */
async function pageProps(url: string): Promise<Json> {
    inertiaVersion ??= getInitialPageFromDOM<Page>('app')?.version ?? null;
    const res = await fetch(url, {
        credentials: 'same-origin',
        headers: {
            Accept: 'text/html, application/xhtml+xml',
            'X-Requested-With': 'XMLHttpRequest',
            'X-Inertia': 'true',
            ...(inertiaVersion ? { 'X-Inertia-Version': inertiaVersion } : {}),
        },
    });
    if (!res.ok) throw new Error(`Gagal membaca ${url} (HTTP ${res.status}).`);
    return (await res.json()).props;
}

/**
 * Inertia form endpoints (sensor CRUD, logger edit/delete, integrations…). Uses the
 * real router so the page the user is looking at updates, like a human click.
 */
function visit(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    url: string,
    data: Record<string, unknown> = {},
): Promise<CommandResult> {
    return new Promise((resolve) => {
        let settled = false;
        const done = (result: CommandResult) => {
            if (!settled) resolve(result);
            settled = true;
        };
        router.visit(url, {
            method,
            data: data as RequestPayload,
            preserveScroll: true,
            preserveState: method !== 'get',
            onSuccess: (page) => {
                const flash = page.props.flash as Json;
                done({
                    ok: true,
                    message: flash?.success ?? flash?.warning ?? undefined,
                });
            },
            onError: (errors) =>
                done({
                    ok: false,
                    message: Object.values(errors).join(' '),
                    data: errors,
                }),
            onCancel: () =>
                done({
                    ok: false,
                    message: 'Request dibatalkan oleh halaman.',
                }),
            onFinish: () =>
                done({ ok: false, message: 'Server tidak memberi respons.' }),
        });
    });
}

/** Server-sent-event endpoints (OTA download/install, USB copy). */
function stream(
    url: string,
    finals: Record<string, boolean>,
): Promise<CommandResult> {
    return new Promise((resolve) => {
        const source = new EventSource(url);
        const progress: unknown[] = [];
        let settled = false;
        const done = (result: CommandResult) => {
            if (settled) return;
            settled = true;
            source.close();
            resolve(result);
        };
        const parse = (event: Event) => {
            try {
                return JSON.parse((event as MessageEvent).data);
            } catch {
                return (event as MessageEvent).data;
            }
        };
        source.addEventListener('progress', (event) => {
            progress.push(parse(event));
            progress.splice(0, progress.length - 5);
        });
        for (const [name, ok] of Object.entries(finals)) {
            source.addEventListener(name, (event) => {
                const data = parse(event);
                done({
                    ok,
                    message: data?.message,
                    data: { event: name, ...data, progress },
                });
            });
        }
        source.onerror = () =>
            done({
                ok: false,
                message: 'Koneksi stream ke server terputus.',
                data: { progress },
            });
    });
}

// ---------------------------------------------------------------- logger helpers

async function getLogger(loggerId: string): Promise<Json> {
    return (await pageProps(`/loggers/${encodeURIComponent(loggerId)}`)).logger;
}

/** Logger that device commands can be sent to over MQTT by this user. */
async function deviceLogger(loggerId: string, manage = true): Promise<Json> {
    const logger = await getLogger(loggerId);
    if (manage && !logger.canManage)
        throw new Error('Akses ke logger ini hanya view (read-only).');
    if (!logger.deviceIdentifier)
        throw new Error('Logger belum punya device identifier.');
    // ponytail: LEO boards only talk over the browser's Web Serial port, which
    // needs a human to pick the USB port; route through commandTransport later.
    if (logger.transport === 'serial')
        throw new Error(
            'Logger LEO hanya bisa dikonfigurasi lewat USB. Buka halaman logger dan klik "Hubungkan".',
        );
    return logger;
}

async function deviceApi(
    loggerId: string,
    url: string,
    body: Record<string, unknown> = {},
    manage = true,
): Promise<CommandResult> {
    const logger = await deviceLogger(loggerId, manage);
    return api('POST', url, { id_logger: logger.deviceIdentifier, ...body });
}

/** POST /api/mqtt/protocol/command — the path behind almost every device setting. */
async function protocol(
    loggerId: string,
    module: string,
    body: Record<string, unknown>,
): Promise<CommandResult> {
    return deviceApi(loggerId, '/api/mqtt/protocol/command', {
        module,
        payload: { [module]: body },
    });
}

const loggerUrl = (id: string, path = '') =>
    `/loggers/${encodeURIComponent(id)}${path}`;

function omit<T extends Record<string, unknown>>(obj: T, keys: string[]) {
    return Object.fromEntries(
        Object.entries(obj).filter(([key]) => !keys.includes(key)),
    );
}

// ---------------------------------------------------------------- schema helpers

const str = (description?: string, extra: Schema = {}): Schema => ({
    type: 'string',
    ...(description ? { description } : {}),
    ...extra,
});
const int = (min?: number, max?: number, description?: string): Schema => ({
    type: 'integer',
    ...(min !== undefined ? { minimum: min } : {}),
    ...(max !== undefined ? { maximum: max } : {}),
    ...(description ? { description } : {}),
});
const num = (description?: string): Schema => ({
    type: 'number',
    ...(description ? { description } : {}),
});
const bool = (description?: string): Schema => ({
    type: 'boolean',
    ...(description ? { description } : {}),
});
const oneOf = (values: (string | number)[], description?: string): Schema => ({
    enum: values,
    ...(description ? { description } : {}),
});
const onOff = (description = '1 = ON, 0 = OFF') => oneOf([0, 1], description);

/** Object schema; every property is required unless listed in `optional`. */
function obj(
    properties: Record<string, Schema>,
    optional: string[] = [],
): Schema {
    return {
        type: 'object',
        properties,
        required: Object.keys(properties).filter((k) => !optional.includes(k)),
        additionalProperties: false,
    };
}

const LOGGER_ID = str('Logger id (hashed string) from list_loggers.');
const forLogger = (
    properties: Record<string, Schema> = {},
    optional: string[] = [],
) => obj({ logger_id: LOGGER_ID, ...properties }, optional);
const GCM_ID = int(
    1,
    5,
    'GCM module number (1-5), see read_device_module GCM.',
);

// ---------------------------------------------------------------- commands

const READABLE_MODULES: Record<
    string,
    { module?: string; body?: Record<string, unknown>; needsId?: boolean }
> = {
    P_OUT: {},
    SENS_DOOR: {},
    ALERT: {},
    MODBUSTCP: {},
    MODBUSTCP_MAP: { module: 'MODBUSTCP', body: { cmd: 'GETMAP' } },
    NET: {},
    SIM: {},
    RTC: { body: { command: 'GET' } },
    POWER: { body: { cmd: 'READ' } },
    POWER_CAL: {},
    EWS: {},
    GCM: {},
    GCM_MAP: { needsId: true },
    GCM_GATE: { needsId: true },
    GCM_GATE_WARN: { needsId: true },
    GCM_PUMP: { needsId: true },
    MAP_DATA: {},
};

const RS485_PARAM = obj(
    {
        id: int(
            1,
            undefined,
            'Existing sensor id (only when editing a parameter).',
        ),
        name: str('Parameter name, max 12 characters.', { maxLength: 12 }),
        unit: str(),
        scale_factor: num('Multiplier, default 1.'),
        register_address: int(0, 65535),
        reg_count: int(
            1,
            27,
            'Data type code: 1=uint16, 3=int16, 5-8=uint32 (BE/LE/BE swap/LE swap), 9-12=int32, 2/13/14/15=float32, 16-19=uint64, 20-23=int64, 24-27=double, 4=U32 legacy.',
        ),
        fast_poll: bool(),
    },
    ['id', 'unit', 'scale_factor', 'reg_count', 'fast_poll'],
);

function rs485Param(p: Input) {
    return {
        ...(p.id ? { id: p.id } : {}),
        name: p.name,
        unit: p.unit ?? '',
        scale_factor: p.scale_factor ?? 1,
        register_address: p.register_address,
        reg_count: p.reg_count ?? 1,
        fast_poll: p.fast_poll ?? false,
    };
}

const SENSOR_FIELDS: Record<string, Schema> = {
    name: str('Sensor name.'),
    unit: str('Unit, e.g. "m", "mm", "°C". Use "-" when there is none.'),
    channel: int(
        1,
        8,
        'Analog channel 1-8 (BL1100: 8, others 2) or digital channel 1-4 (BL1100: 4, others 2).',
    ),
    port: int(1, 2, 'RS232 port.'),
    analog_mode: oneOf(
        [1, 0],
        'Analog input: 1 = 4-20 mA current loop, 0 = 0-10 V.',
    ),
    min_value: num('Analog lower bound (value at 4 mA / 0 V).'),
    max_value: num('Analog upper bound (value at 20 mA / 10 V).'),
    scale_factor: num('RS232 / pulse multiplier.'),
    digital_mode: oneOf(
        [0, 1, 2],
        'Digital: 0 = logic input, 1 = pulse volatile, 2 = pulse persistent.',
    ),
    label_high: str('Logic input label for HIGH.'),
    label_low: str('Logic input label for LOW.'),
    debounce_ms: int(0, 10000),
    invert_logic: bool(),
    pulse_submode: oneOf(
        [0, 1, 2],
        'Pulse: 0 = counter, 1 = rate, 2 = auto reset.',
    ),
    timeout_sec: int(0, 86400),
    status: oneOf(['active', 'inactive', 'error']),
};

function sensorBody(form: Input) {
    const body = { ...EMPTY_SENSOR_FORM, ...form };
    return {
        ...body,
        type: guessSensorType(String(body.name), String(body.unit)),
    };
}

function checkEwsRules(rules: Input[]): string | null {
    if (!rules?.length || rules.length > 8) return 'Rules harus 1-8 baris.';
    for (const [i, r] of rules.entries()) {
        if (!(r.max > r.min)) return `Rule ${i + 1}: max harus > min.`;
        if (i > 0 && r.min !== rules[i - 1].max)
            return `Rule ${i + 1}: min harus sama dengan max rule sebelumnya (tanpa celah/tumpang tindih).`;
    }
    return null;
}

async function currentGcm(loggerId: string): Promise<Json> {
    const res = await protocol(loggerId, 'GCM', { cmd: 'GET' });
    if (!res.ok)
        throw new Error(res.message ?? 'Gagal membaca konfigurasi GCM.');
    const data = (res.data as Json)?.data;
    return data?.GCM ?? data;
}

async function firmwareCheck(loggerId: string) {
    const res = await deviceApi(loggerId, '/api/mqtt/ota/check');
    if (!res.ok) throw new Error(res.message ?? 'Cek firmware gagal.');
    return res.data as Json;
}

const commands: AssistantCommand[] = [
    // ---------------------------------------------------------- read
    {
        name: 'list_loggers',
        description:
            'List every logger the user can see (id, name, serialNumber, location, status online/warning/offline, model, firmwareVersion, project, battery, temperature, humidity, ipAddress, lastSeen, lastSyncStatus, sensorsCount) and the projects. Start here to find a logger_id.',
        risk: 'read',
        input_schema: obj({}),
        run: async () => {
            const { loggers, projects } = await pageProps('/loggers');
            return {
                ok: true,
                data: {
                    loggers: loggers.map((l: Json) => omit(l, ['modelImage'])),
                    projects,
                },
            };
        },
    },
    {
        name: 'get_logger',
        description:
            "Full detail of one logger: network, system, power rails, internal sensors, config, sensors[] (with ids, channels, slave ids), integrations, current mode + availableModes (with calibrationFields), calibration data, canManage, diagnostics (health checks) and dataHealth (today's missing minutes, forwarding). Secrets are removed.",
        risk: 'read',
        input_schema: forLogger(),
        run: async ({ logger_id }) => {
            const { logger, diagnostics, dataHealth } = await pageProps(
                loggerUrl(logger_id),
            );
            return {
                ok: true,
                data: {
                    logger: {
                        ...omit(logger, [
                            'ministesyKey',
                            'modelImage',
                            'activityLogs',
                        ]),
                        ministesyKeySet: Boolean(logger.ministesyKey),
                        integrations: logger.integrations.map((i: Json) =>
                            omit(i, ['authConfig']),
                        ),
                        recentActivity: logger.activityLogs?.slice(0, 10),
                    },
                    diagnostics,
                    dataHealth,
                },
            };
        },
    },
    {
        name: 'poll_all_loggers',
        description:
            'Ask every logger the user manages for fresh INFO over MQTT (the "Refresh" button on the logger list). Runs in the background; call list_loggers again after ~30 s.',
        risk: 'read',
        input_schema: obj({}),
        run: () => api('POST', '/api/mqtt/poll', {}),
    },
    {
        name: 'read_device_module',
        description:
            'Read the current setting of one device module directly from the logger. P_OUT (12V/24V outputs), SENS_DOOR, ALERT (buzzer), MODBUSTCP and NET (Ethernet boards BL110/BL1100 only), MODBUSTCP_MAP (Modbus register map), SIM (BL11 cellular only), RTC, POWER (voltage/current rails), POWER_CAL, EWS, GCM (bindings), GCM_MAP/GCM_GATE/GCM_GATE_WARN/GCM_PUMP (need gcm_id), MAP_DATA (slot mapping s1-s43).',
        risk: 'read',
        input_schema: forLogger(
            { module: oneOf(Object.keys(READABLE_MODULES)), gcm_id: GCM_ID },
            ['gcm_id'],
        ),
        run: async ({ logger_id, module, gcm_id }) => {
            const spec = READABLE_MODULES[module];
            if (!spec)
                return {
                    ok: false,
                    message: `Module ${module} tidak dikenal.`,
                };
            if (spec.needsId && !gcm_id)
                return { ok: false, message: `${module} butuh gcm_id.` };
            return protocol(logger_id, spec.module ?? module, {
                ...(spec.body ?? { cmd: 'GET' }),
                ...(spec.needsId ? { id: gcm_id } : {}),
            });
        },
    },
    {
        name: 'read_sensor_names',
        description:
            'Read the live sensor list from the device (name, value, unit). These names are the valid values for EWS source, GCM param map, data map slots and calibration sources.',
        risk: 'read',
        input_schema: forLogger(),
        run: ({ logger_id }) =>
            deviceApi(logger_id, '/api/mqtt/sensors/get-name', {}, false),
    },
    {
        name: 'read_calibration',
        description:
            "Read the active mode's calibration (ARR, AWLR_TD, AWLR_US, GNSS, APMS) from the device.",
        risk: 'read',
        input_schema: forLogger(),
        run: ({ logger_id }) =>
            deviceApi(logger_id, '/api/mqtt/calibration/get'),
    },
    {
        name: 'check_firmware',
        description:
            'Check firmware state: currentVersion, latestVersion, stagedVersion and state (uptodate | update = newer version can be downloaded | install = downloaded and ready to install | busy).',
        risk: 'read',
        input_schema: forLogger(),
        run: async ({ logger_id }) => ({
            ok: true,
            data: await firmwareCheck(logger_id),
        }),
    },
    {
        name: 'preview_sensor_sync',
        description:
            'Compare the sensors configured on the device with the cloud database (the "Sync" button). Returns a diff of added/removed/changed sensors. Nothing is applied; use apply_sensor_sync for that.',
        risk: 'read',
        input_schema: forLogger(),
        run: ({ logger_id }) =>
            deviceApi(logger_id, '/api/mqtt/sensors/get', { logger_id }, false),
    },
    {
        name: 'list_ftp_files',
        description:
            'Browse stored data files. Without year/month returns the available months; with year+month returns the daily CSV files of that month. source: all (default), ftp (FTP server) or logger (device SD card).',
        risk: 'read',
        input_schema: forLogger(
            {
                source: oneOf(['all', 'ftp', 'logger']),
                year: int(2020, 2099),
                month: int(1, 12),
            },
            ['source', 'year', 'month'],
        ),
        run: ({ logger_id, ...rest }) =>
            deviceApi(logger_id, '/api/mqtt/ftp/read', {
                source: 'all',
                ...rest,
            }),
    },
    {
        name: 'list_system_logs',
        description:
            'List the daily system log files on the device (names like 20260624.txt).',
        risk: 'read',
        input_schema: forLogger(),
        run: ({ logger_id }) => protocol(logger_id, 'FTP', { cmd: 'READLOGS' }),
    },
    {
        name: 'read_system_log',
        description:
            'Read one system log (device uploads the latest copy to FTP first, can take minutes). Returns the last 15000 characters. Lines look like "[HH:MM:SS] [LEVEL] [MODULE] message".',
        risk: 'read',
        input_schema: forLogger({
            filename: str('From list_system_logs, e.g. 20260624.txt'),
        }),
        run: async ({ logger_id, filename }) => {
            let res = await deviceApi(logger_id, '/api/mqtt/ftp/logview', {
                filename,
            });
            if (!res.ok)
                res = await deviceApi(logger_id, '/api/mqtt/ftp/logcontent', {
                    filename,
                });
            const data = res.data as Json;
            if (typeof data?.content === 'string')
                data.content = data.content.slice(-15000);
            return res;
        },
    },
    {
        name: 'list_sd_card_files',
        description:
            "List data on the logger SD card: without year/month returns months, with them returns that month's day files.",
        risk: 'read',
        input_schema: forLogger({ year: int(2020, 2099), month: int(1, 12) }, [
            'year',
            'month',
        ]),
        run: ({ logger_id, year, month }) =>
            protocol(
                logger_id,
                'USB',
                year && month
                    ? { cmd: 'LISTDAY', y: year, m: month }
                    : { cmd: 'LISTMONTH' },
            ),
    },
    {
        name: 'get_mode_profile',
        description:
            'Sensor templates of a guided mode (ARR, AWR, AWLR_TD, AWLR_US, APMS): roles, templates (template_id, enabled) and inputs (slave_id range). Needed before preview_mode_profile.',
        risk: 'read',
        input_schema: obj({
            mode: oneOf(['ARR', 'AWR', 'AWLR_TD', 'AWLR_US', 'APMS']),
        }),
        run: ({ mode }) =>
            api('GET', `/api/mqtt/mode-profiles/${encodeURIComponent(mode)}`),
    },
    {
        name: 'preview_mode_profile',
        description:
            'Dry-run of switching a logger to a guided mode with chosen sensor templates: shows mode change, sensors that will be created, mapping, calibration and warnings (e.g. an existing sensor on the same slave id will be replaced). Always show this to the user before apply_mode_profile.',
        risk: 'read',
        input_schema: forLogger({
            mode: oneOf(['ARR', 'AWR', 'AWLR_TD', 'AWLR_US', 'APMS']),
            selections: {
                type: 'array',
                items: obj({
                    role: str(),
                    template_id: str(),
                    slave_id: int(1, 10),
                }),
            },
        }),
        run: ({ logger_id, mode, selections }) =>
            deviceApi(logger_id, '/api/mqtt/mode-profile/preview', {
                mode,
                selections: selections.map((s: Input) => ({
                    role: s.role,
                    template_id: s.template_id,
                    inputs: { slave_id: s.slave_id },
                })),
            }),
    },

    // ---------------------------------------------------------- navigate
    {
        name: 'open_page',
        description:
            'Navigate the user\'s screen to a page of this app, e.g. "/loggers", "/loggers/{logger_id}", "/data-audit", "/forwarding-logs", "/data-masuk", "/projects". Use it so the user sees what you are working on.',
        risk: 'navigate',
        input_schema: obj({
            path: str('App-relative path starting with "/".'),
        }),
        run: async ({ path }) => {
            if (typeof path !== 'string' || !/^\/(?!\/)/.test(path))
                return { ok: false, message: 'Path harus diawali "/".' };
            return visit('get', path);
        },
    },

    // ---------------------------------------------------------- logger records
    {
        name: 'create_logger',
        description:
            'Register a new logger: checks the serial in the production registry (must exist, be unregistered and QC-passed), reads INFO from the device over MQTT, then creates it. LEO (satellite) devices cannot be added here — they need the USB flow in the Add Logger dialog.',
        risk: 'config',
        input_schema: obj(
            {
                name: str('Device name, max 255.'),
                serial_number: str(
                    'Serial printed on the device, e.g. BLC-2025-00007.',
                ),
                location: str(),
                project_id: int(
                    1,
                    undefined,
                    'Project id from list_loggers.projects.',
                ),
            },
            ['location', 'project_id'],
        ),
        run: async ({ name, serial_number, location, project_id }) => {
            const serial = String(serial_number).trim();
            const check = await api('POST', '/api/check-serial', {
                serial_number: serial,
            });
            const found = check.data as Json;
            if (!check.ok) return check;
            if (!found?.found)
                return {
                    ok: false,
                    message:
                        'Serial number tidak ditemukan di registry produksi.',
                };
            if (found.registered)
                return {
                    ok: false,
                    message: 'Serial number sudah dipakai perangkat lain.',
                };
            if (!found.qcPassed)
                return {
                    ok: false,
                    message:
                        'Serial belum lolos QC — hubungi customer support.',
                };
            if (found.device.transport === 'serial')
                return {
                    ok: false,
                    message:
                        'Perangkat LEO harus ditambahkan lewat dialog "Add Logger" dengan koneksi USB.',
                };
            const info = await api('POST', '/api/mqtt/info', {
                id_logger: found.device.deviceId,
            });
            if (!info.ok) return info;
            return visit('post', '/loggers', {
                name,
                serial_number: serial,
                location: location ?? '',
                project_id: project_id ?? null,
                mqtt_data: (info.data as Json)?.data ?? {},
            });
        },
    },
    {
        name: 'update_logger',
        description:
            'Rename a logger or change its location / project. Omitted fields keep their value; project_id null removes it from its project.',
        risk: 'config',
        input_schema: forLogger(
            {
                name: str('Max 100 characters.', { maxLength: 100 }),
                location: str(),
                project_id: { type: ['integer', 'null'] },
            },
            ['name', 'location', 'project_id'],
        ),
        run: async ({ logger_id, ...changes }) => {
            const logger = await getLogger(logger_id);
            return visit('put', loggerUrl(logger_id), {
                name: logger.name,
                location: logger.location ?? '',
                project_id: logger.projectId ?? null,
                ...changes,
            });
        },
    },
    {
        name: 'assign_logger_project',
        description:
            'Move a logger into a project (project_id) or out of any project (null).',
        risk: 'config',
        input_schema: forLogger({ project_id: { type: ['integer', 'null'] } }),
        run: ({ logger_id, project_id }) =>
            visit('put', loggerUrl(logger_id, '/project'), { project_id }),
    },
    {
        name: 'delete_logger',
        description:
            'Permanently delete a logger with all its sensors, readings, logs, integrations and audits. The serial becomes free to register again. Cannot be undone.',
        risk: 'destructive',
        input_schema: forLogger(),
        run: ({ logger_id }) => visit('delete', loggerUrl(logger_id)),
    },

    // ---------------------------------------------------------- mode & calibration
    {
        name: 'set_logger_mode',
        description:
            'Switch the operating mode only (DEFAULT, AWR, AWLR_TD, AWLR_US, ARR, GNSS, APMS) without touching sensors. For guided modes prefer preview_mode_profile + apply_mode_profile, which also set up the sensors.',
        risk: 'device',
        input_schema: forLogger({
            mode: oneOf([
                'DEFAULT',
                'AWR',
                'AWLR_TD',
                'AWLR_US',
                'ARR',
                'GNSS',
                'APMS',
            ]),
        }),
        run: ({ logger_id, mode }) =>
            deviceApi(logger_id, '/api/mqtt/system/set-mode', { mode }),
    },
    {
        name: 'apply_mode_profile',
        description:
            'Apply a guided mode with sensor templates (same input as preview_mode_profile): sets the mode, replaces RS485 sensors on the chosen slave ids, writes data mapping and default calibration. Existing sensors on those slave ids are deleted. Partial apply is possible if a step fails.',
        risk: 'destructive',
        input_schema: forLogger({
            mode: oneOf(['ARR', 'AWR', 'AWLR_TD', 'AWLR_US', 'APMS']),
            selections: {
                type: 'array',
                items: obj({
                    role: str(),
                    template_id: str(),
                    slave_id: int(1, 10),
                }),
            },
        }),
        run: async ({ logger_id, mode, selections }) => {
            const body = {
                mode,
                selections: selections.map((s: Input) => ({
                    role: s.role,
                    template_id: s.template_id,
                    inputs: { slave_id: s.slave_id },
                })),
            };
            const preview = await deviceApi(
                logger_id,
                '/api/mqtt/mode-profile/preview',
                body,
            );
            if (!preview.ok) return preview;
            const warnings = ((preview.data as Json)?.warnings ?? []) as Json[];
            return deviceApi(logger_id, '/api/mqtt/mode-profile/apply', {
                ...body,
                confirmed_warnings: warnings.map((w) => w.type),
            });
        },
    },
    {
        name: 'set_calibration',
        description:
            'Send calibration for the logger\'s current mode. Fields depend on the mode (see get_logger → availableModes[mode].calibrationFields): ARR {source, sensor: "TB-400-04"|"SEM400"}; AWLR_TD {source, sumur (well depth m), muka_air (water level m)}; AWLR_US {source, water_depth (m)}; GNSS {ch: 1|2}; APMS {awlr_source, sumur, muka_air, arr_source, arr_sensor, soil_source}. "source" values are sensor names from read_sensor_names.',
        risk: 'device',
        input_schema: forLogger({
            values: {
                type: 'object',
                description: 'Calibration fields for the current mode.',
            },
        }),
        run: ({ logger_id, values }) =>
            deviceApi(logger_id, '/api/mqtt/calibration/set', values ?? {}),
    },

    // ---------------------------------------------------------- sensors
    {
        name: 'add_sensor',
        description:
            'Add an analog, digital or RS232 sensor and push it to the device. Analog needs channel, analog_mode, min_value, max_value, unit. Digital needs channel and digital_mode (+ labels/debounce for logic, pulse_submode/scale_factor/timeout_sec for pulse). RS232 needs port, scale_factor, unit. For Modbus RS485 use add_rs485_device.',
        risk: 'config',
        input_schema: forLogger(
            {
                connection_type: oneOf(['analog', 'digital', 'rs232']),
                ...SENSOR_FIELDS,
            },
            Object.keys(SENSOR_FIELDS).filter((k) => k !== 'name'),
        ),
        run: ({ logger_id, ...form }) =>
            visit(
                'post',
                loggerUrl(logger_id, '/sensors'),
                sensorBody({ unit: '-', ...form }),
            ),
    },
    {
        name: 'update_sensor',
        description:
            'Change an analog, digital or RS232 sensor (sensor_id from get_logger). Only pass fields that change. Note: digital sub-settings (labels, debounce, pulse submode, timeout) are re-sent with defaults unless passed again.',
        risk: 'config',
        input_schema: forLogger(
            { sensor_id: int(1), ...SENSOR_FIELDS },
            Object.keys(SENSOR_FIELDS),
        ),
        run: async ({ logger_id, sensor_id, ...changes }) => {
            const logger = await getLogger(logger_id);
            const s = logger.sensors.find((x: Json) => x.id === sensor_id);
            if (!s)
                return {
                    ok: false,
                    message: `Sensor ${sensor_id} tidak ada di logger ini.`,
                };
            if (s.connectionType === 'rs485')
                return {
                    ok: false,
                    message: 'Sensor RS485 diubah lewat update_rs485_device.',
                };
            const current = {
                name: s.name,
                type: s.type,
                unit: s.unit,
                status: s.status,
                min_value: String(s.min ?? 0),
                max_value: String(s.max ?? 100),
                connection_type: s.connectionType || '',
                scale_factor: String(s.scaleFactor ?? 1),
                channel: s.channel || 1,
                analog_mode: s.analogMode ?? 1,
                port: s.port || 1,
                digital_mode:
                    s.connectionType === 'digital' ? (s.analogMode ?? 0) : 0,
                fast_poll: s.fastPoll ?? false,
            };
            const body = sensorBody({ ...current, ...changes });
            return visit(
                'put',
                loggerUrl(logger_id, `/sensors/${sensor_id}`),
                current.connection_type ? body : { ...body, type: s.type },
            );
        },
    },
    {
        name: 'delete_sensor',
        description:
            'Delete one sensor (sensor_id from get_logger) from the cloud and the device. For a whole RS485 device use delete_rs485_device.',
        risk: 'destructive',
        input_schema: forLogger({ sensor_id: int(1) }),
        run: ({ logger_id, sensor_id }) =>
            visit('delete', loggerUrl(logger_id, `/sensors/${sensor_id}`)),
    },
    {
        name: 'add_rs485_device',
        description:
            'Add a Modbus RS485 device with 1-16 parameters and push it to the device. modbus_slave_id must not be used by another RS485 device on this logger.',
        risk: 'config',
        input_schema: forLogger(
            {
                modbus_slave_id: int(1, 10),
                device_name: str('Max 50 characters.'),
                function_code: oneOf(
                    [3, 4],
                    '3 = holding registers (default), 4 = input registers.',
                ),
                baudrate: oneOf([
                    1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
                ]),
                serial_format: oneOf(['8N1', '8E1', '8O1']),
                params: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 16,
                    items: RS485_PARAM,
                },
            },
            ['device_name', 'function_code', 'baudrate', 'serial_format'],
        ),
        run: ({ logger_id, params, ...device }) =>
            visit('post', loggerUrl(logger_id, '/sensor-devices/rs485'), {
                device_name: '',
                function_code: 3,
                baudrate: 9600,
                serial_format: '8N1',
                ...device,
                params: params.map(rs485Param),
            }),
    },
    {
        name: 'update_rs485_device',
        description:
            'Change an RS485 device identified by its current slave_id. Device fields not passed keep their value. If params is passed it REPLACES the whole parameter list: keep existing ones by including their id (from get_logger sensors), parameters left out are deleted. Omit params to keep them unchanged.',
        risk: 'config',
        input_schema: forLogger(
            {
                slave_id: int(1, 10, 'Current Modbus slave id of the device.'),
                modbus_slave_id: int(1, 10, 'New slave id, if changing.'),
                device_name: str(),
                function_code: oneOf([3, 4]),
                baudrate: oneOf([
                    1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
                ]),
                serial_format: oneOf(['8N1', '8E1', '8O1']),
                params: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 16,
                    items: RS485_PARAM,
                },
            },
            [
                'modbus_slave_id',
                'device_name',
                'function_code',
                'baudrate',
                'serial_format',
                'params',
            ],
        ),
        run: async ({ logger_id, slave_id, params, ...changes }) => {
            const logger = await getLogger(logger_id);
            const members = logger.sensors.filter(
                (s: Json) =>
                    s.connectionType === 'rs485' &&
                    s.modbusSlaveId === slave_id,
            );
            if (!members.length)
                return {
                    ok: false,
                    message: `Tidak ada device RS485 dengan slave ${slave_id}.`,
                };
            const first = members[0];
            return visit(
                'put',
                loggerUrl(logger_id, `/sensor-devices/rs485/${slave_id}`),
                {
                    modbus_slave_id: slave_id,
                    device_name: first.deviceName ?? '',
                    function_code: first.functionCode ?? 3,
                    baudrate: first.baudrate ?? 9600,
                    serial_format: first.serialFormat ?? '8N1',
                    ...changes,
                    params: (
                        params ??
                        members.map((s: Json) => ({
                            id: s.id,
                            name: s.name,
                            unit: s.unit,
                            scale_factor: s.scaleFactor,
                            register_address: s.registerAddress,
                            reg_count: s.regCount ?? s.quantity,
                            fast_poll: s.fastPoll,
                        }))
                    ).map(rs485Param),
                },
            );
        },
    },
    {
        name: 'delete_rs485_device',
        description:
            'Delete an RS485 device and all its parameters (by slave_id) from the cloud and the device.',
        risk: 'destructive',
        input_schema: forLogger({ slave_id: int(1, 10) }),
        run: ({ logger_id, slave_id }) =>
            visit(
                'delete',
                loggerUrl(logger_id, `/sensor-devices/rs485/${slave_id}`),
            ),
    },
    {
        name: 'apply_sensor_sync',
        description:
            'Make the cloud sensor list match the device (re-runs preview_sensor_sync and applies it): adds sensors found on the device, updates changed ones and DELETES cloud sensors missing on the device. Show the preview to the user first.',
        risk: 'destructive',
        input_schema: forLogger(),
        run: async ({ logger_id }) => {
            const preview = await deviceApi(
                logger_id,
                '/api/mqtt/sensors/get',
                { logger_id },
                false,
            );
            if (!preview.ok) return preview;
            const { diff, summary } = preview.data as Json;
            if (
                !summary.added_count &&
                !summary.removed_count &&
                !summary.changed_count
            )
                return {
                    ok: true,
                    message: 'Sensor sudah sinkron, tidak ada perubahan.',
                };
            return api('POST', '/api/mqtt/sensors/confirm', {
                logger_id,
                diff,
            });
        },
    },
    {
        name: 'calibrate_analog_input',
        description:
            'Calibrate an analog channel with a calibrator. kind "gain": value is the RAW reading of the calibrator (mA 4-20 for current mode, V 0-10 for voltage mode), not the scaled value. kind "offset": offset in the sensor unit.',
        risk: 'device',
        input_schema: forLogger({
            channel: int(1, 8),
            kind: oneOf(['gain', 'offset']),
            value: num(),
        }),
        run: ({ logger_id, channel, kind, value }) =>
            protocol(
                logger_id,
                'CAL',
                kind === 'offset'
                    ? {
                          cmd: 'OFFSET',
                          Sens: 'Analog',
                          ch: channel,
                          actual_val: value,
                      }
                    : { cmd: 'SET', ch: channel, actual_val: value },
            ),
    },

    // ---------------------------------------------------------- digital output (relay)
    {
        name: 'configure_digital_output',
        description:
            'Set up a digital output (relay) channel: name, state at boot and failsafe. Channels 1-2 (BL1100: 1-4).',
        risk: 'config',
        input_schema: forLogger({
            channel: int(1, 4),
            name: str(),
            default_state: onOff('State at boot: 1 = ON, 0 = OFF.'),
            failsafe: onOff('1 = force OFF on failure, 0 = keep last state.'),
        }),
        run: ({ logger_id, channel, name, default_state, failsafe }) =>
            protocol(logger_id, 'SENSORS', {
                cmd: 'SET',
                type: 'DIGITAL',
                ch: channel,
                mode: 3,
                s: [name, default_state, failsafe],
            }),
    },
    {
        name: 'set_digital_output',
        description:
            'Switch a configured digital output (relay) ON or OFF now.',
        risk: 'device',
        input_schema: forLogger({ channel: int(1, 4), state: onOff() }),
        run: ({ logger_id, channel, state }) =>
            protocol(logger_id, 'SENSORS', {
                cmd: 'CTRL',
                type: 'DIGITAL',
                ch: channel,
                state,
            }),
    },
    {
        name: 'delete_digital_output',
        description:
            'Remove the digital output configuration of a channel on the device.',
        risk: 'destructive',
        input_schema: forLogger({ channel: int(1, 4) }),
        run: ({ logger_id, channel }) =>
            protocol(logger_id, 'SENSORS', {
                cmd: 'DEL',
                type: 'DIGITAL',
                ch: channel,
            }),
    },

    // ---------------------------------------------------------- device configuration
    {
        name: 'set_power_output',
        description:
            'Switch the 12V or 24V field power output that feeds external sensors. 12V does not exist on BL11/LEO boards. Turning it off cuts power to the sensors on it.',
        risk: 'device',
        input_schema: forLogger({ rail: oneOf(['12', '24']), state: onOff() }),
        run: ({ logger_id, rail, state }) =>
            protocol(logger_id, `P_OUT${rail}`, { cmd: 'SET', state }),
    },
    {
        name: 'set_door_sensor',
        description:
            'Set door sensor polarity: close_state 1 = LOW means closed, 0 = LOW means open.',
        risk: 'config',
        input_schema: forLogger({
            close_state: onOff('1 = LOW is closed, 0 = LOW is open.'),
        }),
        run: ({ logger_id, close_state }) =>
            protocol(logger_id, 'SENS_DOOR', {
                cmd: 'SET',
                close_st: close_state,
            }),
    },
    {
        name: 'set_alert_buzzer',
        description:
            'Enable/disable the logger buzzer. 0 also silences a buzzer that is sounding.',
        risk: 'config',
        input_schema: forLogger({ state: onOff() }),
        run: ({ logger_id, state }) =>
            protocol(logger_id, 'ALERT', { cmd: 'SET', state }),
    },
    {
        name: 'set_network',
        description:
            'Ethernet network settings (BL110/BL1100 only). dhcp true, or false with ip, subnet, gateway, dns. A wrong static address can take the logger offline until fixed on site.',
        risk: 'destructive',
        input_schema: forLogger(
            {
                dhcp: bool(),
                ip: str(),
                subnet: str(),
                gateway: str(),
                dns: str(),
            },
            ['ip', 'subnet', 'gateway', 'dns'],
        ),
        run: ({ logger_id, dhcp, ip, subnet, gateway, dns }) => {
            if (!dhcp && !(ip && subnet && gateway && dns))
                return Promise.resolve({
                    ok: false,
                    message: 'Static IP butuh ip, subnet, gateway dan dns.',
                });
            return protocol(logger_id, 'NET', {
                cmd: 'SET',
                d: dhcp ? [1] : [0, ip, subnet, gateway, dns],
            });
        },
    },
    {
        name: 'set_modbus_tcp',
        description:
            'Enable/disable the Modbus TCP server on Ethernet boards and set its port (default 502).',
        risk: 'config',
        input_schema: forLogger({ enable: onOff(), port: int(1, 65535) }, [
            'port',
        ]),
        run: ({ logger_id, enable, port }) =>
            protocol(logger_id, 'MODBUSTCP', {
                cmd: 'SET',
                enable,
                port: port ?? 502,
            }),
    },
    {
        name: 'set_sim',
        description:
            'Cellular settings (BL11 only): APN (max 39 chars) and network mode. The modem restarts and falls back to the previous mode after ~2 minutes if it cannot connect.',
        risk: 'device',
        input_schema: forLogger({
            apn: str(undefined, { maxLength: 39 }),
            netmode: oneOf(['AUTO', '4G', '3G', '2G']),
        }),
        run: ({ logger_id, apn, netmode }) =>
            protocol(logger_id, 'SIM', { cmd: 'SET', apn, netmode }),
    },
    {
        name: 'set_rtc',
        description: 'Set the logger clock.',
        risk: 'config',
        input_schema: forLogger(
            {
                date: str('YYYY-MM-DD', { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
                time: str('HH:MM:SS', { pattern: '^\\d{2}:\\d{2}:\\d{2}$' }),
                timezone: str('UTC offset like "+7" (default).'),
            },
            ['timezone'],
        ),
        run: ({ logger_id, date, time, timezone }) =>
            protocol(logger_id, 'RTC', {
                command: 'SET',
                date,
                time,
                timezone: timezone ?? '+7',
            }),
    },
    {
        name: 'reboot_logger',
        description:
            'Restart the logger. It goes offline briefly; waits up to 2 minutes for it to come back.',
        risk: 'device',
        input_schema: forLogger(),
        run: ({ logger_id }) => deviceApi(logger_id, '/api/mqtt/reboot'),
    },

    // ---------------------------------------------------------- EWS (early warning siren)
    {
        name: 'set_ews_enabled',
        description:
            'Arm or disarm the EWS siren module. When enabling: channel = RS232 port of the siren (2 only on BL1100), output (firmware ≥ 2.1.3) MODULE = siren only, ONLINE = MQTT only, BOTH. Disabling is refused while a gate pre-warning is active.',
        risk: 'device',
        input_schema: forLogger(
            {
                enabled: bool(),
                channel: oneOf([1, 2]),
                output: oneOf(['MODULE', 'ONLINE', 'BOTH']),
            },
            ['channel', 'output'],
        ),
        run: ({ logger_id, enabled, channel, output }) =>
            protocol(
                logger_id,
                'EWS',
                enabled
                    ? {
                          cmd: 'SET',
                          enable: 1,
                          ...(output !== 'ONLINE' && channel
                              ? { ch: channel }
                              : {}),
                          ...(output ? { out: output } : {}),
                      }
                    : { cmd: 'SET', enable: 0 },
            ),
    },
    {
        name: 'set_ews_mode',
        description:
            'EWS mode. MANUAL: levels are sent with send_ews_level. AUTO: source = sensor name (read_sensor_names) and 1-8 contiguous rules {min, max, level 0-8} (each min equals the previous max), e.g. 0-10→0, 10-70→1, 70-90→2, 90-9999→3.',
        risk: 'config',
        input_schema: forLogger(
            {
                mode: oneOf(['MANUAL', 'AUTO']),
                source: str(),
                rules: {
                    type: 'array',
                    items: obj({ min: num(), max: num(), level: int(0, 8) }),
                },
            },
            ['source', 'rules'],
        ),
        run: ({ logger_id, mode, source, rules }) => {
            if (mode === 'MANUAL')
                return protocol(logger_id, 'EWS', {
                    cmd: 'SET',
                    mode: 'MANUAL',
                });
            const problem = !source
                ? 'Mode AUTO butuh source.'
                : checkEwsRules(rules);
            if (problem)
                return Promise.resolve({ ok: false, message: problem });
            return protocol(logger_id, 'EWS', {
                cmd: 'SET',
                mode: 'AUTO',
                source,
                rules,
            });
        },
    },
    {
        name: 'send_ews_level',
        description:
            'Sound an alert level now (EWS must be in MANUAL mode): 0 normal, 1-3 alert with siren, 6-8 alert 1-3 without siren.',
        risk: 'device',
        input_schema: forLogger({ level: oneOf([0, 1, 2, 3, 6, 7, 8]) }),
        run: ({ logger_id, level }) =>
            protocol(logger_id, 'EWS', { cmd: 'CTRL', level }),
    },

    // ---------------------------------------------------------- GCM (gate / pump controllers)
    {
        name: 'set_gcm_binding',
        description:
            'Bind GCM modules 1-5 to Modbus slaves: type awgc (gate), pump, or disabled. Only the listed modules change; others keep their current binding. Slave ids must be unique.',
        risk: 'config',
        input_schema: forLogger({
            modules: {
                type: 'array',
                minItems: 1,
                items: obj(
                    {
                        id: GCM_ID,
                        type: oneOf(['awgc', 'pump', 'disabled']),
                        slave_id: int(1, 247),
                    },
                    ['slave_id'],
                ),
            },
        }),
        run: async ({ logger_id, modules }) => {
            const current = await currentGcm(logger_id);
            const ids: Record<string, [number, number]> = {};
            for (let n = 1; n <= 5; n++)
                ids[`id${n}`] = current?.[`id${n}`] ?? [0, 0];
            for (const m of modules as Input[]) {
                ids[`id${m.id}`] =
                    m.type === 'disabled'
                        ? [0, 0]
                        : [
                              m.slave_id ?? (ids[`id${m.id}`][0] || 1),
                              m.type === 'pump' ? 2 : 1,
                          ];
            }
            const slaves = Object.values(ids)
                .map(([slave]) => slave)
                .filter(Boolean);
            if (new Set(slaves).size !== slaves.length)
                return { ok: false, message: 'Slave ID tiap GCM harus unik.' };
            const enable = slaves.length ? 1 : 0;
            return protocol(logger_id, 'GCM', { cmd: 'SET', enable, ...ids });
        },
    },
    {
        name: 'set_gcm_param_map',
        description:
            'Choose which sensors (names from read_sensor_names) a GCM module receives in its parameter registers 16-20. Up to 5 names in order; "" leaves a slot empty.',
        risk: 'config',
        input_schema: forLogger({
            gcm_id: GCM_ID,
            params: { type: 'array', maxItems: 5, items: str() },
        }),
        run: ({ logger_id, gcm_id, params }) =>
            protocol(logger_id, 'GCM_MAP', {
                cmd: 'SET',
                id: gcm_id,
                m: [16, 17, 18, 19, 20].map((reg, i) => [reg, params[i] ?? '']),
            }),
    },
    {
        name: 'control_gate',
        description:
            'Move an AWGC gate: open, close, stop the motor, or set_target to a position 0-65535. Physically moves the gate.',
        risk: 'device',
        input_schema: forLogger(
            {
                gcm_id: GCM_ID,
                action: oneOf(['open', 'close', 'stop', 'set_target']),
                target: int(0, 65535),
            },
            ['target'],
        ),
        run: ({ logger_id, gcm_id, action, target }) => {
            if (action === 'set_target') {
                if (target === undefined)
                    return Promise.resolve({
                        ok: false,
                        message: 'set_target butuh target.',
                    });
                return protocol(logger_id, 'GCM_GATE', {
                    cmd: 'SET',
                    id: gcm_id,
                    target,
                });
            }
            const cmd = { open: '1', close: '2', stop: '4' }[
                action as 'open' | 'close' | 'stop'
            ];
            return protocol(logger_id, 'GCM_GATE', { cmd, id: gcm_id });
        },
    },
    {
        name: 'set_gate_prewarning',
        description:
            'Sound the EWS horn before an AWGC gate moves (EWS must be enabled). Defaults: act on open/close/target, level 1, clear_level 0, ews_fail BLOCK, on_sec 15 (10-30), off_sec 5 (0-60), repeat 2 (1-5).',
        risk: 'config',
        input_schema: forLogger(
            {
                gcm_id: GCM_ID,
                enable: bool(),
                act_on: {
                    type: 'array',
                    items: oneOf(['open', 'close', 'target', 'stop']),
                    description: 'Gate movements that trigger the warning.',
                },
                level: int(0, 8, 'Level while horn is on.'),
                clear_level: int(0, 8, 'Level after the warning.'),
                ews_fail: oneOf(
                    ['BLOCK', 'ALLOW'],
                    'If EWS fails: BLOCK cancels the motor, ALLOW keeps it running.',
                ),
                on_sec: int(10, 30),
                off_sec: int(0, 60),
                repeat: int(1, 5),
            },
            [
                'act_on',
                'level',
                'clear_level',
                'ews_fail',
                'on_sec',
                'off_sec',
                'repeat',
            ],
        ),
        run: ({ logger_id, gcm_id, enable, act_on, ...rest }) => {
            const acts: string[] = act_on ?? ['open', 'close', 'target'];
            return protocol(logger_id, 'GCM_GATE_WARN', {
                cmd: 'SET',
                id: gcm_id,
                enable: enable ? 1 : 0,
                act: ['open', 'close', 'target', 'stop'].map((a) =>
                    acts.includes(a) ? 1 : 0,
                ),
                level: rest.level ?? 1,
                clear_level: rest.clear_level ?? 0,
                on_sec: rest.on_sec ?? 15,
                off_sec: rest.off_sec ?? 5,
                repeat: rest.repeat ?? 2,
                ews_fail: rest.ews_fail ?? 'BLOCK',
            });
        },
    },
    {
        name: 'reset_gate_prewarning',
        description: "Reset a gate's pre-warning to default (inactive).",
        risk: 'destructive',
        input_schema: forLogger({ gcm_id: GCM_ID }),
        run: ({ logger_id, gcm_id }) =>
            protocol(logger_id, 'GCM_GATE_WARN', { cmd: 'RST', id: gcm_id }),
    },
    {
        name: 'set_pump',
        description: 'Turn a GCM pump ON or OFF.',
        risk: 'device',
        input_schema: forLogger({ gcm_id: GCM_ID, state: onOff() }),
        run: ({ logger_id, gcm_id, state }) =>
            protocol(logger_id, 'GCM_PUMP', { cmd: 'SET', id: gcm_id, state }),
    },

    // ---------------------------------------------------------- data mapping
    {
        name: 'set_data_map',
        description:
            'Assign sensors to data slots s1-s43 (the order data is sent/logged). sensor = name from read_sensor_names, or "none" to clear the slot. Only listed slots change.',
        risk: 'config',
        input_schema: forLogger({
            slots: {
                type: 'array',
                minItems: 1,
                items: obj({ slot: int(1, 43), sensor: str() }),
            },
        }),
        run: ({ logger_id, slots }) =>
            protocol(logger_id, 'MAP_DATA', {
                cmd: 'SET',
                ...Object.fromEntries(
                    (slots as Input[]).map((s) => [
                        `s${s.slot}`,
                        s.sensor || 'none',
                    ]),
                ),
            }),
    },
    {
        name: 'rebuild_data_map',
        description:
            'auto: let the device regenerate the whole slot mapping. clear: erase all mappings. Both overwrite the current mapping.',
        risk: 'destructive',
        input_schema: forLogger({ action: oneOf(['auto', 'clear']) }),
        run: ({ logger_id, action }) =>
            protocol(logger_id, 'MAP_DATA', {
                cmd: action === 'auto' ? 'AUTO' : 'CLEAR',
            }),
    },

    // ---------------------------------------------------------- firmware
    {
        name: 'download_firmware',
        description:
            'Download the newest firmware to the logger (when check_firmware says state "update"). Does not install it. Can take several minutes.',
        risk: 'device',
        input_schema: forLogger(),
        run: async ({ logger_id }) => {
            const info = await firmwareCheck(logger_id);
            if (info.state !== 'update')
                return {
                    ok: false,
                    message: `Tidak ada firmware baru untuk diunduh (state: ${info.state}).`,
                    data: info,
                };
            const logger = await deviceLogger(logger_id);
            const q = new URLSearchParams({
                id_logger: logger.deviceIdentifier,
                ver: info.ver,
                file: info.file,
            });
            return stream(`/api/mqtt/ota/stream?${q}`, {
                done: true,
                failed: false,
            });
        },
    },
    {
        name: 'install_firmware',
        description:
            'Install the downloaded firmware (check_firmware state "install"). The logger flashes and reboots; waits up to 4 minutes for it to come back online.',
        risk: 'destructive',
        input_schema: forLogger(),
        run: async ({ logger_id }) => {
            const info = await firmwareCheck(logger_id);
            if (info.state !== 'install')
                return {
                    ok: false,
                    message: `Belum ada firmware siap install (state: ${info.state}).`,
                    data: info,
                };
            const logger = await deviceLogger(logger_id);
            const q = new URLSearchParams({
                id_logger: logger.deviceIdentifier,
            });
            if (info.stagedVersion) q.set('ver', info.stagedVersion);
            return stream(`/api/mqtt/ota/install-stream?${q}`, {
                online: true,
                rebooting: true,
                failed: false,
            });
        },
    },

    // ---------------------------------------------------------- FTP & SD card
    {
        name: 'set_ftp_config',
        description:
            'Set the FTP server the logger uploads its data to. Run test_ftp afterwards.',
        risk: 'config',
        input_schema: forLogger(
            {
                host: str(),
                port: int(1, 65535),
                username: str(),
                password: str(),
            },
            ['port'],
        ),
        run: ({ logger_id, port, ...rest }) =>
            deviceApi(logger_id, '/api/mqtt/ftp/set', {
                port: port ?? 21,
                ...rest,
            }),
    },
    {
        name: 'test_ftp',
        description:
            'Ask the logger to test-upload to its configured FTP server (can take a few minutes).',
        risk: 'device',
        input_schema: forLogger(),
        run: ({ logger_id }) => deviceApi(logger_id, '/api/mqtt/ftp/test'),
    },
    {
        name: 'copy_sd_to_usb',
        description:
            'Copy data from the logger SD card to a USB flash drive plugged into the logger: one file (name from list_sd_card_files) or everything when file is omitted. Up to 10 minutes.',
        risk: 'device',
        input_schema: forLogger({ file: str() }, ['file']),
        run: async ({ logger_id, file }) => {
            const logger = await deviceLogger(logger_id);
            const q = new URLSearchParams({
                id_logger: logger.deviceIdentifier,
            });
            if (file) q.set('src', file);
            return stream(`/api/mqtt/usb/stream?${q}`, {
                done: true,
                failed: false,
            });
        },
    },

    // ---------------------------------------------------------- platform forwarding
    {
        name: 'set_ministesy',
        description:
            'Configure forwarding to the Mini STESY platform. Omitted fields keep their value. raw_forward true sends every reading and ignores interval_minutes (1-1440).',
        risk: 'config',
        input_schema: forLogger(
            {
                enabled: bool(),
                key: str('Encryption key.'),
                interval_minutes: int(1, 1440),
                raw_forward: bool(),
            },
            ['key', 'interval_minutes', 'raw_forward'],
        ),
        run: async ({
            logger_id,
            enabled,
            key,
            interval_minutes,
            raw_forward,
        }) => {
            const logger = await getLogger(logger_id);
            return visit('put', loggerUrl(logger_id, '/platform'), {
                ministesy_enabled: enabled,
                ministesy_key: key ?? logger.ministesyKey ?? '',
                ministesy_interval:
                    interval_minutes ?? logger.ministesyInterval ?? 10,
                ministesy_raw_forward:
                    raw_forward ?? logger.ministesyRawForward ?? false,
            });
        },
    },
    {
        name: 'add_integration',
        description:
            "Forward this logger's data to another HTTP endpoint. auth_config by auth_type: api_key {header?, value}, bearer {value}, basic {username, password}, custom_header {header, value}.",
        risk: 'config',
        input_schema: forLogger(
            {
                name: str('Max 255.'),
                endpoint_url: str('URL, max 500.'),
                auth_type: oneOf([
                    'none',
                    'api_key',
                    'bearer',
                    'basic',
                    'custom_header',
                ]),
                auth_config: { type: 'object' },
                interval_minutes: int(1, 1440),
                raw_forward: bool(),
            },
            ['auth_type', 'auth_config', 'interval_minutes', 'raw_forward'],
        ),
        run: ({ logger_id, ...form }) =>
            visit('post', loggerUrl(logger_id, '/integrations'), {
                auth_type: 'none',
                auth_config: {},
                interval_minutes: 10,
                raw_forward: false,
                is_enabled: true,
                ...form,
            }),
    },
    {
        name: 'update_integration',
        description:
            'Change a forwarding integration (integration_id from get_logger). Omitted fields keep their value.',
        risk: 'config',
        input_schema: forLogger(
            {
                integration_id: int(1),
                name: str(),
                endpoint_url: str(),
                auth_type: oneOf([
                    'none',
                    'api_key',
                    'bearer',
                    'basic',
                    'custom_header',
                ]),
                auth_config: { type: 'object' },
                interval_minutes: int(1, 1440),
                raw_forward: bool(),
            },
            [
                'name',
                'endpoint_url',
                'auth_type',
                'auth_config',
                'interval_minutes',
                'raw_forward',
            ],
        ),
        run: async ({ logger_id, integration_id, ...changes }) => {
            const logger = await getLogger(logger_id);
            const i = logger.integrations.find(
                (x: Json) => x.id === integration_id,
            );
            if (!i)
                return {
                    ok: false,
                    message: `Integrasi ${integration_id} tidak ada.`,
                };
            return visit(
                'put',
                loggerUrl(logger_id, `/integrations/${integration_id}`),
                {
                    name: i.name,
                    endpoint_url: i.endpointUrl,
                    auth_type: i.authType,
                    auth_config: i.authConfig ?? {},
                    interval_minutes: i.intervalMinutes,
                    raw_forward: i.rawForward,
                    is_enabled: i.isEnabled,
                    ...changes,
                },
            );
        },
    },
    {
        name: 'set_integration_enabled',
        description: 'Pause or resume a forwarding integration.',
        risk: 'config',
        input_schema: forLogger({ integration_id: int(1), enabled: bool() }),
        run: async ({ logger_id, integration_id, enabled }) => {
            const logger = await getLogger(logger_id);
            const i = logger.integrations.find(
                (x: Json) => x.id === integration_id,
            );
            if (!i)
                return {
                    ok: false,
                    message: `Integrasi ${integration_id} tidak ada.`,
                };
            if (i.isEnabled === enabled)
                return { ok: true, message: 'Sudah dalam status itu.' };
            const res = await api(
                'PATCH',
                loggerUrl(logger_id, `/integrations/${integration_id}/toggle`),
            );
            if (res.ok) router.reload({ only: ['logger'] });
            return res;
        },
    },
    {
        name: 'delete_integration',
        description:
            'Delete a forwarding integration; the platform stops receiving data.',
        risk: 'destructive',
        input_schema: forLogger({ integration_id: int(1) }),
        run: ({ logger_id, integration_id }) =>
            visit(
                'delete',
                loggerUrl(logger_id, `/integrations/${integration_id}`),
            ),
    },
];

const byName = new Map(commands.map((c) => [c.name, c]));

/** Tool definitions for the LLM (OpenAI function format, as 9router expects). */
export const assistantTools = commands.map(
    ({ name, description, input_schema }) => ({
        type: 'function' as const,
        function: { name, description, parameters: input_schema },
    }),
);

export const commandRisk = (name: string): Risk | undefined =>
    byName.get(name)?.risk;

/**
 * Top-level check of LLM arguments against the command schema (required keys,
 * no unknown keys), so a mixed-up call is bounced back to the model before the
 * user is asked to approve it. Returns the problem, or null when fine.
 */
export function inputProblem(name: string, input: Input): string | null {
    const command = byName.get(name);
    if (!command) return `Command ${name} tidak dikenal.`;
    const schema = command.input_schema as {
        properties: Record<string, unknown>;
        required: string[];
    };
    const unknown = Object.keys(input).filter(
        (key) => !(key in schema.properties),
    );
    const missing = schema.required.filter((key) => input[key] === undefined);
    const problems = [
        missing.length && `wajib diisi: ${missing.join(', ')}`,
        unknown.length && `tidak dikenal: ${unknown.join(', ')}`,
    ].filter(Boolean);
    return problems.length
        ? `Argumen ${name} tidak sesuai schema (${problems.join('; ')}). Perbaiki lalu panggil lagi.`
        : null;
}

/** Execute one tool call. Never throws: failures come back as { ok: false }. */
export async function runAssistantCommand(
    name: string,
    input: Input = {},
): Promise<CommandResult> {
    const command = byName.get(name);
    const problem = inputProblem(name, input ?? {});
    if (!command || problem)
        return { ok: false, message: problem ?? undefined };
    try {
        return await command.run(input ?? {});
    } catch (error) {
        return {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
        };
    }
}
