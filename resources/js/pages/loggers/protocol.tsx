import { Head, Link } from '@inertiajs/react';
import {
    AlertTriangle,
    ArrowLeft,
    Bell,
    Clock,
    Cpu,
    DoorOpen,
    Gauge,
    Loader2,
    Network,
    PlugZap,
    Power,
    RefreshCw,
    Send,
    Server,
    ShieldAlert,
    Terminal,
    UploadCloud,
    Wifi,
    Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type Payload = Record<string, JsonValue>;

interface ProtocolLogger {
    id: string;
    name: string;
    serialNumber: string | null;
    status: 'online' | 'offline' | 'warning';
    deviceIdentifier: string | null;
    model: string | null;
    connectionType: string | null;
    loggerMode: string | null;
    channelCount: number | null;
    firmwareVersion: string | null;
    sensors: ProtocolSensor[];
}

interface ProtocolPageProps {
    logger: ProtocolLogger;
}

interface ProtocolSensor {
    id: number;
    name: string;
    connectionType: string | null;
    modbusSlaveId: number | null;
    port: number | null;
    channel: number | null;
}

interface CommandResult {
    success: boolean;
    message?: string;
    data?: JsonValue;
    raw?: string;
}

const inputClass = 'h-8';
const selectClass = 'h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

function inferBoardVariant(logger: ProtocolLogger): 'BL11' | 'BL110' | 'BL1100' | null {
    const normalized = (logger.model || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normalized.includes('BL1100') || (logger.channelCount ?? 0) >= 8) return 'BL1100';
    if (normalized.includes('BL110')) return 'BL110';
    if (normalized.includes('BL11') || logger.connectionType === 'cellular') return 'BL11';
    return null;
}

function targetKey(sensor: ProtocolSensor): string {
    return `${sensor.connectionType}:${sensor.id}`;
}

function csrfToken(): string {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';
}

async function postJson(url: string, body: unknown): Promise<Response> {
    return fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-TOKEN': csrfToken(),
        },
        body: JSON.stringify(body),
    });
}

function numberValue(value: string, fallback = 0): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function resultText(result: CommandResult): string {
    const value = result.data !== undefined ? result.data : result.raw ?? result;
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function CommandCard({
    title,
    description,
    icon: Icon,
    children,
    result,
}: {
    title: string;
    description: string;
    icon: ComponentType<{ className?: string }>;
    children: ReactNode;
    result?: CommandResult | null;
}) {
    return (
        <Card>
            <CardHeader className="space-y-1">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Icon className="size-4" />
                            {title}
                        </CardTitle>
                        <CardDescription>{description}</CardDescription>
                    </div>
                    {result && (
                        <Badge variant="outline" className={result.success ? 'text-emerald-600' : 'text-red-600'}>
                            {result.success ? 'OK' : 'ERR'}
                        </Badge>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {children}
                {result && (
                    <Textarea className="min-h-28 font-mono text-xs" value={resultText(result)} readOnly />
                )}
            </CardContent>
        </Card>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs">{label}</Label>
            {children}
        </div>
    );
}

function ButtonRow({ children }: { children: ReactNode }) {
    return <div className="flex flex-wrap gap-2">{children}</div>;
}

export default function ProtocolPage({ logger }: ProtocolPageProps) {
    const now = useMemo(() => new Date(), []);
    const [loading, setLoading] = useState<string | null>(null);
    const [responses, setResponses] = useState<Record<string, CommandResult | null>>({});

    const [rtc, setRtc] = useState({
        date: now.toISOString().slice(0, 10),
        time: now.toTimeString().slice(0, 8),
        timezone: '+7',
    });
    const [net, setNet] = useState({
        dhcp: '1',
        ip: '192.168.1.100',
        subnet: '255.255.255.0',
        gateway: '192.168.1.1',
        dns: '8.8.8.8',
    });
    const [wdtTime, setWdtTime] = useState('30');
    const [simApn, setSimApn] = useState('internet');
    const [cal, setCal] = useState({
        actual: '20',
        analogTarget: '',
        offsetTarget: '',
    });
    const [pumpState, setPumpState] = useState('1');
    const [out24State, setOut24State] = useState('1');
    const [out12State, setOut12State] = useState('1');
    const [doorCloseState, setDoorCloseState] = useState('1');
    const [alertState, setAlertState] = useState('1');
    const [modbusTcp, setModbusTcp] = useState({ enable: '1', port: '502' });
    const [powerCal, setPowerCal] = useState({
        sensor: 'bat',
        vRef: '',
        iRef: '',
    });
    const [ftpLogFile, setFtpLogFile] = useState('20260502.txt');

    const canSend = Boolean(logger.deviceIdentifier);
    const variant = inferBoardVariant(logger);
    const isCellularBoard = variant === 'BL11';
    const isEthernetBoard = variant === 'BL110' || variant === 'BL1100';
    const isAwlrMode = logger.loggerMode === 'AWLR_TD' || logger.loggerMode === 'AWLR_US';
    const calibrationTargets = logger.sensors.filter((sensor) =>
        sensor.connectionType === 'rs485' || sensor.connectionType === 'rs232' || sensor.connectionType === 'analog',
    );
    const analogTargets = calibrationTargets.filter((sensor) => sensor.connectionType === 'analog');
    const selectedAnalogTarget = analogTargets.find((sensor) => targetKey(sensor) === cal.analogTarget) ?? analogTargets[0] ?? null;
    const selectedOffsetTarget = calibrationTargets.find((sensor) => targetKey(sensor) === cal.offsetTarget) ?? calibrationTargets[0] ?? null;
    const powerCalSensors = isEthernetBoard ? ['bat', 'out5', 'out12', 'out24'] : ['bat'];

    const breadcrumbs: BreadcrumbItem[] = [
        { title: 'Loggers', href: '/loggers' },
        { title: logger.name, href: `/loggers/${logger.id}` },
        { title: 'Protocol', href: `/loggers/${logger.id}/protocol` },
    ];

    async function send(module: string, payload: Payload, key = module) {
        if (!logger.deviceIdentifier) {
            setResponses((current) => ({
                ...current,
                [key]: { success: false, message: 'Logger belum punya device identifier.' },
            }));
            return;
        }

        setLoading(key);
        try {
            const response = await postJson('/api/mqtt/protocol/command', {
                id_logger: logger.deviceIdentifier,
                module,
                payload,
            });
            const data = (await response.json()) as CommandResult;
            setResponses((current) => ({ ...current, [key]: data }));
        } catch (error) {
            setResponses((current) => ({
                ...current,
                [key]: { success: false, message: error instanceof Error ? error.message : 'Request gagal.' },
            }));
        } finally {
            setLoading(null);
        }
    }

    function localError(key: string, message: string) {
        setResponses((current) => ({ ...current, [key]: { success: false, message } }));
    }

    function actionButton(
        label: string,
        key: string,
        onClick: () => void,
        variant: 'default' | 'outline' | 'destructive' = 'outline',
        confirmMessage?: string,
    ) {
        const busy = loading === key;
        return (
            <Button
                type="button"
                size="sm"
                variant={variant}
                disabled={!canSend || busy}
                onClick={() => {
                    if (confirmMessage && !window.confirm(confirmMessage)) return;
                    onClick();
                }}
            >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                {label}
            </Button>
        );
    }

    function targetPayload(sensor: ProtocolSensor | null): Record<string, JsonValue> | null {
        if (!sensor?.connectionType) {
            return null;
        }

        if (sensor.connectionType === 'rs485') {
            return { Sens: 'RS485', slave: sensor.modbusSlaveId ?? 1, item: 0 };
        }
        if (sensor.connectionType === 'rs232') {
            return { Sens: 'RS232', p: sensor.port ?? 1 };
        }
        if (sensor.connectionType === 'analog') {
            return { Sens: 'Analog', ch: sensor.channel ?? 1 };
        }

        return null;
    }

    function sendPowerCalSet() {
        const body: Record<string, JsonValue> = {
            cmd: 'SET',
            sensor: powerCal.sensor,
        };

        if (powerCal.vRef.trim() !== '') body.v_ref = numberValue(powerCal.vRef);
        if (powerCal.iRef.trim() !== '') body.i_ref = numberValue(powerCal.iRef);

        if (body.v_ref === undefined && body.i_ref === undefined) {
            localError('POWER_CAL', 'Isi minimal v_ref atau i_ref.');
            return;
        }

        if (body.v_ref !== undefined && (Number(body.v_ref) < 0.01 || Number(body.v_ref) > 60)) {
            localError('POWER_CAL', 'v_ref harus 0.01 sampai 60.0 Volt.');
            return;
        }

        if (body.i_ref !== undefined && (Number(body.i_ref) < 0 || Number(body.i_ref) > 50)) {
            localError('POWER_CAL', 'i_ref harus 0 sampai 50.0 Ampere.');
            return;
        }

        send('POWER_CAL', { POWER_CAL: body }, 'POWER_CAL');
    }

    function actualValue(): number | null {
        const value = numberValue(cal.actual, Number.NaN);
        return Number.isFinite(value) && value > 0 ? value : null;
    }

    function sendCalSet() {
        const actual = actualValue();
        if (!selectedAnalogTarget || actual === null) {
            localError('CAL', 'Pilih sensor analog dan isi actual_val lebih besar dari 0.');
            return;
        }

        send('CAL', { CAL: { cmd: 'SET', ch: selectedAnalogTarget.channel ?? 1, actual_val: actual } }, 'CAL');
    }

    function sendCalReset() {
        if (!selectedAnalogTarget) {
            localError('CAL', 'Pilih sensor analog yang sudah terdaftar.');
            return;
        }

        send('CAL', { CAL: { cmd: 'RST', ch: selectedAnalogTarget.channel ?? 1 } }, 'CAL');
    }

    function sendCalOffset() {
        const target = targetPayload(selectedOffsetTarget);
        const actual = actualValue();
        if (!target || actual === null) {
            localError('CAL', 'Pilih target sensor dan isi actual_val lebih besar dari 0.');
            return;
        }

        send('CAL', { CAL: { cmd: 'OFFSET', ...target, actual_val: actual } }, 'CAL');
    }

    function sendCalResetOffset() {
        const target = targetPayload(selectedOffsetTarget);
        if (!target) {
            localError('CAL', 'Pilih target sensor yang sudah terdaftar.');
            return;
        }

        send('CAL', { CAL: { cmd: 'RSTSET', ...target } }, 'CAL');
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={`${logger.name} Protocol`} />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                <Link href={`/loggers/${logger.id}`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="size-4" />
                    Back to logger
                </Link>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-xl font-bold">Protocol Command</h1>
                            <Badge variant="outline" className="capitalize">{logger.status}</Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1"><Terminal className="size-3.5" />{logger.name}</span>
                            {logger.serialNumber && <span>{logger.serialNumber}</span>}
                            {logger.deviceIdentifier && <span className="font-mono text-xs">ID {logger.deviceIdentifier}</span>}
                            {logger.model && <span>{logger.model}</span>}
                            {logger.firmwareVersion && <span className="font-mono text-xs">{logger.firmwareVersion}</span>}
                        </div>
                    </div>
                    {!canSend && (
                        <Badge variant="outline" className="w-fit text-red-600">
                            Device identifier kosong
                        </Badge>
                    )}
                </div>

                <Card>
                    <CardContent className="flex items-start gap-3 p-4 text-sm">
                        <AlertTriangle className="mt-0.5 size-4 text-amber-500" />
                        <div>
                            <p className="font-medium">Status implementasi</p>
                            <p className="text-muted-foreground">
                                Halaman ini hanya menampilkan command MQTT configurator yang aman untuk model dan mode logger aktif. Modul yang tidak
                                tersedia melalui MQTT umum tidak dirender sebagai menu atau tombol.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                <Tabs defaultValue="system">
                    <TabsList className="flex h-auto flex-wrap justify-start">
                        <TabsTrigger value="system">System</TabsTrigger>
                        <TabsTrigger value="network">Network</TabsTrigger>
                        <TabsTrigger value="io">I/O</TabsTrigger>
                        <TabsTrigger value="power">Power</TabsTrigger>
                        <TabsTrigger value="logs">Logs</TabsTrigger>
                    </TabsList>

                    <TabsContent value="system" className="mt-4 grid gap-4 lg:grid-cols-2">
                        <CommandCard title="RTC" description="SET/GET real-time clock." icon={Clock} result={responses.RTC}>
                            <div className="grid gap-3 sm:grid-cols-3">
                                <Field label="Date">
                                    <Input className={inputClass} type="date" value={rtc.date} onChange={(event) => setRtc({ ...rtc, date: event.target.value })} />
                                </Field>
                                <Field label="Time">
                                    <Input className={inputClass} type="time" step="1" value={rtc.time} onChange={(event) => setRtc({ ...rtc, time: event.target.value })} />
                                </Field>
                                <Field label="Timezone">
                                    <Input className={inputClass} value={rtc.timezone} onChange={(event) => setRtc({ ...rtc, timezone: event.target.value })} />
                                </Field>
                            </div>
                            <ButtonRow>
                                {actionButton('SET', 'RTC', () => send('RTC', { RTC: { command: 'SET', ...rtc } }, 'RTC'))}
                                {actionButton('GET', 'RTC', () => send('RTC', { RTC: { command: 'GET' } }, 'RTC'))}
                            </ButtonRow>
                        </CommandCard>

                        <CommandCard title="WDT" description="SET/GET external watchdog dan hard reboot via WDT." icon={RefreshCw} result={responses.WDT}>
                            <Field label="Timeout">
                                <select className={selectClass} value={wdtTime} onChange={(event) => setWdtTime(event.target.value)}>
                                    {['5', '10', '15', '30', '60'].map((value) => <option key={value} value={value}>{value} menit</option>)}
                                </select>
                            </Field>
                            <ButtonRow>
                                {actionButton('SET', 'WDT', () => send('WDT', { WDT: { command: 'SET', time: wdtTime } }, 'WDT'))}
                                {actionButton('GET', 'WDT', () => send('WDT', { WDT: { command: 'GET' } }, 'WDT'))}
                                {actionButton(
                                    'SET_REBOOT',
                                    'WDT',
                                    () => send('WDT', { WDT: { command: 'SET_REBOOT', value: 1 } }, 'WDT'),
                                    'destructive',
                                    'Kirim WDT SET_REBOOT? Logger akan restart.',
                                )}
                            </ButtonRow>
                        </CommandCard>

                        <CommandCard title="STATUS" description="Heartbeat/cek koneksi logger." icon={ShieldAlert} result={responses.STATUS}>
                            <ButtonRow>
                                {actionButton('GET', 'STATUS', () => send('STATUS', { STATUS: { cmd: 'GET' } }, 'STATUS'))}
                            </ButtonRow>
                        </CommandCard>

                        {calibrationTargets.length > 0 && (
                            <CommandCard title="CAL" description="Kalibrasi analog gain dan offset sensor terdaftar." icon={Gauge} result={responses.CAL}>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {analogTargets.length > 0 && (
                                        <Field label="Analog target">
                                            <select className={selectClass} value={cal.analogTarget || (selectedAnalogTarget ? targetKey(selectedAnalogTarget) : '')} onChange={(event) => setCal({ ...cal, analogTarget: event.target.value })}>
                                                {analogTargets.map((sensor) => (
                                                    <option key={targetKey(sensor)} value={targetKey(sensor)}>
                                                        {sensor.name} · ch {sensor.channel ?? 1}
                                                    </option>
                                                ))}
                                            </select>
                                        </Field>
                                    )}
                                    <Field label="Offset target">
                                        <select className={selectClass} value={cal.offsetTarget || (selectedOffsetTarget ? targetKey(selectedOffsetTarget) : '')} onChange={(event) => setCal({ ...cal, offsetTarget: event.target.value })}>
                                            {calibrationTargets.map((sensor) => (
                                                <option key={targetKey(sensor)} value={targetKey(sensor)}>
                                                    {sensor.name} · {sensor.connectionType?.toUpperCase()}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                    <Field label="actual_val">
                                        <Input className={inputClass} type="number" min="0.001" step="0.001" value={cal.actual} onChange={(event) => setCal({ ...cal, actual: event.target.value })} />
                                    </Field>
                                </div>
                                <ButtonRow>
                                    {analogTargets.length > 0 && actionButton('SET', 'CAL', sendCalSet)}
                                    {actionButton('GET', 'CAL', () => send('CAL', { CAL: { cmd: 'GET' } }, 'CAL'))}
                                    {analogTargets.length > 0 && actionButton('RST', 'CAL', sendCalReset, 'destructive', 'Reset kalibrasi analog channel ini?')}
                                    {actionButton('OFFSET', 'CAL', sendCalOffset)}
                                    {actionButton('RSTSET', 'CAL', sendCalResetOffset, 'destructive', 'Reset offset sensor target ini?')}
                                </ButtonRow>
                            </CommandCard>
                        )}
                    </TabsContent>

                    <TabsContent value="network" className="mt-4 grid gap-4 lg:grid-cols-2">
                        {isEthernetBoard && (
                            <CommandCard title="NET" description="Ethernet GET/SET untuk BL110 dan BL1100." icon={Network} result={responses.NET}>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="DHCP">
                                    <select className={selectClass} value={net.dhcp} onChange={(event) => setNet({ ...net, dhcp: event.target.value })}>
                                        <option value="1">DHCP</option>
                                        <option value="0">Static</option>
                                    </select>
                                </Field>
                                <Field label="IP">
                                    <Input className={inputClass} value={net.ip} onChange={(event) => setNet({ ...net, ip: event.target.value })} />
                                </Field>
                                <Field label="Subnet">
                                    <Input className={inputClass} value={net.subnet} onChange={(event) => setNet({ ...net, subnet: event.target.value })} />
                                </Field>
                                <Field label="Gateway">
                                    <Input className={inputClass} value={net.gateway} onChange={(event) => setNet({ ...net, gateway: event.target.value })} />
                                </Field>
                                <Field label="DNS">
                                    <Input className={inputClass} value={net.dns} onChange={(event) => setNet({ ...net, dns: event.target.value })} />
                                </Field>
                            </div>
                            <ButtonRow>
                                {actionButton('GET', 'NET', () => send('NET', { NET: { cmd: 'GET' } }, 'NET'))}
                                {actionButton('SET', 'NET', () => send('NET', { NET: { cmd: 'SET', d: [numberValue(net.dhcp), net.ip, net.subnet, net.gateway, net.dns] } }, 'NET'))}
                            </ButtonRow>
                            </CommandCard>
                        )}

                        {isCellularBoard && (
                            <CommandCard title="SIM" description="SIM7600 status dan APN untuk BL11." icon={Wifi} result={responses.SIM}>
                            <Field label="APN">
                                <Input className={inputClass} value={simApn} onChange={(event) => setSimApn(event.target.value)} />
                            </Field>
                            <ButtonRow>
                                {actionButton('GET', 'SIM', () => send('SIM', { SIM: 'GET' }, 'SIM'))}
                                {actionButton('SET', 'SIM', () => send('SIM', { SIM: { cmd: 'SET', apn: simApn } }, 'SIM'))}
                            </ButtonRow>
                            </CommandCard>
                        )}

                        {isEthernetBoard && (
                            <CommandCard title="MODBUSTCP" description="Modbus TCP server untuk SCADA/HMI." icon={Server} result={responses.MODBUSTCP}>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="Enable">
                                    <select className={selectClass} value={modbusTcp.enable} onChange={(event) => setModbusTcp({ ...modbusTcp, enable: event.target.value })}>
                                        <option value="1">Enable</option>
                                        <option value="0">Disable</option>
                                    </select>
                                </Field>
                                <Field label="Port">
                                    <Input className={inputClass} type="number" min="1" max="65535" value={modbusTcp.port} onChange={(event) => setModbusTcp({ ...modbusTcp, port: event.target.value })} />
                                </Field>
                            </div>
                            <ButtonRow>
                                {actionButton('GET', 'MODBUSTCP', () => send('MODBUSTCP', { MODBUSTCP: { cmd: 'GET' } }, 'MODBUSTCP'))}
                                {actionButton('SET', 'MODBUSTCP', () => send('MODBUSTCP', { MODBUSTCP: { cmd: 'SET', enable: numberValue(modbusTcp.enable), port: numberValue(modbusTcp.port, 502) } }, 'MODBUSTCP'))}
                            </ButtonRow>
                            </CommandCard>
                        )}
                    </TabsContent>

                    <TabsContent value="io" className="mt-4 grid gap-4 lg:grid-cols-2">
                        {isAwlrMode && (
                            <CommandCard title="AWLR_PUMP" description="Kontrol relay pompa via Modbus RTU." icon={PlugZap} result={responses.AWLR_PUMP}>
                            <Field label="State">
                                <select className={selectClass} value={pumpState} onChange={(event) => setPumpState(event.target.value)}>
                                    <option value="1">ON</option>
                                    <option value="0">OFF</option>
                                </select>
                            </Field>
                            <ButtonRow>
                                {actionButton('GET', 'AWLR_PUMP', () => send('AWLR_PUMP', { AWLR_PUMP: { cmd: 'GET' } }, 'AWLR_PUMP'))}
                                {actionButton('SET', 'AWLR_PUMP', () => send('AWLR_PUMP', { AWLR_PUMP: { cmd: 'SET', state: numberValue(pumpState) } }, 'AWLR_PUMP'), 'destructive', 'Ubah status pompa AWLR?')}
                            </ButtonRow>
                            </CommandCard>
                        )}

                        <CommandCard title="Power Output" description="Kontrol output 24V dan 12V active-low." icon={Zap} result={responses.P_OUT}>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="P_OUT24">
                                    <select className={selectClass} value={out24State} onChange={(event) => setOut24State(event.target.value)}>
                                        <option value="1">ON</option>
                                        <option value="0">OFF</option>
                                    </select>
                                </Field>
                                <Field label="P_OUT12">
                                    <select className={selectClass} value={out12State} onChange={(event) => setOut12State(event.target.value)}>
                                        <option value="1">ON</option>
                                        <option value="0">OFF</option>
                                    </select>
                                </Field>
                            </div>
                            <ButtonRow>
                                {actionButton('P_OUT24 SET', 'P_OUT', () => send('P_OUT24', { P_OUT24: { cmd: 'SET', state: numberValue(out24State) } }, 'P_OUT'), 'destructive', 'Ubah output power 24V?')}
                                {actionButton('P_OUT12 SET', 'P_OUT', () => send('P_OUT12', { P_OUT12: { cmd: 'SET', state: numberValue(out12State) } }, 'P_OUT'), 'destructive', 'Ubah output power 12V?')}
                            </ButtonRow>
                        </CommandCard>

                        <CommandCard title="SENS_DOOR" description="Polaritas sensor pintu panel." icon={DoorOpen} result={responses.SENS_DOOR}>
                            <Field label="close_st">
                                <select className={selectClass} value={doorCloseState} onChange={(event) => setDoorCloseState(event.target.value)}>
                                    <option value="1">LOW = closed</option>
                                    <option value="0">LOW = open</option>
                                </select>
                            </Field>
                            <ButtonRow>
                                {actionButton('GET', 'SENS_DOOR', () => send('SENS_DOOR', { SENS_DOOR: { cmd: 'GET' } }, 'SENS_DOOR'))}
                                {actionButton('SET', 'SENS_DOOR', () => send('SENS_DOOR', { SENS_DOOR: { cmd: 'SET', close_st: numberValue(doorCloseState) } }, 'SENS_DOOR'))}
                            </ButtonRow>
                        </CommandCard>

                        <CommandCard title="ALERT" description="Aktif/nonaktif buzzer global." icon={Bell} result={responses.ALERT}>
                            <Field label="State">
                                <select className={selectClass} value={alertState} onChange={(event) => setAlertState(event.target.value)}>
                                    <option value="1">ON</option>
                                    <option value="0">OFF</option>
                                </select>
                            </Field>
                            <ButtonRow>
                                {actionButton('GET', 'ALERT', () => send('ALERT', { ALERT: { cmd: 'GET' } }, 'ALERT'))}
                                {actionButton('SET', 'ALERT', () => send('ALERT', { ALERT: { cmd: 'SET', state: numberValue(alertState) } }, 'ALERT'))}
                            </ButtonRow>
                        </CommandCard>
                    </TabsContent>

                    <TabsContent value="power" className="mt-4 grid gap-4 lg:grid-cols-2">
                        <CommandCard title="POWER" description="Baca INA219 live: battery, 5V, 12V, 24V." icon={Power} result={responses.POWER}>
                            <ButtonRow>
                                {actionButton('READ', 'POWER', () => send('POWER', { POWER: { cmd: 'READ' } }, 'POWER'))}
                            </ButtonRow>
                        </CommandCard>

                        <CommandCard title="POWER_CAL" description="Kalibrasi INA219 per rail." icon={Cpu} result={responses.POWER_CAL}>
                            <div className="grid gap-3 sm:grid-cols-3">
                                <Field label="Sensor">
                                    <select className={selectClass} value={powerCal.sensor} onChange={(event) => setPowerCal({ ...powerCal, sensor: event.target.value })}>
                                        {powerCalSensors.map((sensor) => (
                                            <option key={sensor} value={sensor}>{sensor}</option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="v_ref">
                                    <Input className={inputClass} type="number" step="0.001" value={powerCal.vRef} onChange={(event) => setPowerCal({ ...powerCal, vRef: event.target.value })} />
                                </Field>
                                <Field label="i_ref">
                                    <Input className={inputClass} type="number" step="0.001" value={powerCal.iRef} onChange={(event) => setPowerCal({ ...powerCal, iRef: event.target.value })} />
                                </Field>
                            </div>
                            <ButtonRow>
                                {actionButton('SET', 'POWER_CAL', sendPowerCalSet)}
                                {actionButton('GET', 'POWER_CAL', () => send('POWER_CAL', { POWER_CAL: { cmd: 'GET' } }, 'POWER_CAL'))}
                                {actionButton('RST', 'POWER_CAL', () => send('POWER_CAL', { POWER_CAL: { cmd: 'RST' } }, 'POWER_CAL'), 'destructive', 'Reset semua kalibrasi INA219 ke default?')}
                            </ButtonRow>
                        </CommandCard>
                    </TabsContent>

                    <TabsContent value="logs" className="mt-4 grid gap-4 lg:grid-cols-2">
                        <CommandCard title="FTP System Logs" description="READLOGS dan GETLOG untuk black-box recorder." icon={UploadCloud} result={responses.FTP_LOGS}>
                            <Field label="Log file">
                                <Input className={inputClass} value={ftpLogFile} onChange={(event) => setFtpLogFile(event.target.value)} />
                            </Field>
                            <ButtonRow>
                                {actionButton('READLOGS', 'FTP_LOGS', () => send('FTP', { FTP: { cmd: 'READLOGS' } }, 'FTP_LOGS'))}
                                {actionButton('GETLOG', 'FTP_LOGS', () => send('FTP', { FTP: { cmd: 'GETLOG', f: ftpLogFile } }, 'FTP_LOGS'))}
                            </ButtonRow>
                        </CommandCard>
                    </TabsContent>
                </Tabs>

                <Separator />
                <p className="text-xs text-muted-foreground">
                    Endpoint ini mengirim payload sesuai root module yang dipilih dan mencatat hasil ke Activity Log sebagai protocol_command.
                </p>
            </div>
        </AppLayout>
    );
}
