import { Head, Link } from '@inertiajs/react';
import {
    AlertTriangle,
    ArrowLeft,
    Bell,
    Clock,
    Cpu,
    DoorOpen,
    Gauge,
    HardDrive,
    KeyRound,
    Loader2,
    Network,
    PlugZap,
    Power,
    RefreshCw,
    RotateCcw,
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
    firmwareVersion: string | null;
}

interface ProtocolPageProps {
    logger: ProtocolLogger;
}

interface CommandResult {
    success: boolean;
    message?: string;
    data?: JsonValue;
    raw?: string;
}

const inputClass = 'h-8';
const selectClass = 'h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
    const [authPin, setAuthPin] = useState('superadmin');
    const [wdtTime, setWdtTime] = useState('30');
    const [simApn, setSimApn] = useState('internet');
    const [cal, setCal] = useState({
        ch: '1',
        actual: '20',
        sens: 'RS485',
        slave: '1',
        item: '0',
        port: '1',
    });
    const [facConfirm, setFacConfirm] = useState(false);
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

    function actionButton(label: string, key: string, onClick: () => void, variant: 'default' | 'outline' | 'destructive' = 'outline') {
        const busy = loading === key;
        return (
            <Button type="button" size="sm" variant={variant} disabled={!canSend || busy} onClick={onClick}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                {label}
            </Button>
        );
    }

    function calTarget(): Record<string, JsonValue> {
        if (cal.sens === 'RS485') {
            return { Sens: 'RS485', slave: numberValue(cal.slave, 1), item: numberValue(cal.item, 0) };
        }
        if (cal.sens === 'RS232') {
            return { Sens: 'RS232', p: numberValue(cal.port, 1) };
        }
        return { Sens: 'Analog', ch: numberValue(cal.ch, 1) };
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

        send('POWER_CAL', { POWER_CAL: body }, 'POWER_CAL');
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
                                Modul berikut sekarang punya halaman dan endpoint MQTT generik: RTC, NET, AUTH, WDT, SIM, CAL, STATUS, FAC, AWLR_PUMP, P_OUT24,
                                P_OUT12, SENS_DOOR, ALERT, MODBUSTCP, POWER, POWER_CAL, dan FTP READLOGS/GETLOG. PRODUCTION SET dan SDCARD tetap ditandai
                                tidak dikirim via MQTT karena dokumen membatasi keduanya ke UART/Bluetooth.
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
                        <TabsTrigger value="blocked">Blocked</TabsTrigger>
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
                                {actionButton('SET_REBOOT', 'WDT', () => send('WDT', { WDT: { command: 'SET_REBOOT', value: 1 } }, 'WDT'), 'destructive')}
                            </ButtonRow>
                        </CommandCard>

                        <CommandCard title="AUTH" description="Unlock akses command kritis di firmware." icon={KeyRound} result={responses.AUTH}>
                            <Field label="PIN">
                                <Input className={inputClass} type="password" value={authPin} onChange={(event) => setAuthPin(event.target.value)} />
                            </Field>
                            <ButtonRow>
                                {actionButton('AUTH', 'AUTH', () => send('AUTH', { AUTH: { pin: authPin } }, 'AUTH'))}
                            </ButtonRow>
                        </CommandCard>

                        <CommandCard title="STATUS / FAC" description="Heartbeat dan factory reset." icon={ShieldAlert} result={responses.STATUS_FAC}>
                            <div className="flex items-center gap-2">
                                <input id="fac-confirm" type="checkbox" checked={facConfirm} onChange={(event) => setFacConfirm(event.target.checked)} />
                                <Label htmlFor="fac-confirm" className="text-xs">Saya paham FAC RST menghapus konfigurasi dan reboot perangkat.</Label>
                            </div>
                            <ButtonRow>
                                {actionButton('STATUS GET', 'STATUS_FAC', () => send('STATUS', { STATUS: { cmd: 'GET' } }, 'STATUS_FAC'))}
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    disabled={!canSend || !facConfirm || loading === 'STATUS_FAC'}
                                    onClick={() => send('FAC', { FAC: 'RST' }, 'STATUS_FAC')}
                                >
                                    {loading === 'STATUS_FAC' ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                                    FAC RST
                                </Button>
                            </ButtonRow>
                        </CommandCard>

                        <CommandCard title="CAL" description="Kalibrasi analog gain dan offset sensor." icon={Gauge} result={responses.CAL}>
                            <div className="grid gap-3 sm:grid-cols-3">
                                <Field label="Channel">
                                    <Input className={inputClass} type="number" min="1" value={cal.ch} onChange={(event) => setCal({ ...cal, ch: event.target.value })} />
                                </Field>
                                <Field label="Actual value">
                                    <Input className={inputClass} type="number" step="0.001" value={cal.actual} onChange={(event) => setCal({ ...cal, actual: event.target.value })} />
                                </Field>
                                <Field label="Sensor target">
                                    <select className={selectClass} value={cal.sens} onChange={(event) => setCal({ ...cal, sens: event.target.value })}>
                                        <option value="RS485">RS485</option>
                                        <option value="RS232">RS232</option>
                                        <option value="Analog">Analog</option>
                                    </select>
                                </Field>
                                <Field label="RS485 slave">
                                    <Input className={inputClass} type="number" min="1" max="5" value={cal.slave} onChange={(event) => setCal({ ...cal, slave: event.target.value })} />
                                </Field>
                                <Field label="RS485 item">
                                    <Input className={inputClass} type="number" min="0" value={cal.item} onChange={(event) => setCal({ ...cal, item: event.target.value })} />
                                </Field>
                                <Field label="RS232 port">
                                    <Input className={inputClass} type="number" min="1" max="2" value={cal.port} onChange={(event) => setCal({ ...cal, port: event.target.value })} />
                                </Field>
                            </div>
                            <ButtonRow>
                                {actionButton('SET', 'CAL', () => send('CAL', { CAL: { cmd: 'SET', ch: numberValue(cal.ch, 1), actual_val: numberValue(cal.actual) } }, 'CAL'))}
                                {actionButton('GET', 'CAL', () => send('CAL', { CAL: { cmd: 'GET' } }, 'CAL'))}
                                {actionButton('RST', 'CAL', () => send('CAL', { CAL: { cmd: 'RST', ch: numberValue(cal.ch, 1) } }, 'CAL'))}
                                {actionButton('OFFSET', 'CAL', () => send('CAL', { CAL: { cmd: 'OFFSET', ...calTarget(), actual_val: numberValue(cal.actual) } }, 'CAL'))}
                                {actionButton('RSTSET', 'CAL', () => send('CAL', { CAL: { cmd: 'RSTSET', ...calTarget() } }, 'CAL'))}
                            </ButtonRow>
                        </CommandCard>
                    </TabsContent>

                    <TabsContent value="network" className="mt-4 grid gap-4 lg:grid-cols-2">
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

                        <CommandCard title="SIM" description="SIM7600 status dan APN untuk BL11." icon={Wifi} result={responses.SIM}>
                            <Field label="APN">
                                <Input className={inputClass} value={simApn} onChange={(event) => setSimApn(event.target.value)} />
                            </Field>
                            <ButtonRow>
                                {actionButton('GET', 'SIM', () => send('SIM', { SIM: 'GET' }, 'SIM'))}
                                {actionButton('SET', 'SIM', () => send('SIM', { SIM: { cmd: 'SET', apn: simApn } }, 'SIM'))}
                            </ButtonRow>
                        </CommandCard>

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
                    </TabsContent>

                    <TabsContent value="io" className="mt-4 grid gap-4 lg:grid-cols-2">
                        <CommandCard title="AWLR_PUMP" description="Kontrol relay pompa via Modbus RTU." icon={PlugZap} result={responses.AWLR_PUMP}>
                            <Field label="State">
                                <select className={selectClass} value={pumpState} onChange={(event) => setPumpState(event.target.value)}>
                                    <option value="1">ON</option>
                                    <option value="0">OFF</option>
                                </select>
                            </Field>
                            <ButtonRow>
                                {actionButton('GET', 'AWLR_PUMP', () => send('AWLR_PUMP', { AWLR_PUMP: { cmd: 'GET' } }, 'AWLR_PUMP'))}
                                {actionButton('SET', 'AWLR_PUMP', () => send('AWLR_PUMP', { AWLR_PUMP: { cmd: 'SET', state: numberValue(pumpState) } }, 'AWLR_PUMP'))}
                            </ButtonRow>
                        </CommandCard>

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
                                {actionButton('P_OUT24 SET', 'P_OUT', () => send('P_OUT24', { P_OUT24: { cmd: 'SET', state: numberValue(out24State) } }, 'P_OUT'))}
                                {actionButton('P_OUT12 SET', 'P_OUT', () => send('P_OUT12', { P_OUT12: { cmd: 'SET', state: numberValue(out12State) } }, 'P_OUT'))}
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
                                        <option value="bat">bat</option>
                                        <option value="out5">out5</option>
                                        <option value="out12">out12</option>
                                        <option value="out24">out24</option>
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
                                {actionButton('RST', 'POWER_CAL', () => send('POWER_CAL', { POWER_CAL: { cmd: 'RST' } }, 'POWER_CAL'), 'destructive')}
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

                    <TabsContent value="blocked" className="mt-4 grid gap-4 lg:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="size-4" />PRODUCTION SET</CardTitle>
                                <CardDescription>Provisioning SN, device ID, dan broker MQTT.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3 text-sm text-muted-foreground">
                                <p>Dokumen menandai PRODUCTION sebagai UART/Bluetooth only dan MQTT ditolak untuk alasan keamanan.</p>
                                <Button size="sm" variant="outline" disabled>MQTT disabled</Button>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base"><HardDrive className="size-4" />SDCARD FIND/READ</CardTitle>
                                <CardDescription>Akses file SD card mentah.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3 text-sm text-muted-foreground">
                                <p>Dokumen membatasi SDCARD ke UART/Bluetooth. Untuk MQTT gunakan FTP READ/GET/READLOGS/GETLOG.</p>
                                <Button size="sm" variant="outline" disabled>MQTT disabled</Button>
                            </CardContent>
                        </Card>
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
