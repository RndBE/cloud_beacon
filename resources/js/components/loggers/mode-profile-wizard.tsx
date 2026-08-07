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
import { useTranslation } from 'react-i18next';
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
import type {
    ProtocolCommandPayload,
    ProtocolCommandTransport,
} from '@/pages/loggers/protocol';

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
    automatic_calibration?: Record<string, string | number> | null;
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
    connection_type: 'rs485';
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
    variant?: 'card' | 'inline';
    transportMode?: 'mqtt' | 'serial';
    commandTransport?: ProtocolCommandTransport;
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

const GUIDED_MODES = new Set(['ARR', 'AWR', 'AWLR_TD', 'AWLR_US', 'APMS']);

// Selector fallback for a logger that has no mode yet. An empty selector reads as "nothing chosen"
// when the real state is "not configured", and the operator has to discover that DEFAULT is the
// plain mode. Nothing is sent on selection alone — the apply button still needs an explicit click.
const FALLBACK_MODE = 'DEFAULT';

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

function sensorSetPayload(sensor: PreviewSensor): ProtocolCommandPayload {
    return {
        SENSORS: {
            cmd: 'SET',
            type: 'RS485',
            d: [
                {
                    cfg: [
                        sensor.device.modbus_slave_id,
                        sensor.device.device_name,
                        sensor.device.function_code,
                        sensor.device.register_address,
                        sensor.device.baudrate,
                        sensor.device.serial_format,
                    ],
                    s: sensor.parameters.map((parameter) => [
                        parameter.name,
                        parameter.scale_factor,
                        parameter.unit,
                        parameter.register_address,
                        parameter.reg_count,
                        parameter.fast_poll ? 1 : 0,
                    ]),
                },
            ],
        },
    };
}

function mappingSetPayload(mapping: string[]): ProtocolCommandPayload {
    const body: Record<string, string | number> = { cmd: 'SET' };
    mapping.forEach((name, index) => {
        body[`s${index + 1}`] = name;
    });
    return { MAP_DATA: body };
}

export function ModeProfileWizard({
    logger,
    disabled = false,
    variant = 'card',
    transportMode = 'mqtt',
    commandTransport,
    onComplete,
}: ModeProfileWizardProps) {
    const { t } = useTranslation();
    const allowedModes = logger.availableModes;
    // The logger's own mode wins; DEFAULT only fills in when it has none. Guarded on DEFAULT
    // actually being offered, so a board whose allowlist excludes it still starts blank rather
    // than showing a mode it cannot be set to.
    const initialMode = allowedModes.some(
        (mode) => mode.slug === logger.loggerMode,
    )
        ? logger.loggerMode || ''
        : allowedModes.some((mode) => mode.slug === FALLBACK_MODE)
          ? FALLBACK_MODE
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
    const [inlineStep, setInlineStep] = useState<'mode' | 'sensor'>('mode');

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
        if (variant === 'inline') {
            setInlineStep('mode');
        }

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
                if (
                    variant === 'inline' &&
                    loadedProfile.enabled &&
                    loadedProfile.roles.length > 0
                ) {
                    setInlineStep('sensor');
                }
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
    }, [selectedMode, variant]);

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
            const confirmedWarnings = preview.warnings.map(
                (warning) => warning.type,
            );
            const data: ApiResponse =
                transportMode === 'serial' && commandTransport
                    ? await (async () => {
                          const modeResult = await commandTransport('SYSTEM', {
                              SYSTEM: {
                                  cmd: 'SET_MODE',
                                  mode: selectedMode,
                              },
                          });
                          if (!modeResult.success)
                              return {
                                  success: false,
                                  message: modeResult.message,
                              };

                          for (const sensor of preview.changes.sensors) {
                              const sensorResult = await commandTransport(
                                  'SENSORS',
                                  sensorSetPayload(sensor),
                              );
                              if (!sensorResult.success)
                                  return {
                                      success: false,
                                      message: sensorResult.message,
                                  };
                          }

                          const automaticCalibration =
                              profile?.automatic_calibration;
                          if (automaticCalibration) {
                              const calibrationResult = await commandTransport(
                                  selectedMode,
                                  {
                                      [selectedMode]: {
                                          cmd: 'SET',
                                          ...automaticCalibration,
                                      },
                                  },
                              );
                              if (!calibrationResult.success)
                                  return {
                                      success: false,
                                      message: calibrationResult.message,
                                  };
                          }

                          if (preview.changes.mapping.length > 0) {
                              const mappingResult = await commandTransport(
                                  'MAP_DATA',
                                  mappingSetPayload(preview.changes.mapping),
                              );
                              if (!mappingResult.success)
                                  return {
                                      success: false,
                                      message: mappingResult.message,
                                  };
                          }

                          return postJson<ApiResponse>(
                              '/api/serial/mode-profile/import',
                              {
                                  id_logger: logger.deviceIdentifier,
                                  mode: selectedMode,
                                  selections: selections(),
                                  confirmed_warnings: confirmedWarnings,
                              },
                          );
                      })()
                    : await postJson<ApiResponse>(
                          '/api/mqtt/mode-profile/apply',
                          {
                              id_logger: logger.deviceIdentifier,
                              mode: selectedMode,
                              selections: selections(),
                              confirmed_warnings: confirmedWarnings,
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
            const data =
                transportMode === 'serial' && commandTransport
                    ? await commandTransport('SYSTEM', {
                          SYSTEM: { cmd: 'SET_MODE', mode: selectedMode },
                      }).then(async (result) => {
                          if (result.success) {
                              return postJson<ApiResponse>(
                                  '/api/serial/system/set-mode/import',
                                  {
                                      id_logger: logger.deviceIdentifier,
                                      mode: selectedMode,
                                      response: result.data ?? null,
                                  },
                              );
                          }
                          return result;
                      })
                    : await postJson<ApiResponse>('/api/mqtt/system/set-mode', {
                          id_logger: logger.deviceIdentifier,
                          mode: selectedMode,
                      });

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
            setCalibrationError(t('mode_profile.calibration_required'));
            return;
        }

        setCalibrationSending(true);
        setCalibrationError('');
        try {
            const calibrationParams = {
                source: nextStep.source,
                ...Object.fromEntries(
                    nextStep.fields.map((field) => [
                        field.key,
                        Number(calibrationValues[field.key]),
                    ]),
                ),
            };
            const data =
                transportMode === 'serial' && commandTransport
                    ? await commandTransport(nextStep.mode, {
                          [nextStep.mode]: {
                              cmd: 'SET',
                              ...calibrationParams,
                          },
                      }).then(async (result) => {
                          if (result.success) {
                              return postJson<ApiResponse>(
                                  '/api/serial/calibration/import',
                                  {
                                      id_logger: logger.deviceIdentifier,
                                      params: calibrationParams,
                                      response: result.data ?? null,
                                  },
                              );
                          }
                          return result;
                      })
                    : await postJson<ApiResponse>('/api/mqtt/calibration/set', {
                          id_logger: logger.deviceIdentifier,
                          ...calibrationParams,
                      });

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
    const selectionUnavailable = disabled || busy;
    const commandUnavailable =
        disabled ||
        !logger.deviceIdentifier ||
        logger.status === 'offline' ||
        busy;
    const inline = variant === 'inline';
    const hasSensorStep =
        guided && Boolean(profile?.enabled) && (profile?.roles.length ?? 0) > 0;
    const showModeStep = !inline || inlineStep === 'mode';
    const showSensorStep = !inline || inlineStep === 'sensor';
    const shouldShowProfileControls =
        guided && profile && (showSensorStep || !profile.enabled);
    const shouldShowPreviewButton = guided && hasSensorStep && showSensorStep;
    const shouldShowDirectButton =
        !guided ||
        (guided &&
            Boolean(profile?.enabled) &&
            (profile?.roles.length ?? 0) === 0);
    const setupSteps = guided
        ? [
              t('mode_profile.step_mode'),
              t('mode_profile.step_sensor'),
              t('mode_profile.step_preview'),
              t('mode_profile.step_send'),
              t('mode_profile.step_calibration'),
          ]
        : [t('mode_profile.step_mode'), t('mode_profile.step_send')];
    const currentStep = guided
        ? phase === 'success' && nextStep
            ? 4
            : phase === 'applying'
              ? 3
              : preview
                ? 2
                : inline
                  ? inlineStep === 'sensor'
                      ? 1
                      : 0
                  : profile
                    ? 1
                    : 0
        : phase === 'direct' || phase === 'success'
          ? 1
          : 0;

    return (
        <>
            <Card
                className={
                    inline ? 'border-0 bg-transparent shadow-none' : undefined
                }
            >
                {!inline && (
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Radio className="size-5" />{' '}
                            {t('mode_profile.title')}
                        </CardTitle>
                        <CardDescription>
                            {activeModeInfo ? (
                                <>
                                    {t('mode_profile.active_mode')}:{' '}
                                    <strong>{activeModeInfo.label}</strong>
                                </>
                            ) : (
                                t('mode_profile.no_active_mode')
                            )}
                        </CardDescription>
                    </CardHeader>
                )}
                <CardContent className={inline ? 'space-y-4 p-0' : 'space-y-4'}>
                    {inline && (
                        <div
                            className={`grid gap-1.5 rounded-xl border bg-card/70 p-2 shadow-sm ${
                                setupSteps.length === 5
                                    ? 'grid-cols-5'
                                    : 'grid-cols-2'
                            }`}
                        >
                            {setupSteps.map((step, index) => (
                                <div
                                    key={step}
                                    className={`rounded-lg border px-2 py-1.5 text-center text-[10px] font-medium transition-colors ${
                                        index < currentStep
                                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                            : index === currentStep
                                              ? 'border-primary/30 bg-primary/15 text-primary'
                                              : 'border-transparent bg-muted/40 text-muted-foreground'
                                    }`}
                                >
                                    {index + 1}. {step}
                                </div>
                            ))}
                        </div>
                    )}

                    {activeModeInfo && (
                        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
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

                    {showModeStep && (
                        <div className="grid gap-2">
                            <Label htmlFor="mode-profile-select">
                                {t('mode_profile.mode_label')}
                            </Label>
                            {inline ? (
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {allowedModes.map((mode) => {
                                        const selected =
                                            selectedMode === mode.slug;
                                        return (
                                            <button
                                                key={mode.slug}
                                                type="button"
                                                disabled={selectionUnavailable}
                                                onClick={() =>
                                                    setSelectedMode(mode.slug)
                                                }
                                                className={`rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                                                    selected
                                                        ? 'border-primary/50 bg-primary/10 text-primary shadow-sm'
                                                        : 'border-border bg-card/70 hover:border-primary/30 hover:bg-primary/5'
                                                }`}
                                            >
                                                <span className="flex items-center justify-between gap-2">
                                                    <span className="truncate text-sm font-medium">
                                                        {mode.label}
                                                    </span>
                                                    {selected && (
                                                        <CheckCircle2 className="size-4 shrink-0" />
                                                    )}
                                                </span>
                                                <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                                                    {mode.slug}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <Select
                                    value={selectedMode}
                                    onValueChange={setSelectedMode}
                                    disabled={selectionUnavailable}
                                >
                                    <SelectTrigger id="mode-profile-select">
                                        <SelectValue
                                            placeholder={t(
                                                'mode_profile.mode_placeholder',
                                            )}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {groupedModes.map(([group, modes]) => (
                                            <SelectGroup key={group}>
                                                <SelectLabel>
                                                    {group}
                                                </SelectLabel>
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
                            )}
                        </div>
                    )}

                    {phase === 'loading' && (
                        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />{' '}
                            {t('mode_profile.loading_templates')}
                        </div>
                    )}

                    {inline &&
                        inlineStep === 'sensor' &&
                        selectedModeInfo &&
                        profile && (
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/70 p-3 shadow-sm">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold">
                                        {t('mode_profile.choose_sensor_title')}
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {t(
                                            'mode_profile.choose_sensor_description',
                                            { mode: selectedModeInfo.label },
                                        )}
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-8 rounded-lg"
                                    disabled={selectionUnavailable}
                                    onClick={() => setInlineStep('mode')}
                                >
                                    {t('mode_profile.change_mode')}
                                </Button>
                            </div>
                        )}

                    {shouldShowProfileControls && (
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

                            {showSensorStep &&
                                profile.enabled &&
                                profile.roles.map((role) => {
                                    const template = role.templates.find(
                                        (candidate) =>
                                            candidate.id ===
                                            templateIds[role.role],
                                    );
                                    return (
                                        <div
                                            key={role.role}
                                            className={
                                                inline
                                                    ? 'space-y-3 rounded-xl border bg-card/70 p-3 shadow-sm'
                                                    : 'space-y-3 border-t pt-4'
                                            }
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
                                                    disabled={
                                                        selectionUnavailable
                                                    }
                                                >
                                                    <SelectTrigger
                                                        id={`profile-template-${role.role}`}
                                                    >
                                                        <SelectValue
                                                            placeholder={t(
                                                                'mode_profile.template_placeholder',
                                                                {
                                                                    label: role.label.toLowerCase(),
                                                                },
                                                            )}
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
                                                                selectionUnavailable
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
                        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                            <XCircle className="mt-0.5 size-4 shrink-0" />{' '}
                            {message}
                        </div>
                    )}

                    {phase === 'success' && message && (
                        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />{' '}
                            {message}
                        </div>
                    )}

                    {!disabled &&
                        selectedMode &&
                        logger.status === 'offline' && (
                            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                {t('mode_profile.offline_notice')}
                            </div>
                        )}

                    {shouldShowPreviewButton ? (
                        <Button
                            className="h-10 w-full gap-2 rounded-xl"
                            disabled={
                                commandUnavailable ||
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
                            {t('mode_profile.preview_button', {
                                mode: selectedMode,
                            })}
                        </Button>
                    ) : shouldShowDirectButton ? (
                        <Button
                            className="h-10 w-full gap-2 rounded-xl"
                            disabled={commandUnavailable || !directModeChanged}
                            onClick={setDirectMode}
                        >
                            {phase === 'direct' ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <Radio className="size-4" />
                            )}
                            {directModeChanged
                                ? t('mode_profile.apply_mode_button', {
                                      mode:
                                          selectedModeInfo?.label ||
                                          selectedMode,
                                  })
                                : t('mode_profile.choose_new_mode')}
                        </Button>
                    ) : null}
                </CardContent>
            </Card>

            <Dialog
                open={preview !== null}
                onOpenChange={(open) => {
                    if (!open && phase !== 'applying') setPreview(null);
                }}
            >
                <DialogContent className="max-h-[90vh] overflow-hidden border bg-card p-0 shadow-2xl sm:max-w-3xl">
                    <DialogHeader className="border-b bg-muted/30 px-6 pt-6 pb-4">
                        <DialogTitle>
                            {t('mode_profile.preview_title', {
                                mode: preview?.mode,
                            })}
                        </DialogTitle>
                        <DialogDescription>
                            {t('mode_profile.preview_description')}
                        </DialogDescription>
                    </DialogHeader>

                    {preview && (
                        <div className="max-h-[65vh] space-y-4 overflow-y-auto bg-background/40 px-6 py-5">
                            <div className="rounded-xl border bg-muted/20 p-3">
                                <p className="text-sm font-semibold">
                                    {t('mode_profile.impact_title')}
                                </p>
                                <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                                    <li>
                                        {t('mode_profile.impact_mode')}{' '}
                                        <strong className="text-foreground">
                                            {preview.changes.mode.to}
                                        </strong>
                                    </li>
                                    {preview.changes.sensors.map((sensor) => (
                                        <li
                                            key={`${sensor.role}-impact-${sensor.slave_id}`}
                                        >
                                            Sensor{' '}
                                            <strong className="text-foreground">
                                                {sensor.template}
                                            </strong>{' '}
                                            {t('mode_profile.impact_sensor')}{' '}
                                            <strong className="text-foreground">
                                                {sensor.slave_id}
                                            </strong>{' '}
                                            {t(
                                                'mode_profile.impact_parameter_count',
                                                {
                                                    count: sensor.parameters
                                                        .length,
                                                },
                                            )}
                                        </li>
                                    ))}
                                    <li>
                                        {t('mode_profile.impact_mapping', {
                                            count: preview.changes.mapping
                                                .length,
                                        })}
                                    </li>
                                    {preview.changes.calibration && (
                                        <li>
                                            {t(
                                                'mode_profile.impact_calibration',
                                            )}{' '}
                                            <strong className="text-foreground">
                                                {
                                                    preview.changes.calibration
                                                        .source
                                                }
                                            </strong>
                                        </li>
                                    )}
                                </ul>
                            </div>

                            {preview.warnings.map((warning) => (
                                <div
                                    key={`${warning.type}-${warning.message}`}
                                    className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3"
                                >
                                    <div className="flex items-start gap-2">
                                        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                                                {t(
                                                    'mode_profile.slave_conflict_title',
                                                )}
                                            </p>
                                            <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
                                                {warning.message}
                                            </p>
                                            <p className="mt-1 text-xs font-medium text-amber-900 dark:text-amber-200">
                                                {t(
                                                    'mode_profile.slave_conflict_action',
                                                )}
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
                                <div className="rounded-xl border bg-card/70 p-3">
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase">
                                        Mode
                                    </p>
                                    <div className="mt-2 flex items-center gap-2 text-sm">
                                        <span>
                                            {preview.changes.mode.from ||
                                                t('mode_profile.not_set')}
                                        </span>
                                        <ArrowRight className="size-4 text-muted-foreground" />
                                        <strong>
                                            {preview.changes.mode.to}
                                        </strong>
                                    </div>
                                </div>
                                <div className="rounded-xl border bg-card/70 p-3">
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase">
                                        {t('mode_profile.mapping_data')}
                                    </p>
                                    <p className="mt-2 text-sm">
                                        {t('mode_profile.mapping_slot_count', {
                                            count: preview.changes.mapping
                                                .length,
                                        })}
                                    </p>
                                </div>
                            </div>

                            {preview.changes.sensors.map((sensor) => (
                                <div
                                    key={`${sensor.role}-${sensor.slave_id}`}
                                    className="space-y-3 rounded-xl border bg-card/70 p-3"
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

                                    <details className="group rounded-lg border bg-muted/20 p-3">
                                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground transition-colors group-open:text-foreground">
                                            Lihat detail teknis
                                        </summary>
                                        <div className="mt-3 space-y-3">
                                            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-5">
                                                <div>
                                                    <dt className="text-muted-foreground">
                                                        Function
                                                    </dt>
                                                    <dd className="font-mono">
                                                        0
                                                        {
                                                            sensor.device
                                                                .function_code
                                                        }
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
                                                        {
                                                            sensor.device
                                                                .serial_format
                                                        }
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt className="text-muted-foreground">
                                                        Alamat awal
                                                    </dt>
                                                    <dd className="font-mono">
                                                        {
                                                            sensor.device
                                                                .register_address
                                                        }
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt className="text-muted-foreground">
                                                        Interface
                                                    </dt>
                                                    <dd className="font-mono">
                                                        RS485
                                                    </dd>
                                                </div>
                                            </dl>

                                            <div className="overflow-x-auto">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>
                                                                Parameter
                                                            </TableHead>
                                                            <TableHead>
                                                                Unit
                                                            </TableHead>
                                                            <TableHead>
                                                                Scale
                                                            </TableHead>
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
                                                                    key={
                                                                        parameter.name
                                                                    }
                                                                >
                                                                    <TableCell className="font-mono text-xs">
                                                                        {
                                                                            parameter.name
                                                                        }
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        {
                                                                            parameter.unit
                                                                        }
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
                                    </details>
                                </div>
                            ))}

                            <div className="rounded-xl border bg-card/70 p-3">
                                <p className="mb-2 text-[10px] font-semibold text-muted-foreground uppercase">
                                    {t('mode_profile.mapping_order')}
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
                                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                                    <XCircle className="mt-0.5 size-4 shrink-0" />{' '}
                                    {message}
                                </div>
                            )}

                            {phase === 'applying' && (
                                <div className="rounded-xl border bg-primary/5 p-3">
                                    <div className="flex items-center gap-2 text-sm font-medium">
                                        <Loader2 className="size-4 animate-spin" />
                                        {t('mode_profile.sending_config')}
                                    </div>
                                    <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
                                        <li>1. SET Mode Profile</li>
                                        <li>2. SET Sensor RS485</li>
                                        <li>3. SET Mapping Data</li>
                                        {preview.changes.calibration && (
                                            <li>
                                                4.{' '}
                                                {t(
                                                    'mode_profile.prepare_calibration',
                                                )}
                                            </li>
                                        )}
                                    </ol>
                                </div>
                            )}
                        </div>
                    )}

                    <DialogFooter className="border-t bg-card px-6 py-4">
                        <Button
                            variant="outline"
                            className="rounded-xl"
                            onClick={() => setPreview(null)}
                            disabled={phase === 'applying'}
                        >
                            {t('common.cancel')}
                        </Button>
                        <Button
                            className="gap-2 rounded-xl"
                            onClick={applyProfile}
                            disabled={phase === 'applying'}
                        >
                            {phase === 'applying' ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <Settings2 className="size-4" />
                            )}
                            {preview?.requires_confirmation
                                ? t('mode_profile.replace_old_sensor')
                                : t('mode_profile.apply_profile')}
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
                        <DialogTitle>
                            {t('mode_profile.calibration_title')}
                        </DialogTitle>
                        <DialogDescription>
                            {t('mode_profile.calibration_description')}
                        </DialogDescription>
                    </DialogHeader>

                    {nextStep && (
                        <div className="space-y-4">
                            <div className="grid gap-1.5">
                                <Label htmlFor="mode-profile-calibration-source">
                                    {t('mode_profile.data_source')}
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
