import { router } from '@inertiajs/react';
import {
    AlertTriangle,
    Check,
    CheckCircle2,
    Gauge,
    KeyRound,
    Loader2,
    Network,
    Power,
    RefreshCw,
    Tag,
    XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ComponentType, FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { JsonRecord } from '@/hooks/use-logger-serial';
import { postJson } from '@/lib/csrf-fetch';

export interface GcmSetupItem {
    id: number;
    serialNumber: string;
    hardwareVersion: string | null;
    qcStatus: 'pending' | 'passed' | 'failed';
    setupAt: string | null;
}

type SendCommand = (
    payload: JsonRecord,
    expectedKey: string,
    timeoutMs?: number,
) => Promise<JsonRecord>;

// What the GCM reports from the three GET commands, e.g.
// {"PRODUCTION":{"sn":"…","HWVER":"GCM-v5.3"}}, {"MODBUS":{"slave":1,"access":1}},
// {"PIN":{"enable":1,"locked":0,"timeout":60,"tries":0}}. The PIN itself is never read back.
type DeviceState = {
    sn: string | null;
    hwVersion: string | null;
    slave: number | null;
    pinEnabled: boolean | null;
    pinLocked: boolean | null;
};

type StepKey = 'sn' | 'pin' | 'slave' | 'reboot';

const STEPS: Record<
    StepKey,
    {
        label: string;
        description: string;
        icon: ComponentType<{ className?: string }>;
    }
> = {
    sn: {
        label: 'Serial number',
        description: 'Menulis serial number…',
        icon: Tag,
    },
    pin: {
        label: 'PIN perangkat',
        description: 'Menyetel PIN perangkat…',
        icon: KeyRound,
    },
    slave: {
        label: 'Modbus slave',
        description: 'Menyetel alamat Modbus slave…',
        icon: Network,
    },
    reboot: {
        label: 'Reboot',
        description: 'Memulai ulang GCM untuk slave baru…',
        icon: Power,
    },
};

type OutcomeState = { ok: boolean; message?: string } | null;

type RegisterState =
    | { status: 'saving' }
    | { status: 'created' }
    | { status: 'updated' }
    | { status: 'locked'; qcStatus: string }
    | { status: 'error'; message: string }
    | null;

const QC_LABEL: Record<GcmSetupItem['qcStatus'], string> = {
    pending: 'QC pending',
    passed: 'QC passed',
    failed: 'QC failed',
};

function asRecord(value: unknown): JsonRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as JsonRecord)
        : null;
}

// The GCM answers a command under the same key; a bare "ERR", a status of ERR or
// an error field means it refused. Anything else counts as accepted.
function refusal(reply: JsonRecord, key: string): string | null {
    const body = reply[key];
    const record = asRecord(body);
    const status = record ? record.status : body;
    if (
        status !== 'ERR' &&
        status !== 'FAIL' &&
        !(record && 'error' in record)
    ) {
        return null;
    }
    const msg = record?.msg ?? record?.error ?? reply.msg;
    return typeof msg === 'string' ? msg : `GCM menolak perintah ${key}.`;
}

function readNumber(value: unknown): number | null {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function readFlag(value: unknown): boolean | null {
    const n = readNumber(value);
    return n === null ? null : n === 1;
}

/**
 * The GCM view of the Setup page, laid out like Provisioning Logger: after AUTH,
 * write the serial number, device PIN and Modbus slave over USB, reboot when the
 * slave changed, then record the unit in Production.
 */
export function GcmUsbSetup({
    unlocked,
    sendCommand,
    sendRaw,
    onRebooted,
}: {
    unlocked: boolean;
    sendCommand: SendCommand;
    sendRaw: (payload: JsonRecord) => Promise<void>;
    // A reboot drops the AUTH session, so the page locks again.
    onRebooted: () => void;
}) {
    const [sn, setSn] = useState('');
    const [pin, setPin] = useState('');
    const [slave, setSlave] = useState('');
    const [hardwareVersion, setHardwareVersion] = useState('');
    const [productionDate, setProductionDate] = useState('');
    const [testedBy, setTestedBy] = useState('');
    const [qcStatus, setQcStatus] = useState('pending');
    const [notes, setNotes] = useState('');
    const [formError, setFormError] = useState<string | null>(null);

    const [device, setDevice] = useState<DeviceState | null>(null);
    const [readBusy, setReadBusy] = useState(false);
    const [readError, setReadError] = useState<string | null>(null);

    const [writeBusy, setWriteBusy] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [steps, setSteps] = useState<StepKey[]>([]);
    const [done, setDone] = useState(0);
    const [errored, setErrored] = useState(false);
    const [result, setResult] = useState<OutcomeState>(null);
    const [registerState, setRegisterState] = useState<RegisterState>(null);

    async function readDevice() {
        setReadBusy(true);
        setReadError(null);
        try {
            const production = asRecord(
                (
                    await sendCommand(
                        { PRODUCTION: { cmd: 'GET' } },
                        'PRODUCTION',
                    )
                ).PRODUCTION,
            );
            const modbus = asRecord(
                (await sendCommand({ MODBUS: { cmd: 'GET' } }, 'MODBUS'))
                    .MODBUS,
            );
            const pinStatus = asRecord(
                (await sendCommand({ PIN: { cmd: 'GET' } }, 'PIN')).PIN,
            );

            const next: DeviceState = {
                sn: production?.sn !== undefined ? String(production.sn) : null,
                hwVersion:
                    production?.HWVER !== undefined
                        ? String(production.HWVER)
                        : null,
                slave: readNumber(modbus?.slave),
                pinEnabled: readFlag(pinStatus?.enable),
                pinLocked: readFlag(pinStatus?.locked),
            };
            setDevice(next);
            // Prefill only what the operator has not typed yet.
            if (next.sn) setSn((v) => v || next.sn!);
            if (next.hwVersion) setHardwareVersion((v) => v || next.hwVersion!);
            if (next.slave !== null) setSlave((v) => v || String(next.slave));
        } catch (error) {
            setReadError(
                error instanceof Error
                    ? error.message
                    : 'Gagal membaca info GCM.',
            );
        } finally {
            setReadBusy(false);
        }
    }

    // Read the unit as soon as it is unlocked, so the form starts from its values.
    useEffect(() => {
        if (unlocked) void readDevice();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [unlocked]);

    async function registerToProduction() {
        setRegisterState({ status: 'saving' });
        const optional = (value: string) =>
            value.trim() !== '' ? value.trim() : null;
        try {
            const res = await postJson('/production/provision/gcm', {
                serial_number: sn.trim(),
                hardware_version: optional(hardwareVersion),
                production_date: optional(productionDate),
                tested_by: optional(testedBy),
                qc_status: qcStatus,
                notes: optional(notes),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.success) {
                throw new Error(
                    res.status === 419
                        ? 'Sesi login sudah kedaluwarsa. Muat ulang halaman atau login kembali, lalu coba simpan lagi.'
                        : typeof data?.message === 'string'
                          ? data.message
                          : `Server merespons ${res.status}.`,
                );
            }
            setRegisterState(
                data.status === 'locked'
                    ? { status: 'locked', qcStatus: String(data.qcStatus) }
                    : {
                          status:
                              data.status === 'updated' ? 'updated' : 'created',
                      },
            );
            router.reload({ only: ['gcmSetups'] });
        } catch (error) {
            setRegisterState({
                status: 'error',
                message:
                    error instanceof Error
                        ? error.message
                        : 'Gagal menyimpan ke daftar Production.',
            });
        }
    }

    async function expectOk(payload: JsonRecord, key: string) {
        const message = refusal(await sendCommand(payload, key), key);
        if (message) throw new Error(message);
    }

    async function handleWrite(e: FormEvent) {
        e.preventDefault();
        const slaveId = Number(slave);
        if (!/^[1-9]\d{0,8}$/.test(pin)) {
            setFormError('PIN perangkat harus angka, tidak diawali 0.');
            return;
        }
        if (!Number.isInteger(slaveId) || slaveId < 1 || slaveId > 247) {
            setFormError('Modbus slave harus 1 sampai 247.');
            return;
        }
        setFormError(null);

        // A slave the unit has not reported counts as changed: reboot to be sure.
        const reboot = device?.slave !== slaveId;
        const run: Record<StepKey, () => Promise<void>> = {
            sn: () =>
                expectOk(
                    { PRODUCTION: { cmd: 'SET', sn: sn.trim() } },
                    'PRODUCTION',
                ),
            pin: () =>
                expectOk(
                    { PIN: { cmd: 'SET', pin: Number(pin), enable: 1 } },
                    'PIN',
                ),
            slave: () =>
                expectOk({ MODBUS: { cmd: 'SET', slave: slaveId } }, 'MODBUS'),
            // No reply: the unit restarts right away.
            reboot: () => sendRaw({ REBOOT: 1 }),
        };
        const plan: StepKey[] = reboot
            ? ['sn', 'pin', 'slave', 'reboot']
            : ['sn', 'pin', 'slave'];

        setSteps(plan);
        setDone(0);
        setErrored(false);
        setResult(null);
        setRegisterState(null);
        setWriteBusy(true);
        setModalOpen(true);

        try {
            for (const [index, key] of plan.entries()) {
                await run[key]();
                setDone(index + 1);
            }
            setResult({ ok: true });
            setDevice((d) => (d ? { ...d, sn: sn.trim(), slave: slaveId } : d));
            if (reboot) onRebooted();
            await registerToProduction();
        } catch (error) {
            setErrored(true);
            setResult({
                ok: false,
                message:
                    error instanceof Error
                        ? error.message
                        : 'Gagal mengirim perintah ke GCM.',
            });
        } finally {
            setWriteBusy(false);
        }
    }

    const overallProgress = result?.ok
        ? 100
        : steps.length > 0
          ? Math.round((done / steps.length) * 100)
          : 0;
    const rebooted = result?.ok && steps.includes('reboot');
    const snMismatch =
        device?.sn != null && sn.trim() !== '' && device.sn !== sn.trim();
    const slaveMismatch =
        device?.slave != null && slave !== '' && device.slave !== Number(slave);

    return (
        <>
            <Card className={!unlocked ? 'opacity-60' : undefined}>
                <CardHeader>
                    <CardTitle>Provisioning GCM</CardTitle>
                </CardHeader>
                <CardContent>
                    <form
                        onSubmit={handleWrite}
                        className="grid gap-4 sm:grid-cols-3"
                    >
                        <div className="space-y-2">
                            <Label>
                                Serial Number{' '}
                                <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                value={sn}
                                onChange={(e) => setSn(e.target.value)}
                                disabled={!unlocked}
                                required
                                maxLength={31}
                                placeholder="mis. 2609010407002003"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>
                                PIN Perangkat{' '}
                                <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                value={pin}
                                onChange={(e) =>
                                    setPin(e.target.value.replace(/\D/g, ''))
                                }
                                disabled={!unlocked}
                                required
                                inputMode="numeric"
                                maxLength={9}
                                placeholder="mis. 123456"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>
                                Modbus Slave{' '}
                                <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                value={slave}
                                onChange={(e) =>
                                    setSlave(e.target.value.replace(/\D/g, ''))
                                }
                                disabled={!unlocked}
                                required
                                inputMode="numeric"
                                maxLength={3}
                                placeholder="mis. 6"
                            />
                            {slave !== '' &&
                                Number(slave) !== device?.slave && (
                                    <p className="text-xs text-muted-foreground">
                                        GCM reboot otomatis setelah slave
                                        diganti.
                                    </p>
                                )}
                        </div>

                        <div className="sm:col-span-3">
                            <p className="text-sm font-medium">
                                Data Produksi (opsional)
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label>QC Status</Label>
                            <Select
                                value={qcStatus}
                                onValueChange={setQcStatus}
                                disabled={!unlocked}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="pending">
                                        Pending
                                    </SelectItem>
                                    <SelectItem value="passed">
                                        Passed
                                    </SelectItem>
                                    <SelectItem value="failed">
                                        Failed
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Hardware Version</Label>
                            <Input
                                value={hardwareVersion}
                                onChange={(e) =>
                                    setHardwareVersion(e.target.value)
                                }
                                disabled={!unlocked}
                                maxLength={50}
                                placeholder="mis. GCM-v5.3"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Production Date</Label>
                            <Input
                                type="date"
                                value={productionDate}
                                onChange={(e) =>
                                    setProductionDate(e.target.value)
                                }
                                disabled={!unlocked}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Tested By</Label>
                            <Input
                                value={testedBy}
                                onChange={(e) => setTestedBy(e.target.value)}
                                disabled={!unlocked}
                                maxLength={255}
                                placeholder="mis. QC Team A"
                            />
                        </div>
                        <div className="space-y-2 sm:col-span-3">
                            <Label>Notes</Label>
                            <Textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                disabled={!unlocked}
                                rows={2}
                                placeholder="Catatan opsional tentang unit ini…"
                            />
                        </div>

                        {formError && (
                            <p className="flex items-center gap-1.5 text-sm text-red-600 sm:col-span-3 dark:text-red-400">
                                <XCircle className="size-4" />
                                {formError}
                            </p>
                        )}

                        <div className="sm:col-span-3">
                            <Button
                                type="submit"
                                disabled={
                                    !unlocked ||
                                    writeBusy ||
                                    sn.trim() === '' ||
                                    pin === '' ||
                                    slave === ''
                                }
                                className="gap-1.5"
                            >
                                {writeBusy ? (
                                    <>
                                        <Loader2 className="size-4 animate-spin" />
                                        Menulis…
                                    </>
                                ) : (
                                    'Tulis ke GCM'
                                )}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            <Dialog
                open={modalOpen}
                onOpenChange={(open) => {
                    // Jangan tutup selagi proses berjalan.
                    if (!writeBusy) setModalOpen(open);
                }}
            >
                <DialogContent
                    className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
                    onInteractOutside={(e) => {
                        if (writeBusy) e.preventDefault();
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>Menulis ke GCM</DialogTitle>
                        <DialogDescription>
                            SN {sn || '-'} · Slave {slave || '-'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-4">
                        <div className="mb-6 space-y-2">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Overall Progress</span>
                                <span className="font-mono">
                                    {overallProgress}%
                                </span>
                            </div>
                            <Progress
                                value={overallProgress}
                                className={`h-2 [&>div]:transition-all [&>div]:duration-200 ${
                                    errored
                                        ? '[&>div]:bg-red-500'
                                        : '[&>div]:bg-emerald-500'
                                }`}
                            />
                        </div>
                        <div className="space-y-1">
                            {steps.map((key, index) => {
                                const step = STEPS[key];
                                const isDone = index < done;
                                const isError = errored && index === done;
                                const isActive =
                                    writeBusy && !errored && index === done;
                                const StepIcon = step.icon;

                                return (
                                    <div
                                        key={key}
                                        className={`flex items-center gap-4 rounded-lg border px-4 py-3 transition-all duration-300 ${
                                            isError
                                                ? 'border-red-500/40 bg-red-500/5 shadow-sm'
                                                : isActive
                                                  ? 'border-emerald-500/40 bg-emerald-500/5 shadow-sm'
                                                  : isDone
                                                    ? 'border-emerald-500/20 bg-emerald-500/5'
                                                    : 'border-transparent'
                                        }`}
                                    >
                                        <div
                                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-300 ${
                                                isError
                                                    ? 'bg-red-500/10 text-red-500'
                                                    : isDone
                                                      ? 'bg-emerald-500/20 text-emerald-500'
                                                      : isActive
                                                        ? 'bg-emerald-500/10 text-emerald-500'
                                                        : 'bg-muted text-muted-foreground'
                                            }`}
                                        >
                                            {isError ? (
                                                <XCircle className="size-5" />
                                            ) : isDone ? (
                                                <Check className="size-5 animate-in duration-300 fade-in zoom-in" />
                                            ) : isActive ? (
                                                <Loader2 className="size-5 animate-spin" />
                                            ) : (
                                                <StepIcon className="size-5" />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p
                                                className={`text-sm font-medium ${
                                                    isError
                                                        ? 'text-red-600 dark:text-red-400'
                                                        : isDone
                                                          ? 'text-emerald-600 dark:text-emerald-400'
                                                          : isActive
                                                            ? 'text-foreground'
                                                            : 'text-muted-foreground'
                                                }`}
                                            >
                                                {step.label}
                                            </p>
                                            {isActive && (
                                                <p className="mt-0.5 text-xs text-muted-foreground">
                                                    {step.description}
                                                </p>
                                            )}
                                        </div>
                                        {isDone && (
                                            <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {result && (
                        <div
                            className={`flex items-center gap-2 rounded-md border p-3 text-sm ${
                                result.ok
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                    : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
                            }`}
                        >
                            {result.ok ? (
                                <CheckCircle2 className="size-4 shrink-0" />
                            ) : (
                                <XCircle className="size-4 shrink-0" />
                            )}
                            {result.ok
                                ? rebooted
                                    ? 'Berhasil ditulis ke GCM. GCM sedang reboot, masukkan AUTH lagi sebelum verifikasi.'
                                    : 'Berhasil ditulis ke GCM.'
                                : result.message}
                        </div>
                    )}

                    {registerState && (
                        <div
                            className={`flex items-center gap-2 rounded-md border p-3 text-sm ${
                                registerState.status === 'error'
                                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                    : registerState.status === 'saving'
                                      ? 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300'
                                      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            }`}
                        >
                            {registerState.status === 'saving' ? (
                                <Loader2 className="size-4 shrink-0 animate-spin" />
                            ) : registerState.status === 'error' ? (
                                <AlertTriangle className="size-4 shrink-0" />
                            ) : (
                                <CheckCircle2 className="size-4 shrink-0" />
                            )}
                            {registerState.status === 'saving'
                                ? 'Menyimpan ke daftar Production…'
                                : registerState.status === 'created'
                                  ? `Otomatis tercatat di daftar Production (QC: ${qcStatus}).`
                                  : registerState.status === 'updated'
                                    ? 'Data di daftar Production diperbarui (SN sudah terdaftar).'
                                    : registerState.status === 'locked'
                                      ? `SN sudah di daftar Production dengan QC ${registerState.qcStatus}, datanya tidak diubah.`
                                      : `GCM sudah ditulis, tapi gagal dicatat ke daftar Production: ${registerState.message}`}
                        </div>
                    )}

                    <DialogFooter>
                        {registerState?.status === 'error' && result?.ok && (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={registerToProduction}
                            >
                                <RefreshCw className="mr-2 size-4" />
                                Coba simpan lagi
                            </Button>
                        )}
                        <Button
                            type="button"
                            variant={
                                result && !result.ok ? 'outline' : 'default'
                            }
                            disabled={writeBusy}
                            onClick={() => setModalOpen(false)}
                        >
                            {writeBusy ? (
                                <>
                                    <Loader2 className="mr-2 size-4 animate-spin" />
                                    Menulis…
                                </>
                            ) : (
                                'Tutup'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Card className={!unlocked ? 'opacity-60' : undefined}>
                <CardHeader>
                    <CardTitle>Verifikasi</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Button
                        variant="outline"
                        onClick={() => void readDevice()}
                        disabled={!unlocked || readBusy || writeBusy}
                        className="gap-1.5"
                    >
                        {readBusy ? (
                            <>
                                <RefreshCw className="size-4 animate-spin" />
                                Membaca
                            </>
                        ) : (
                            'Baca Info GCM'
                        )}
                    </Button>
                    {readError && (
                        <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                            <XCircle className="size-4" />
                            {readError}
                        </p>
                    )}
                    {device && (
                        <div className="grid gap-3 text-sm sm:grid-cols-4">
                            <InfoValue
                                label="Serial Number"
                                value={device.sn}
                                mismatch={snMismatch}
                            />
                            <InfoValue
                                label="Hardware Version"
                                value={device.hwVersion}
                            />
                            <InfoValue
                                label="Modbus Slave"
                                value={
                                    device.slave !== null
                                        ? String(device.slave)
                                        : null
                                }
                                mismatch={slaveMismatch}
                            />
                            <InfoValue
                                label="PIN"
                                value={
                                    device.pinEnabled === null
                                        ? null
                                        : !device.pinEnabled
                                          ? 'Nonaktif'
                                          : device.pinLocked
                                            ? 'Aktif · terkunci'
                                            : 'Aktif'
                                }
                            />
                        </div>
                    )}
                </CardContent>
            </Card>
        </>
    );
}

function InfoValue({
    label,
    value,
    mismatch = false,
}: {
    label: string;
    value: string | null;
    mismatch?: boolean;
}) {
    return (
        <div>
            <div className="text-muted-foreground">{label}</div>
            <div
                className={`font-medium ${mismatch ? 'text-red-600 dark:text-red-400' : ''}`}
            >
                {value || '-'}
            </div>
        </div>
    );
}

/** Riwayat Setup for the GCM view: units recorded in Production by this page. */
export function GcmSetupHistory({ items }: { items: GcmSetupItem[] }) {
    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-lg border px-3 py-8 text-center">
                <Gauge className="mb-2 size-7 text-muted-foreground/40" />
                <p className="text-sm font-medium">
                    Belum ada GCM yang diset lewat USB
                </p>
            </div>
        );
    }

    return (
        <div className="grid gap-2">
            {items.map((item) => (
                <div key={item.id} className="rounded-lg border p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold">
                            {item.serialNumber}
                        </p>
                        <Badge
                            variant="outline"
                            className={
                                item.qcStatus === 'passed'
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                    : item.qcStatus === 'failed'
                                      ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
                                      : undefined
                            }
                        >
                            {QC_LABEL[item.qcStatus]}
                        </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {item.hardwareVersion && (
                            <span>{item.hardwareVersion}</span>
                        )}
                        {item.setupAt && <span>{item.setupAt}</span>}
                    </div>
                </div>
            ))}
        </div>
    );
}
