import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    Database,
    Loader2,
    Radio,
    Settings2,
    ShieldAlert,
    XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
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
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';

interface ModeOption {
    slug: string;
    label: string;
    group: string;
    description: string | null;
}

interface UserInputDefinition {
    key: string;
    label: string;
    type: 'number';
    min: number;
    max: number;
    default: number;
    required: boolean;
}

interface TemplateParameter {
    name: string;
    unit: string;
    scale_factor: number;
    register_address: number;
    reg_count: number;
    data_type_label: string;
    fast_poll: boolean;
}

interface TemplateDevice {
    device_name: string;
    function_code: number;
    register_address: number;
    baudrate: number;
    serial_format: string;
}

interface SensorTemplate {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    disabled_reason: string | null;
    connection_type: 'rs485';
    user_inputs: UserInputDefinition[];
    device: TemplateDevice | null;
    parameters: TemplateParameter[];
}

interface ProfileRole {
    role: string;
    label: string;
    required: boolean;
    templates: SensorTemplate[];
}

interface CalibrationField {
    key: string;
    label: string;
    unit: string;
    type: 'number';
    min: number;
    step: number;
}

interface ModeProfile {
    mode: string;
    label: string;
    description: string;
    enabled: boolean;
    disabled_reason: string | null;
    roles: ProfileRole[];
    default_mapping: string[];
    calibration: {
        source: string;
        fields: CalibrationField[];
    } | null;
}

interface PreviewWarning {
    type: string;
    message: string;
    existing_sensors: {
        id: number;
        name: string;
        device_name: string | null;
        modbus_slave_id: number;
    }[];
}

interface PreviewSensor {
    role: string;
    role_label: string;
    slave_id: number;
    template: string;
    device: TemplateDevice & { modbus_slave_id: number };
    parameters: TemplateParameter[];
}

interface ModeProfilePreview {
    success: true;
    mode: string;
    summary: string;
    warnings: PreviewWarning[];
    changes: {
        mode: {
            from: string | null;
            to: string;
        };
        sensors: PreviewSensor[];
        mapping: string[];
        calibration: ModeProfile['calibration'];
    };
    requires_confirmation: boolean;
}

interface NextStep {
    type: 'calibration';
    mode: string;
    source: string;
    fields: CalibrationField[];
}

interface ApiResponse {
    success: boolean;
    message?: string;
    profile?: ModeProfile;
    next_step?: NextStep | null;
    warnings?: PreviewWarning[];
    errors?: Record<string, string[]>;
}

interface ModeProfileWizardProps {
    logger: {
        deviceIdentifier: string | null;
        loggerMode: string | null;
        status: 'online' | 'offline' | 'warning';
        availableModes: ModeOption[];
    };
    disabled?: boolean;
    onComplete: () => void;
}

type WizardPhase =
    | 'idle'
    | 'loading'
    | 'previewing'
    | 'applying'
    | 'direct'
    | 'success'
    | 'error';

const GUIDED_MODES = new Set(['ARR', 'AWLR_TD', 'AWLR_US', 'APMS']);

function csrfToken(): string {
    return (
        document
            .querySelector('meta[name="csrf-token"]')
            ?.getAttribute('content') || ''
    );
}

async function postJson<T extends ApiResponse | ModeProfilePreview>(
    url: string,
    body: Record<string, unknown>,
): Promise<T> {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-CSRF-TOKEN': csrfToken(),
        },
        body: JSON.stringify(body),
    });
    const data = (await response.json()) as T;

    return data;
}

function responseMessage(data: ApiResponse, fallback: string): string {
    if (data.message) return data.message;
    const firstError = Object.values(data.errors ?? {}).flat()[0];
    return firstError || fallback;
}

export function ModeProfileWizard({
    logger,
    disabled = false,
    onComplete,
}: ModeProfileWizardProps) {
    const allowedModes = logger.availableModes;
    const initialMode = allowedModes.some(
        (mode) => mode.slug === logger.loggerMode,
    )
        ? logger.loggerMode || ''
        : '';
    const [selectedMode, setSelectedMode] = useState(initialMode);
    const [profile, setProfile] = useState<ModeProfile | null>(null);
    const [templateIds, setTemplateIds] = useState<Record<string, string>>({});
    const [inputValues, setInputValues] = useState<
        Record<string, Record<string, string>>
    >({});
    const [phase, setPhase] = useState<WizardPhase>('idle');
    const [message, setMessage] = useState('');
    const [preview, setPreview] = useState<ModeProfilePreview | null>(null);
    const [nextStep, setNextStep] = useState<NextStep | null>(null);
    const [calibrationValues, setCalibrationValues] = useState<
        Record<string, string>
    >({});
    const [calibrationSending, setCalibrationSending] = useState(false);
    const [calibrationError, setCalibrationError] = useState('');

    const groupedModes = useMemo(() => {
        const groups = new Map<string, ModeOption[]>();
        for (const mode of allowedModes) {
            groups.set(mode.group, [...(groups.get(mode.group) ?? []), mode]);
        }
        return Array.from(groups.entries());
    }, [allowedModes]);

    const selectedModeInfo = allowedModes.find(
        (mode) => mode.slug === selectedMode,
    );
    const activeModeInfo = allowedModes.find(
        (mode) => mode.slug === logger.loggerMode,
    );
    const guided = GUIDED_MODES.has(selectedMode);
    const directModeChanged =
        selectedMode !== '' && selectedMode !== logger.loggerMode;

    useEffect(() => {
        let cancelled = false;

        setPreview(null);
        setNextStep(null);
        setMessage('');
        setTemplateIds({});
        setInputValues({});
        setProfile(null);

        if (!selectedMode || !GUIDED_MODES.has(selectedMode)) {
            setPhase('idle');
            return;
        }

        setPhase('loading');
        fetch(`/api/mqtt/mode-profiles/${encodeURIComponent(selectedMode)}`, {
            headers: { Accept: 'application/json' },
        })
            .then(async (response) => {
                const data = (await response.json()) as ApiResponse;
                if (!response.ok || !data.success || !data.profile) {
                    throw new Error(
                        responseMessage(
                            data,
                            'Mode profile tidak dapat dimuat.',
                        ),
                    );
                }
                return data.profile;
            })
            .then((loadedProfile) => {
                if (cancelled) return;

                const initialTemplates: Record<string, string> = {};
                const initialInputs: Record<
                    string,
                    Record<string, string>
                > = {};
                for (const role of loadedProfile.roles) {
                    const selectedTemplate =
                        role.templates.find((template) => template.enabled) ??
                        role.templates[0];
                    if (!selectedTemplate) continue;

                    initialTemplates[role.role] = selectedTemplate.id;
                    initialInputs[role.role] = Object.fromEntries(
                        selectedTemplate.user_inputs.map((input) => [
                            input.key,
                            String(input.default),
                        ]),
                    );
                }

                setProfile(loadedProfile);
                setTemplateIds(initialTemplates);
                setInputValues(initialInputs);
                setPhase('idle');
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                setPhase('error');
                setMessage(
                    error instanceof Error
                        ? error.message
                        : 'Mode profile tidak dapat dimuat.',
                );
            });

        return () => {
            cancelled = true;
        };
    }, [selectedMode]);

    function selectTemplate(role: ProfileRole, templateId: string) {
        const template = role.templates.find(
            (candidate) => candidate.id === templateId,
        );
        if (!template) return;

        setTemplateIds((current) => ({ ...current, [role.role]: templateId }));
        setInputValues((current) => ({
            ...current,
            [role.role]: Object.fromEntries(
                template.user_inputs.map((input) => [
                    input.key,
                    String(input.default),
                ]),
            ),
        }));
    }

    function updateInput(role: string, key: string, value: string) {
        setInputValues((current) => ({
            ...current,
            [role]: {
                ...(current[role] ?? {}),
                [key]: value,
            },
        }));
    }

    function selections() {
        if (!profile) return [];

        return profile.roles.map((role) => ({
            role: role.role,
            template_id: templateIds[role.role],
            inputs: Object.fromEntries(
                Object.entries(inputValues[role.role] ?? {}).map(
                    ([key, value]) => [key, Number(value)],
                ),
            ),
        }));
    }

    function selectionReady(): boolean {
        if (!profile?.enabled || profile.roles.length === 0) return false;

        return profile.roles.every((role) => {
            const template = role.templates.find(
                (candidate) => candidate.id === templateIds[role.role],
            );
            if (!template?.enabled) return false;

            return template.user_inputs.every((input) => {
                const value = Number(inputValues[role.role]?.[input.key]);
                return (
                    Number.isInteger(value) &&
                    value >= input.min &&
                    value <= input.max
                );
            });
        });
    }

    async function loadPreview() {
        if (!logger.deviceIdentifier || !profile || !selectionReady()) return;

        setPhase('previewing');
        setMessage('');
        try {
            const data = await postJson<ModeProfilePreview | ApiResponse>(
                '/api/mqtt/mode-profile/preview',
                {
                    id_logger: logger.deviceIdentifier,
                    mode: selectedMode,
                    selections: selections(),
                },
            );

            if (!data.success || !('changes' in data)) {
                setPhase('error');
                setMessage(
                    responseMessage(
                        data as ApiResponse,
                        'Preview setup gagal.',
                    ),
                );
                return;
            }

            setPreview(data);
            setPhase('idle');
        } catch (error) {
            setPhase('error');
            setMessage(
                error instanceof Error ? error.message : 'Preview setup gagal.',
            );
        }
    }

    async function applyProfile() {
        if (!logger.deviceIdentifier || !preview) return;

        setPhase('applying');
        setMessage('');
        try {
            const data = await postJson<ApiResponse>(
                '/api/mqtt/mode-profile/apply',
                {
                    id_logger: logger.deviceIdentifier,
                    mode: selectedMode,
                    selections: selections(),
                    confirmed_warnings: preview.warnings.map(
                        (warning) => warning.type,
                    ),
                },
            );

            if (!data.success) {
                setPhase('error');
                setMessage(
                    responseMessage(data, 'Mode profile gagal diterapkan.'),
                );
                return;
            }

            setPreview(null);
            setMessage(data.message || 'Mode profile berhasil diterapkan.');
            if (data.next_step) {
                setCalibrationValues(
                    Object.fromEntries(
                        data.next_step.fields.map((field) => [field.key, '']),
                    ),
                );
                setNextStep(data.next_step);
                setPhase('success');
                return;
            }

            setPhase('success');
            window.setTimeout(onComplete, 1000);
        } catch (error) {
            setPhase('error');
            setMessage(
                error instanceof Error
                    ? error.message
                    : 'Mode profile gagal diterapkan.',
            );
        }
    }

    async function setDirectMode() {
        if (!logger.deviceIdentifier || !selectedMode || !directModeChanged)
            return;

        setPhase('direct');
        setMessage('');
        try {
            const data = await postJson<ApiResponse>(
                '/api/mqtt/system/set-mode',
                {
                    id_logger: logger.deviceIdentifier,
                    mode: selectedMode,
                },
            );

            if (!data.success) {
                setPhase('error');
                setMessage(responseMessage(data, 'Gagal mengubah mode.'));
                return;
            }

            setPhase('success');
            setMessage(
                data.message || `Mode berhasil diubah ke ${selectedMode}.`,
            );
            window.setTimeout(onComplete, 1000);
        } catch (error) {
            setPhase('error');
            setMessage(
                error instanceof Error ? error.message : 'Gagal mengubah mode.',
            );
        }
    }

    async function submitCalibration() {
        if (!logger.deviceIdentifier || !nextStep) return;

        const valuesReady = nextStep.fields.every((field) => {
            const value = Number(calibrationValues[field.key]);
            return Number.isFinite(value) && value >= field.min;
        });
        if (!valuesReady) {
            setCalibrationError('Lengkapi semua nilai kalibrasi.');
            return;
        }

        setCalibrationSending(true);
        setCalibrationError('');
        try {
            const data = await postJson<ApiResponse>(
                '/api/mqtt/calibration/set',
                {
                    id_logger: logger.deviceIdentifier,
                    source: nextStep.source,
                    ...Object.fromEntries(
                        nextStep.fields.map((field) => [
                            field.key,
                            Number(calibrationValues[field.key]),
                        ]),
                    ),
                },
            );

            if (!data.success) {
                setCalibrationError(responseMessage(data, 'Kalibrasi gagal.'));
                return;
            }

            setNextStep(null);
            setMessage(data.message || 'Kalibrasi berhasil.');
            window.setTimeout(onComplete, 600);
        } catch (error) {
            setCalibrationError(
                error instanceof Error ? error.message : 'Kalibrasi gagal.',
            );
        } finally {
            setCalibrationSending(false);
        }
    }

    const busy =
        phase === 'loading' ||
        phase === 'previewing' ||
        phase === 'applying' ||
        phase === 'direct';
    const unavailable =
        disabled ||
        !logger.deviceIdentifier ||
        logger.status === 'offline' ||
        busy;

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Radio className="size-5" /> Mode Profile Logger
                    </CardTitle>
                    <CardDescription>
                        {activeModeInfo ? (
                            <>
                                Mode aktif:{' '}
                                <strong>{activeModeInfo.label}</strong>
                            </>
                        ) : (
                            'Belum ada mode yang diset'
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {activeModeInfo && (
                        <div className="flex items-center gap-2 border-l-2 border-emerald-500 bg-emerald-500/5 px-3 py-2">
                            <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                    {activeModeInfo.label}
                                </p>
                                <p className="font-mono text-[10px] text-muted-foreground">
                                    {activeModeInfo.slug}
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="grid gap-1.5">
                        <Label htmlFor="mode-profile-select">Mode</Label>
                        <Select
                            value={selectedMode}
                            onValueChange={setSelectedMode}
                            disabled={disabled || busy}
                        >
                            <SelectTrigger id="mode-profile-select">
                                <SelectValue placeholder="Pilih mode logger" />
                            </SelectTrigger>
                            <SelectContent>
                                {groupedModes.map(([group, modes]) => (
                                    <SelectGroup key={group}>
                                        <SelectLabel>{group}</SelectLabel>
                                        {modes.map((mode) => (
                                            <SelectItem
                                                key={mode.slug}
                                                value={mode.slug}
                                            >
                                                {mode.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {phase === 'loading' && (
                        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" /> Memuat
                            template sensor...
                        </div>
                    )}

                    {guided && profile && (
                        <>
                            {!profile.enabled && (
                                <div className="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                                    <div>
                                        <p className="font-medium">
                                            {profile.label}
                                        </p>
                                        <p className="text-xs">
                                            {profile.disabled_reason}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {profile.enabled &&
                                profile.roles.map((role) => {
                                    const template = role.templates.find(
                                        (candidate) =>
                                            candidate.id ===
                                            templateIds[role.role],
                                    );
                                    return (
                                        <div
                                            key={role.role}
                                            className="space-y-3 border-t pt-4"
                                        >
                                            <div className="grid gap-1.5">
                                                <Label
                                                    htmlFor={`profile-template-${role.role}`}
                                                >
                                                    {role.label}
                                                </Label>
                                                <Select
                                                    value={
                                                        templateIds[
                                                            role.role
                                                        ] || ''
                                                    }
                                                    onValueChange={(value) =>
                                                        selectTemplate(
                                                            role,
                                                            value,
                                                        )
                                                    }
                                                    disabled={unavailable}
                                                >
                                                    <SelectTrigger
                                                        id={`profile-template-${role.role}`}
                                                    >
                                                        <SelectValue
                                                            placeholder={`Pilih ${role.label.toLowerCase()}`}
                                                        />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {role.templates.map(
                                                            (candidate) => (
                                                                <SelectItem
                                                                    key={
                                                                        candidate.id
                                                                    }
                                                                    value={
                                                                        candidate.id
                                                                    }
                                                                    disabled={
                                                                        !candidate.enabled
                                                                    }
                                                                >
                                                                    {
                                                                        candidate.name
                                                                    }
                                                                    {!candidate.enabled &&
                                                                    candidate.disabled_reason
                                                                        ? ` - ${candidate.disabled_reason}`
                                                                        : ''}
                                                                </SelectItem>
                                                            ),
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            {template?.user_inputs.map(
                                                (input) => (
                                                    <div
                                                        key={input.key}
                                                        className="grid gap-1.5"
                                                    >
                                                        <Label
                                                            htmlFor={`profile-${role.role}-${input.key}`}
                                                        >
                                                            {input.label}
                                                        </Label>
                                                        <Input
                                                            id={`profile-${role.role}-${input.key}`}
                                                            type="number"
                                                            min={input.min}
                                                            max={input.max}
                                                            step={1}
                                                            value={
                                                                inputValues[
                                                                    role.role
                                                                ]?.[
                                                                    input.key
                                                                ] ?? ''
                                                            }
                                                            onChange={(event) =>
                                                                updateInput(
                                                                    role.role,
                                                                    input.key,
                                                                    event.target
                                                                        .value,
                                                                )
                                                            }
                                                            disabled={
                                                                unavailable
                                                            }
                                                        />
                                                    </div>
                                                ),
                                            )}
                                        </div>
                                    );
                                })}
                        </>
                    )}

                    {phase === 'error' && (
                        <div className="flex items-start gap-2 border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                            <XCircle className="mt-0.5 size-4 shrink-0" />{' '}
                            {message}
                        </div>
                    )}

                    {phase === 'success' && message && (
                        <div className="flex items-start gap-2 border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />{' '}
                            {message}
                        </div>
                    )}

                    {guided ? (
                        <Button
                            className="w-full gap-2"
                            disabled={
                                unavailable ||
                                !profile?.enabled ||
                                !selectionReady()
                            }
                            onClick={loadPreview}
                        >
                            {phase === 'previewing' ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <Settings2 className="size-4" />
                            )}
                            Preview Setup {selectedMode}
                        </Button>
                    ) : (
                        <Button
                            className="w-full gap-2"
                            disabled={unavailable || !directModeChanged}
                            onClick={setDirectMode}
                        >
                            {phase === 'direct' ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <Radio className="size-4" />
                            )}
                            {directModeChanged
                                ? `Terapkan ${selectedModeInfo?.label || selectedMode}`
                                : 'Pilih mode baru'}
                        </Button>
                    )}
                </CardContent>
            </Card>

            <Dialog
                open={preview !== null}
                onOpenChange={(open) => {
                    if (!open && phase !== 'applying') setPreview(null);
                }}
            >
                <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Preview Setup {preview?.mode}</DialogTitle>
                        <DialogDescription>
                            {preview?.summary}
                        </DialogDescription>
                    </DialogHeader>

                    {preview && (
                        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
                            {preview.warnings.map((warning) => (
                                <div
                                    key={`${warning.type}-${warning.message}`}
                                    className="border border-amber-500/40 bg-amber-500/5 p-3"
                                >
                                    <div className="flex items-start gap-2">
                                        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                                                Sensor pada slave akan diganti
                                            </p>
                                            <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
                                                {warning.message}
                                            </p>
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {warning.existing_sensors.map(
                                                    (sensor) => (
                                                        <span
                                                            key={sensor.id}
                                                            className="border border-amber-500/30 bg-background px-2 py-1 font-mono text-[11px]"
                                                        >
                                                            {sensor.name}
                                                        </span>
                                                    ),
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="border p-3">
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase">
                                        Mode
                                    </p>
                                    <div className="mt-2 flex items-center gap-2 text-sm">
                                        <span>
                                            {preview.changes.mode.from ||
                                                'Belum diset'}
                                        </span>
                                        <ArrowRight className="size-4 text-muted-foreground" />
                                        <strong>
                                            {preview.changes.mode.to}
                                        </strong>
                                    </div>
                                </div>
                                <div className="border p-3">
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase">
                                        Mapping Data
                                    </p>
                                    <p className="mt-2 text-sm">
                                        {preview.changes.mapping.length} slot
                                        akan diatur
                                    </p>
                                </div>
                            </div>

                            {preview.changes.sensors.map((sensor) => (
                                <div
                                    key={`${sensor.role}-${sensor.slave_id}`}
                                    className="space-y-3 border p-3"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div>
                                            <p className="text-sm font-semibold">
                                                {sensor.template}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {sensor.role_label} - Slave ID{' '}
                                                {sensor.slave_id}
                                            </p>
                                        </div>
                                        <Database className="size-4 text-muted-foreground" />
                                    </div>

                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-5">
                                        <div>
                                            <dt className="text-muted-foreground">
                                                Function
                                            </dt>
                                            <dd className="font-mono">
                                                0{sensor.device.function_code}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-muted-foreground">
                                                Baudrate
                                            </dt>
                                            <dd className="font-mono">
                                                {sensor.device.baudrate}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-muted-foreground">
                                                Format
                                            </dt>
                                            <dd className="font-mono">
                                                {sensor.device.serial_format}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-muted-foreground">
                                                Alamat awal
                                            </dt>
                                            <dd className="font-mono">
                                                {sensor.device.register_address}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-muted-foreground">
                                                Interface
                                            </dt>
                                            <dd className="font-mono">RS485</dd>
                                        </div>
                                    </dl>

                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>
                                                        Parameter
                                                    </TableHead>
                                                    <TableHead>Unit</TableHead>
                                                    <TableHead>Scale</TableHead>
                                                    <TableHead>
                                                        Address
                                                    </TableHead>
                                                    <TableHead>
                                                        Data Type
                                                    </TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {sensor.parameters.map(
                                                    (parameter) => (
                                                        <TableRow
                                                            key={parameter.name}
                                                        >
                                                            <TableCell className="font-mono text-xs">
                                                                {parameter.name}
                                                            </TableCell>
                                                            <TableCell>
                                                                {parameter.unit}
                                                            </TableCell>
                                                            <TableCell className="font-mono">
                                                                {
                                                                    parameter.scale_factor
                                                                }
                                                            </TableCell>
                                                            <TableCell className="font-mono">
                                                                {
                                                                    parameter.register_address
                                                                }
                                                            </TableCell>
                                                            <TableCell className="font-mono">
                                                                {
                                                                    parameter.data_type_label
                                                                }
                                                            </TableCell>
                                                        </TableRow>
                                                    ),
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            ))}

                            <div className="border p-3">
                                <p className="mb-2 text-[10px] font-semibold text-muted-foreground uppercase">
                                    Susunan Mapping Data
                                </p>
                                <ol className="space-y-1">
                                    {preview.changes.mapping.map(
                                        (mapping, index) => (
                                            <li
                                                key={mapping}
                                                className="flex gap-2 font-mono text-xs"
                                            >
                                                <span className="w-5 text-muted-foreground">
                                                    {index + 1}.
                                                </span>
                                                <span>{mapping}</span>
                                            </li>
                                        ),
                                    )}
                                </ol>
                            </div>

                            {phase === 'error' && message && (
                                <div className="flex items-start gap-2 border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                                    <XCircle className="mt-0.5 size-4 shrink-0" />{' '}
                                    {message}
                                </div>
                            )}
                        </div>
                    )}

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setPreview(null)}
                            disabled={phase === 'applying'}
                        >
                            Batalkan
                        </Button>
                        <Button
                            onClick={applyProfile}
                            disabled={phase === 'applying'}
                        >
                            {phase === 'applying' ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <Settings2 className="size-4" />
                            )}
                            {preview?.requires_confirmation
                                ? 'Lanjutkan dan Ganti Sensor'
                                : 'Terapkan Profile'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={nextStep !== null}
                onOpenChange={(open) => {
                    if (!open && !calibrationSending) {
                        setNextStep(null);
                        onComplete();
                    }
                }}
            >
                <DialogContent className="sm:max-w-lg" showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle>Kalibrasi AWLR Transducer</DialogTitle>
                        <DialogDescription>
                            Sensor dan mapping sudah berhasil diset.
                        </DialogDescription>
                    </DialogHeader>

                    {nextStep && (
                        <div className="space-y-4">
                            <div className="grid gap-1.5">
                                <Label htmlFor="mode-profile-calibration-source">
                                    Sumber Data
                                </Label>
                                <Input
                                    id="mode-profile-calibration-source"
                                    value={nextStep.source}
                                    readOnly
                                    className="font-mono"
                                />
                            </div>
                            {nextStep.fields.map((field) => (
                                <div key={field.key} className="grid gap-1.5">
                                    <Label
                                        htmlFor={`mode-profile-calibration-${field.key}`}
                                    >
                                        {field.label}{' '}
                                        <span className="text-xs text-muted-foreground">
                                            ({field.unit})
                                        </span>
                                    </Label>
                                    <Input
                                        id={`mode-profile-calibration-${field.key}`}
                                        type="number"
                                        min={field.min}
                                        step={field.step}
                                        value={
                                            calibrationValues[field.key] ?? ''
                                        }
                                        onChange={(event) =>
                                            setCalibrationValues((current) => ({
                                                ...current,
                                                [field.key]: event.target.value,
                                            }))
                                        }
                                        disabled={calibrationSending}
                                    />
                                </div>
                            ))}
                            {calibrationError && (
                                <div className="flex items-start gap-2 border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                                    <XCircle className="mt-0.5 size-4 shrink-0" />{' '}
                                    {calibrationError}
                                </div>
                            )}
                        </div>
                    )}

                    <DialogFooter>
                        <Button
                            variant="outline"
                            disabled={calibrationSending}
                            onClick={() => {
                                setNextStep(null);
                                onComplete();
                            }}
                        >
                            Kalibrasi Nanti
                        </Button>
                        <Button
                            onClick={submitCalibration}
                            disabled={calibrationSending}
                        >
                            {calibrationSending ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <Settings2 className="size-4" />
                            )}
                            Kirim Kalibrasi
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
