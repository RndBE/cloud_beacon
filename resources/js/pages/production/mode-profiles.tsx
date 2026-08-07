import { Head, router, usePage } from '@inertiajs/react';
import {
    ChevronDown,
    ChevronRight,
    Layers,
    Plus,
    Save,
    Trash2,
    TriangleAlert,
    X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shape mirrors ModeProfileCatalog: mode → roles → templates → parameters.
// The wizard reads exactly this, so field names stay snake_case end to end.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
type ConnectionType = 'rs485' | 'rs232' | 'analog' | 'digital';

interface UserInput {
    key: string;
    label: string;
    type: 'number' | 'text';
    min: number | null;
    max: number | null;
    default: string | number | null;
    required: boolean;
}

interface DeviceConfig {
    device_name: string | null;
    function_code: number | null;
    register_address: number | null;
    baudrate: number | null;
    serial_format: string | null;
}

interface Parameter {
    name: string;
    unit: string | null;
    scale_factor: number;
    register_address: number;
    reg_count: number;
    data_type_label: string | null;
    fast_poll: boolean;
}

interface Template {
    id: string;
    name: string;
    description: string | null;
    enabled: boolean;
    disabled_reason: string | null;
    connection_type: ConnectionType;
    user_inputs: UserInput[];
    device: DeviceConfig;
    parameters: Parameter[];
}

interface Role {
    role: string;
    label: string;
    required: boolean;
    templates: Template[];
}

interface ProfileItem {
    id: number;
    mode: string;
    label: string;
    enabled: boolean;
    description: string | null;
    disabledReason: string | null;
    roleCount: number;
    templateCount: number;
    defaultMapping: string[];
    roles: Role[];
    updatedAt: string | null;
}

interface PageProps {
    profiles: ProfileItem[];
    [key: string]: unknown;
}

const BAUDRATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const CONNECTION_TYPES: ConnectionType[] = [
    'rs485',
    'rs232',
    'analog',
    'digital',
];

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Production', href: '/production' },
    { title: 'Mode Profiles', href: '/production/mode-profiles' },
];

function emptyParameter(): Parameter {
    return {
        name: '',
        unit: '',
        scale_factor: 1,
        register_address: 0,
        reg_count: 1,
        data_type_label: 'Unsigned 16-bit',
        fast_poll: false,
    };
}

// Every RS485 template needs the operator to supply a slave ID when the profile is applied, so a new
// template starts with that input already present rather than making it a thing you must remember.
function slaveInput(): UserInput {
    return {
        key: 'slave_id',
        label: 'Slave ID',
        type: 'number',
        min: 1,
        max: 10,
        default: 1,
        required: true,
    };
}

function emptyTemplate(): Template {
    return {
        id: '',
        name: '',
        description: '',
        enabled: true,
        disabled_reason: '',
        connection_type: 'rs485',
        user_inputs: [slaveInput()],
        device: {
            device_name: '',
            function_code: 3,
            register_address: 0,
            baudrate: 9600,
            serial_format: '8N1',
        },
        parameters: [emptyParameter()],
    };
}

function emptyRole(): Role {
    return { role: '', label: '', required: true, templates: [] };
}

function blankProfile(): ProfileItem {
    return {
        id: 0,
        mode: '',
        label: '',
        enabled: false,
        description: '',
        disabledReason: '',
        roleCount: 0,
        templateCount: 0,
        defaultMapping: [],
        roles: [],
        updatedAt: null,
    };
}

const inputClass = 'h-8';
const fieldLabel = 'text-[11px] text-muted-foreground';

// The backend validates these as slugs. Sanitising on the way in beats bouncing the whole form back
// with "roles.0.templates.0.id field format is invalid" — the natural thing to type is the sensor's
// display name ("TB-400-04"), which the rule rejects for its capitals.
//
// Template ids allow hyphens (tb-400-04); role keys allow underscores (water_level) and must start
// with a letter. Kept in step with ModeProfileAdminController::validateProfile().
function toTemplateId(value: string): string {
    return value
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/^-+/, '');
}

function toRoleKey(value: string): string {
    return value
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/^[^a-z]+/, '');
}

// Laravel reports these by path ("roles.0.templates.0.id"), which reads like nothing at all in a
// form this deep. Turn the path into the place the operator is actually looking at.
function describeErrorField(path: string): string {
    const match =
        /^roles\.(\d+)(?:\.templates\.(\d+))?(?:\.(parameters|user_inputs)\.(\d+))?/.exec(
            path,
        );

    if (!match) return path;

    const parts = [`Role ${Number(match[1]) + 1}`];
    if (match[2] !== undefined) parts.push(`Sensor ${Number(match[2]) + 1}`);
    if (match[3] === 'parameters')
        parts.push(`Parameter ${Number(match[4]) + 1}`);
    if (match[3] === 'user_inputs') parts.push(`Input ${Number(match[4]) + 1}`);

    return parts.join(' › ');
}

function Field({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="grid gap-1">
            <Label className={fieldLabel}>{label}</Label>
            {children}
        </div>
    );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Parameter grid — the Modbus registers a template reads.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ParameterRows({
    parameters,
    onChange,
}: {
    parameters: Parameter[];
    onChange: (next: Parameter[]) => void;
}) {
    const patch = (index: number, changes: Partial<Parameter>) =>
        onChange(
            parameters.map((parameter, i) =>
                i === index ? { ...parameter, ...changes } : parameter,
            ),
        );

    return (
        <div className="grid gap-2">
            {parameters.map((parameter, index) => (
                <div
                    key={`parameter-${index}`}
                    className="grid gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-12"
                >
                    <div className="sm:col-span-3">
                        <Field label="Nama">
                            <Input
                                className={inputClass}
                                value={parameter.name}
                                onChange={(e) =>
                                    patch(index, { name: e.target.value })
                                }
                                placeholder="Rain_Day"
                            />
                        </Field>
                    </div>
                    <div className="sm:col-span-2">
                        <Field label="Satuan">
                            <Input
                                className={inputClass}
                                value={parameter.unit ?? ''}
                                onChange={(e) =>
                                    patch(index, { unit: e.target.value })
                                }
                                placeholder="mm"
                            />
                        </Field>
                    </div>
                    <div className="sm:col-span-2">
                        <Field label="Scale">
                            <Input
                                className={inputClass}
                                type="number"
                                step="any"
                                value={parameter.scale_factor}
                                onChange={(e) =>
                                    patch(index, {
                                        scale_factor: Number(e.target.value),
                                    })
                                }
                            />
                        </Field>
                    </div>
                    <div className="sm:col-span-2">
                        <Field label="Register">
                            <Input
                                className={inputClass}
                                type="number"
                                value={parameter.register_address}
                                onChange={(e) =>
                                    patch(index, {
                                        register_address: Number(
                                            e.target.value,
                                        ),
                                    })
                                }
                            />
                        </Field>
                    </div>
                    <div className="sm:col-span-2">
                        <Field label="Reg count">
                            <Input
                                className={inputClass}
                                type="number"
                                min={1}
                                value={parameter.reg_count}
                                onChange={(e) =>
                                    patch(index, {
                                        reg_count: Number(e.target.value),
                                    })
                                }
                            />
                        </Field>
                    </div>
                    <div className="flex items-end justify-between gap-2 sm:col-span-1">
                        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <input
                                type="checkbox"
                                checked={parameter.fast_poll}
                                onChange={(e) =>
                                    patch(index, {
                                        fast_poll: e.target.checked,
                                    })
                                }
                            />
                            Fast
                        </label>
                        <button
                            type="button"
                            aria-label={`Hapus parameter ${index + 1}`}
                            className="text-muted-foreground hover:text-red-500"
                            onClick={() =>
                                onChange(
                                    parameters.filter((_, i) => i !== index),
                                )
                            }
                        >
                            <X className="size-3.5" />
                        </button>
                    </div>
                </div>
            ))}
            <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 w-fit gap-1 text-xs"
                onClick={() => onChange([...parameters, emptyParameter()])}
            >
                <Plus className="size-3" /> Tambah parameter
            </Button>
        </div>
    );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Template editor — one sensor: its slave inputs, device config and registers.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function TemplateEditor({
    template,
    onChange,
    onRemove,
}: {
    template: Template;
    onChange: (next: Template) => void;
    onRemove: () => void;
}) {
    const [open, setOpen] = useState(false);
    // An id that already exists came from the catalogue, so never overwrite it from the name.
    const [idTouched, setIdTouched] = useState(template.id !== '');
    const isRs485 = template.connection_type === 'rs485';

    return (
        <div className="rounded-lg border">
            <div className="flex items-center gap-2 p-2">
                <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setOpen(!open)}
                    aria-label={open ? 'Tutup template' : 'Buka template'}
                >
                    {open ? (
                        <ChevronDown className="size-4" />
                    ) : (
                        <ChevronRight className="size-4" />
                    )}
                </button>
                <span className="text-sm font-medium">
                    {template.name || '(template baru)'}
                </span>
                <Badge variant="outline" className="text-[10px] uppercase">
                    {template.connection_type}
                </Badge>
                {!template.enabled && (
                    <Badge
                        variant="outline"
                        className="border-amber-500/30 text-[10px] text-amber-600 dark:text-amber-400"
                    >
                        nonaktif
                    </Badge>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">
                    {template.parameters.length} parameter
                </span>
                <button
                    type="button"
                    aria-label={`Hapus template ${template.name || 'baru'}`}
                    className="text-muted-foreground hover:text-red-500"
                    onClick={onRemove}
                >
                    <Trash2 className="size-3.5" />
                </button>
            </div>

            {open && (
                <div className="grid gap-3 border-t p-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="ID template">
                            <Input
                                className={inputClass}
                                value={template.id}
                                onChange={(e) => {
                                    setIdTouched(true);
                                    onChange({
                                        ...template,
                                        id: toTemplateId(e.target.value),
                                    });
                                }}
                                placeholder="tb-400-04"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                huruf kecil, angka, tanda hubung
                            </p>
                        </Field>
                        <Field label="Nama">
                            <Input
                                className={inputClass}
                                value={template.name}
                                onChange={(e) => {
                                    const name = e.target.value;
                                    onChange({
                                        ...template,
                                        name,
                                        // Fill the id from the name until the operator edits it
                                        // themselves, so the common case needs no thought.
                                        ...(idTouched
                                            ? {}
                                            : { id: toTemplateId(name) }),
                                    });
                                }}
                                placeholder="TB-400-04"
                            />
                        </Field>
                        <Field label="Koneksi">
                            <select
                                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                                value={template.connection_type}
                                onChange={(e) =>
                                    onChange({
                                        ...template,
                                        connection_type: e.target
                                            .value as ConnectionType,
                                    })
                                }
                            >
                                {CONNECTION_TYPES.map((type) => (
                                    <option key={type} value={type}>
                                        {type.toUpperCase()}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    </div>

                    <Field label="Deskripsi">
                        <Input
                            className={inputClass}
                            value={template.description ?? ''}
                            onChange={(e) =>
                                onChange({
                                    ...template,
                                    description: e.target.value,
                                })
                            }
                        />
                    </Field>

                    <div className="flex flex-wrap items-center gap-4">
                        <label className="flex items-center gap-1.5 text-xs">
                            <input
                                type="checkbox"
                                checked={template.enabled}
                                onChange={(e) =>
                                    onChange({
                                        ...template,
                                        enabled: e.target.checked,
                                    })
                                }
                            />
                            Aktif
                        </label>
                        {!template.enabled && (
                            <div className="min-w-56 flex-1">
                                <Field label="Alasan dinonaktifkan">
                                    <Input
                                        className={inputClass}
                                        value={template.disabled_reason ?? ''}
                                        onChange={(e) =>
                                            onChange({
                                                ...template,
                                                disabled_reason: e.target.value,
                                            })
                                        }
                                        placeholder="Register map belum dikonfirmasi"
                                    />
                                </Field>
                            </div>
                        )}
                    </div>

                    {/* Device config only means something on RS485 — the others have no slave. */}
                    {isRs485 && (
                        <div className="grid gap-3 rounded-md border bg-muted/30 p-2 sm:grid-cols-5">
                            <Field label="Nama device">
                                <Input
                                    className={inputClass}
                                    value={template.device.device_name ?? ''}
                                    onChange={(e) =>
                                        onChange({
                                            ...template,
                                            device: {
                                                ...template.device,
                                                device_name: e.target.value,
                                            },
                                        })
                                    }
                                />
                            </Field>
                            <Field label="Function code">
                                <Input
                                    className={inputClass}
                                    type="number"
                                    min={1}
                                    max={4}
                                    value={template.device.function_code ?? 3}
                                    onChange={(e) =>
                                        onChange({
                                            ...template,
                                            device: {
                                                ...template.device,
                                                function_code: Number(
                                                    e.target.value,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </Field>
                            <Field label="Register awal">
                                <Input
                                    className={inputClass}
                                    type="number"
                                    value={
                                        template.device.register_address ?? 0
                                    }
                                    onChange={(e) =>
                                        onChange({
                                            ...template,
                                            device: {
                                                ...template.device,
                                                register_address: Number(
                                                    e.target.value,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </Field>
                            <Field label="Baudrate">
                                <select
                                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                                    value={template.device.baudrate ?? 9600}
                                    onChange={(e) =>
                                        onChange({
                                            ...template,
                                            device: {
                                                ...template.device,
                                                baudrate: Number(
                                                    e.target.value,
                                                ),
                                            },
                                        })
                                    }
                                >
                                    {BAUDRATES.map((rate) => (
                                        <option key={rate} value={rate}>
                                            {rate}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Format">
                                <Input
                                    className={inputClass}
                                    value={template.device.serial_format ?? ''}
                                    onChange={(e) =>
                                        onChange({
                                            ...template,
                                            device: {
                                                ...template.device,
                                                serial_format: e.target.value,
                                            },
                                        })
                                    }
                                    placeholder="8N1"
                                />
                            </Field>
                        </div>
                    )}

                    <div>
                        <p className="mb-1.5 text-xs font-medium">
                            Parameter / register
                        </p>
                        <ParameterRows
                            parameters={template.parameters}
                            onChange={(parameters) =>
                                onChange({ ...template, parameters })
                            }
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Mode editor
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ModeEditor({
    profile,
    onCancel,
}: {
    profile: ProfileItem;
    onCancel: () => void;
}) {
    const isNew = profile.id === 0;
    const [draft, setDraft] = useState<ProfileItem>(profile);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const patchRole = (index: number, changes: Partial<Role>) =>
        setDraft({
            ...draft,
            roles: draft.roles.map((role, i) =>
                i === index ? { ...role, ...changes } : role,
            ),
        });

    function save() {
        setSaving(true);
        setErrors({});

        // Inertia's RequestPayload wants an index signature on every nested object. The profile tree
        // is deliberately typed instead, so cast once here rather than loosening Role/Template.
        const payload = {
            mode: draft.mode.toUpperCase(),
            label: draft.label,
            description: draft.description ?? '',
            enabled: draft.enabled,
            disabled_reason: draft.disabledReason ?? '',
            default_mapping: draft.defaultMapping,
            roles: draft.roles,
        } as any;

        const options = {
            preserveScroll: true,
            onError: (formErrors: Record<string, string>) => {
                setErrors(formErrors);
                setSaving(false);
            },
            onSuccess: () => {
                setSaving(false);
                onCancel();
            },
            onFinish: () => setSaving(false),
        };

        if (isNew) {
            router.post('/production/mode-profiles', payload, options);
        } else {
            router.put(
                `/production/mode-profiles/${profile.id}`,
                payload,
                options,
            );
        }
    }

    const errorList = Object.entries(errors);

    return (
        <div className="grid gap-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
                <Layers className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">
                    {isNew ? 'Mode baru' : `Edit ${profile.mode}`}
                </h2>
                <div className="ml-auto flex gap-2">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={onCancel}
                    >
                        Batal
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        className="gap-1.5"
                        disabled={saving}
                        onClick={save}
                    >
                        <Save className="size-3.5" />
                        {saving ? 'Menyimpan…' : 'Simpan'}
                    </Button>
                </div>
            </div>

            {errorList.length > 0 && (
                <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                        <TriangleAlert className="size-3.5" /> Periksa isian
                        berikut
                    </p>
                    <ul className="ml-5 list-disc text-[11px] text-red-600 dark:text-red-400">
                        {errorList.map(([key, message]) => {
                            const where = describeErrorField(key);
                            return (
                                <li key={key}>
                                    {where !== key && (
                                        <span className="font-medium">
                                            {where}:{' '}
                                        </span>
                                    )}
                                    {message}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Mode (huruf besar)">
                    <Input
                        className={inputClass}
                        value={draft.mode}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                mode: e.target.value.toUpperCase(),
                            })
                        }
                        placeholder="ARR"
                        disabled={!isNew}
                    />
                </Field>
                <Field label="Label">
                    <Input
                        className={inputClass}
                        value={draft.label}
                        onChange={(e) =>
                            setDraft({ ...draft, label: e.target.value })
                        }
                        placeholder="ARR (Rainfall Recorder)"
                    />
                </Field>
                <div className="flex items-end gap-4">
                    <label className="flex items-center gap-1.5 text-xs">
                        <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    enabled: e.target.checked,
                                })
                            }
                        />
                        Aktif di wizard
                    </label>
                </div>
            </div>

            <Field label="Deskripsi">
                <Input
                    className={inputClass}
                    value={draft.description ?? ''}
                    onChange={(e) =>
                        setDraft({ ...draft, description: e.target.value })
                    }
                />
            </Field>

            {!draft.enabled && (
                <Field label="Alasan dinonaktifkan (tampil ke operator)">
                    <Input
                        className={inputClass}
                        value={draft.disabledReason ?? ''}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                disabledReason: e.target.value,
                            })
                        }
                        placeholder="Template sensor belum lengkap"
                    />
                </Field>
            )}

            <Field label="Default mapping (satu slot per baris, urut sesuai MAP_DATA)">
                <textarea
                    className="min-h-20 rounded-md border border-input bg-background p-2 font-mono text-xs"
                    value={draft.defaultMapping.join('\n')}
                    onChange={(e) =>
                        setDraft({
                            ...draft,
                            defaultMapping: e.target.value
                                .split('\n')
                                .map((line) => line.trim())
                                .filter(Boolean),
                        })
                    }
                    placeholder={'ARR.Rain_Day\nARR.Rain_Hour'}
                />
            </Field>

            {/* Roles → templates. A role is a slot the operator fills at apply time. */}
            <div className="grid gap-3">
                <div className="flex items-center justify-between">
                    <p className="text-xs font-medium">
                        Role sensor ({draft.roles.length})
                    </p>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        onClick={() =>
                            setDraft({
                                ...draft,
                                roles: [...draft.roles, emptyRole()],
                            })
                        }
                    >
                        <Plus className="size-3" /> Tambah role
                    </Button>
                </div>

                {draft.roles.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                        Belum ada role. Mode tanpa role akan ditolak wizard saat
                        dipilih operator.
                    </p>
                )}

                {draft.roles.map((role, roleIndex) => (
                    <div
                        key={`role-${roleIndex}`}
                        className="grid gap-3 rounded-lg border bg-muted/20 p-3"
                    >
                        <div className="grid gap-3 sm:grid-cols-4">
                            <Field label="Key role">
                                <Input
                                    className={inputClass}
                                    value={role.role}
                                    onChange={(e) =>
                                        patchRole(roleIndex, {
                                            role: toRoleKey(e.target.value),
                                        })
                                    }
                                    placeholder="rainfall"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    huruf kecil, angka, garis bawah
                                </p>
                            </Field>
                            <Field label="Label">
                                <Input
                                    className={inputClass}
                                    value={role.label}
                                    onChange={(e) =>
                                        patchRole(roleIndex, {
                                            label: e.target.value,
                                        })
                                    }
                                    placeholder="Sensor Curah Hujan"
                                />
                            </Field>
                            <div className="flex items-end">
                                <label className="flex items-center gap-1.5 text-xs">
                                    <input
                                        type="checkbox"
                                        checked={role.required}
                                        onChange={(e) =>
                                            patchRole(roleIndex, {
                                                required: e.target.checked,
                                            })
                                        }
                                    />
                                    Wajib dipilih
                                </label>
                            </div>
                            <div className="flex items-end justify-end">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 gap-1 text-xs text-muted-foreground hover:text-red-500"
                                    onClick={() =>
                                        setDraft({
                                            ...draft,
                                            roles: draft.roles.filter(
                                                (_, i) => i !== roleIndex,
                                            ),
                                        })
                                    }
                                >
                                    <Trash2 className="size-3" /> Hapus role
                                </Button>
                            </div>
                        </div>

                        <div className="grid gap-2">
                            {role.templates.map((template, templateIndex) => (
                                <TemplateEditor
                                    key={`template-${roleIndex}-${templateIndex}`}
                                    template={template}
                                    onChange={(next) =>
                                        patchRole(roleIndex, {
                                            templates: role.templates.map(
                                                (t, i) =>
                                                    i === templateIndex
                                                        ? next
                                                        : t,
                                            ),
                                        })
                                    }
                                    onRemove={() =>
                                        patchRole(roleIndex, {
                                            templates: role.templates.filter(
                                                (_, i) => i !== templateIndex,
                                            ),
                                        })
                                    }
                                />
                            ))}
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 w-fit gap-1 text-xs"
                                onClick={() =>
                                    patchRole(roleIndex, {
                                        templates: [
                                            ...role.templates,
                                            emptyTemplate(),
                                        ],
                                    })
                                }
                            >
                                <Plus className="size-3" /> Tambah sensor
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function ModeProfilesPage() {
    const { profiles } = usePage<PageProps>().props;
    const [editing, setEditing] = useState<ProfileItem | null>(null);
    const [pendingDelete, setPendingDelete] = useState<ProfileItem | null>(
        null,
    );

    const totals = useMemo(
        () => ({
            enabled: profiles.filter((profile) => profile.enabled).length,
            templates: profiles.reduce(
                (sum, profile) => sum + profile.templateCount,
                0,
            ),
        }),
        [profiles],
    );

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Mode Profiles" />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold">Mode Profiles</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Template sensor dan slave per mode. Dipakai Mode
                            Profile Wizard di halaman logger untuk menulis{' '}
                            <code>SENSORS</code> dan <code>MAP_DATA</code> ke
                            perangkat.
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {profiles.length} mode · {totals.enabled} aktif ·{' '}
                            {totals.templates} template sensor
                        </p>
                    </div>
                    {!editing && (
                        <Button
                            className="gap-1.5"
                            onClick={() => setEditing(blankProfile())}
                        >
                            <Plus className="size-4" /> Mode baru
                        </Button>
                    )}
                </div>

                {editing ? (
                    <ModeEditor
                        key={editing.id}
                        profile={editing}
                        onCancel={() => setEditing(null)}
                    />
                ) : (
                    <div className="grid gap-3">
                        {profiles.length === 0 && (
                            <p className="text-sm text-muted-foreground">
                                Belum ada mode profile.
                            </p>
                        )}
                        {profiles.map((profile) => (
                            <div
                                key={profile.id}
                                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
                            >
                                <div className="min-w-48 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-mono text-sm font-semibold">
                                            {profile.mode}
                                        </span>
                                        <span className="text-sm">
                                            {profile.label}
                                        </span>
                                        {profile.enabled ? (
                                            <Badge
                                                variant="outline"
                                                className="border-emerald-500/30 text-[10px] text-emerald-600 dark:text-emerald-400"
                                            >
                                                aktif
                                            </Badge>
                                        ) : (
                                            <Badge
                                                variant="outline"
                                                className="border-amber-500/30 text-[10px] text-amber-600 dark:text-amber-400"
                                            >
                                                nonaktif
                                            </Badge>
                                        )}
                                    </div>
                                    {profile.description && (
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            {profile.description}
                                        </p>
                                    )}
                                    {!profile.enabled &&
                                        profile.disabledReason && (
                                            <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                                                {profile.disabledReason}
                                            </p>
                                        )}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {profile.roleCount} role ·{' '}
                                    {profile.templateCount} sensor
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setEditing(profile)}
                                    >
                                        Edit
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-muted-foreground hover:text-red-500"
                                        onClick={() =>
                                            setPendingDelete(profile)
                                        }
                                    >
                                        <Trash2 className="size-3.5" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <AlertDialog
                open={pendingDelete !== null}
                onOpenChange={(open) => !open && setPendingDelete(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Hapus mode {pendingDelete?.mode}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Mode ini akan hilang dari Mode Profile Wizard.
                            Logger yang sudah terlanjur diset ke mode ini tidak
                            berubah — hanya template-nya yang tidak bisa dipakai
                            lagi.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700"
                            onClick={() => {
                                if (!pendingDelete) return;
                                router.delete(
                                    `/production/mode-profiles/${pendingDelete.id}`,
                                    { preserveScroll: true },
                                );
                                setPendingDelete(null);
                            }}
                        >
                            Hapus
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </AppLayout>
    );
}
