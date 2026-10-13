import { Link, router, useForm } from '@inertiajs/react';
import {
    Boxes,
    Check,
    CheckCircle2,
    ChevronDown,
    Cpu,
    Download,
    FileUp,
    Loader2,
    Pencil,
    Plus,
    Search,
    Trash2,
    Usb,
    XCircle,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
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
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { SecuritySetupDialog } from './security-setup-dialog';

type QcStatus = 'pending' | 'passed' | 'failed';

export interface ProductionModule {
    key: string;
    // security = Security System (an MQTT device); ews / gcm = production record only.
    kind: 'security' | 'ews' | 'gcm';
    // production_modules id, EWS / GCM only.
    id: number | null;
    // MQTT ID (sub_/pub_<ID>), Security System only; usually equal to the serial number.
    deviceId: string | null;
    serialNumber: string;
    name: string | null;
    model: string | null;
    hardwareVersion: string | null;
    productionDate: string | null;
    testedBy: string | null;
    // Production QC, recorded on the website only (like a logger's QC).
    qcStatus: QcStatus;
    notes: string | null;
    // Security System only.
    online: boolean | null;
    lastSeenAt: string | null;
    // "Registered" for a module means installed on a logger.
    logger: { id: string; name: string; serialNumber: string } | null;
}

// Module kinds with a registry so far.
const MODULE_MODELS = ['Security System', 'EWS', 'GCM'];
const SECURITY_MODEL = 'Security System';

// EWS / GCM talk through their logger, so they are production records only.
function moduleUrl(m: ProductionModule): string {
    return m.kind === 'security'
        ? `/production/security-devices/${m.deviceId}`
        : `/production/modules/${m.id}`;
}

// Same look as the logger list's QC badge.
function QcBadge({ status }: { status: QcStatus }) {
    if (status === 'passed') return <Badge variant="default">Passed</Badge>;
    if (status === 'failed') return <Badge variant="destructive">Failed</Badge>;
    return <Badge variant="secondary">Pending</Badge>;
}

function QcSelect({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="passed">Passed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
        </Select>
    );
}

function ModelSelect({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger>
                <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
                {MODULE_MODELS.map((m) => (
                    <SelectItem key={m} value={m}>
                        {m}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function FieldError({ message }: { message?: string }) {
    return message ? <p className="text-xs text-red-500">{message}</p> : null;
}

// "Add Device" offers both kinds of hardware made in production.
export function AddDeviceMenu({
    onLogger,
    onModule,
}: {
    onLogger: () => void;
    onModule: () => void;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button className="gap-1.5">
                    <Plus className="size-4" />
                    Add Device
                    <ChevronDown className="size-4 opacity-70" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onLogger} className="gap-2">
                    <Cpu className="size-4" />
                    Logger
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onModule} className="gap-2">
                    <Boxes className="size-4" />
                    Modul
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function AddModuleDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const form = useForm({
        serial_number: '',
        device_id: '',
        model: 'Security System',
        qc_status: 'pending',
        hardware_version: '',
        production_date: '',
        tested_by: '',
        notes: '',
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        const security = form.data.model === SECURITY_MODEL;
        form.transform((data) =>
            security
                ? data
                : { ...data, type: data.model.toLowerCase(), device_id: '' },
        );
        form.post(
            security ? '/production/security-devices' : '/production/modules',
            {
                preserveScroll: true,
                onSuccess: () => {
                    form.reset();
                    onOpenChange(false);
                },
            },
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Register Production Module</DialogTitle>
                    <DialogDescription>
                        Enter module details from the production line.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={submit} className="grid gap-4 py-2">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label htmlFor="module_serial">
                                Serial Number *
                            </Label>
                            <Input
                                id="module_serial"
                                value={form.data.serial_number}
                                onChange={(e) =>
                                    form.setData(
                                        'serial_number',
                                        e.target.value,
                                    )
                                }
                                placeholder="e.g. SS0002"
                                className="font-mono"
                            />
                            <FieldError message={form.errors.serial_number} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="module_device_id">Device ID</Label>
                            <Input
                                id="module_device_id"
                                value={
                                    form.data.model === SECURITY_MODEL
                                        ? form.data.device_id
                                        : ''
                                }
                                onChange={(e) =>
                                    form.setData('device_id', e.target.value)
                                }
                                placeholder={
                                    form.data.model === SECURITY_MODEL
                                        ? 'Sama dengan serial number'
                                        : 'Tidak dipakai (lewat logger)'
                                }
                                disabled={form.data.model !== SECURITY_MODEL}
                                maxLength={31}
                                className="font-mono"
                            />
                            <FieldError message={form.errors.device_id} />
                        </div>
                        <div className="grid gap-2">
                            <Label>Model</Label>
                            <ModelSelect
                                value={form.data.model}
                                onChange={(v) => form.setData('model', v)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>QC Status *</Label>
                            <QcSelect
                                value={form.data.qc_status}
                                onChange={(v) => form.setData('qc_status', v)}
                            />
                            <FieldError message={form.errors.qc_status} />
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="module_hw">Hardware Version</Label>
                        <Input
                            id="module_hw"
                            value={form.data.hardware_version}
                            onChange={(e) =>
                                form.setData('hardware_version', e.target.value)
                            }
                            placeholder="e.g. v1.0"
                        />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label htmlFor="module_date">Production Date</Label>
                            <Input
                                id="module_date"
                                type="date"
                                value={form.data.production_date}
                                onChange={(e) =>
                                    form.setData(
                                        'production_date',
                                        e.target.value,
                                    )
                                }
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="module_tested_by">Tested By</Label>
                            <Input
                                id="module_tested_by"
                                value={form.data.tested_by}
                                onChange={(e) =>
                                    form.setData('tested_by', e.target.value)
                                }
                                placeholder="e.g. QC Team A"
                            />
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="module_notes">Notes</Label>
                        <Textarea
                            id="module_notes"
                            value={form.data.notes}
                            onChange={(e) =>
                                form.setData('notes', e.target.value)
                            }
                            placeholder="Optional notes about the module…"
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={
                                form.processing ||
                                form.data.serial_number.trim() === ''
                            }
                        >
                            {form.processing
                                ? 'Registering…'
                                : 'Register Module'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// Same rule as the logger: a production record is final once QC is not pending.
function EditModuleDialog({
    target,
    onClose,
}: {
    target: ProductionModule | null;
    onClose: () => void;
}) {
    const form = useForm({
        serial_number: target?.serialNumber ?? '',
        model: target?.model ?? 'Security System',
        hardware_version: target?.hardwareVersion ?? '',
        tested_by: target?.testedBy ?? '',
        qc_status: target?.qcStatus ?? 'pending',
        notes: target?.notes ?? '',
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        if (!target) return;
        form.put(moduleUrl(target), {
            preserveScroll: true,
            onSuccess: onClose,
        });
    }

    return (
        <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Edit Production Module</DialogTitle>
                    <DialogDescription>
                        {target?.kind === 'security' ? (
                            <>
                                Device ID{' '}
                                <span className="font-mono">
                                    {target.deviceId}
                                </span>{' '}
                                (alamat MQTT) tidak bisa diubah.
                            </>
                        ) : (
                            'Model modul tidak bisa diubah.'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={submit} className="grid gap-4 py-2">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label htmlFor="edit_module_serial">
                                Serial Number *
                            </Label>
                            <Input
                                id="edit_module_serial"
                                value={form.data.serial_number}
                                onChange={(e) =>
                                    form.setData(
                                        'serial_number',
                                        e.target.value,
                                    )
                                }
                                className="font-mono"
                            />
                            <FieldError message={form.errors.serial_number} />
                        </div>
                        <div className="grid gap-2">
                            <Label>Model</Label>
                            {/* A module stays its kind: the kinds live in different tables. */}
                            <Input value={form.data.model} disabled />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="edit_module_hw">
                                Hardware Version
                            </Label>
                            <Input
                                id="edit_module_hw"
                                value={form.data.hardware_version}
                                onChange={(e) =>
                                    form.setData(
                                        'hardware_version',
                                        e.target.value,
                                    )
                                }
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>QC Status *</Label>
                            <QcSelect
                                value={form.data.qc_status}
                                onChange={(v) =>
                                    form.setData('qc_status', v as QcStatus)
                                }
                            />
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="edit_module_tested_by">Tested By</Label>
                        <Input
                            id="edit_module_tested_by"
                            value={form.data.tested_by}
                            onChange={(e) =>
                                form.setData('tested_by', e.target.value)
                            }
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="edit_module_notes">Notes</Label>
                        <Textarea
                            id="edit_module_notes"
                            value={form.data.notes}
                            onChange={(e) =>
                                form.setData('notes', e.target.value)
                            }
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={form.processing}>
                            {form.processing ? 'Saving…' : 'Save Changes'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export interface ModuleFirmware {
    model: string;
    version: string;
    fileName: string;
    fileUrl: string;
    fileSize: number | null;
    uploadedAt: string | null;
}

function ImportModulesDialog() {
    const [open, setOpen] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const form = useForm<{ csv_file: File | null }>({ csv_file: null });

    function submit(e: FormEvent) {
        e.preventDefault();
        form.post('/production/security-devices/import', {
            forceFormData: true,
            preserveScroll: true,
            onSuccess: () => {
                form.reset();
                if (fileInput.current) fileInput.current.value = '';
                setOpen(false);
            },
        });
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-1.5">
                    <FileUp className="size-4" />
                    Import CSV
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Import Modules from CSV</DialogTitle>
                    <DialogDescription>
                        Upload a CSV file with columns: serial_number,
                        device_id, model, hardware_version, production_date,
                        tested_by, qc_status, notes. Empty device_id = serial
                        number.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={submit} className="grid gap-4 py-2">
                    <div className="grid gap-2">
                        <Label htmlFor="module_csv_file">CSV File *</Label>
                        <Input
                            id="module_csv_file"
                            type="file"
                            accept=".csv,.txt"
                            ref={fileInput}
                            onChange={(e) =>
                                form.setData(
                                    'csv_file',
                                    e.target.files?.[0] ?? null,
                                )
                            }
                        />
                        <FieldError message={form.errors.csv_file} />
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={form.processing || !form.data.csv_file}
                        >
                            {form.processing ? 'Importing…' : 'Import'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

const SUMMARY: {
    key: QcStatus;
    label: string;
    icon: typeof CheckCircle2;
    iconBox: string;
    iconColor: string;
    text: string;
    active: string;
}[] = [
    {
        key: 'passed',
        label: 'QC Passed',
        icon: CheckCircle2,
        iconBox: 'bg-emerald-500/10',
        iconColor: 'text-emerald-500',
        text: 'text-emerald-600',
        active: 'border-emerald-500 bg-emerald-500/5',
    },
    {
        key: 'pending',
        label: 'Pending QC',
        icon: Loader2,
        iconBox: 'bg-amber-500/10',
        iconColor: 'text-amber-500',
        text: 'text-amber-600',
        active: 'border-amber-500 bg-amber-500/5',
    },
    {
        key: 'failed',
        label: 'QC Failed',
        icon: XCircle,
        iconBox: 'bg-red-500/10',
        iconColor: 'text-red-500',
        text: 'text-red-600',
        active: 'border-red-500 bg-red-500/5',
    },
];

export function ProductionModules({
    modules,
    firmwares,
    addOpen,
    onAddOpenChange,
    onAddLogger,
}: {
    modules: ProductionModule[];
    // Latest firmware per module model, keyed by model name.
    firmwares: Record<string, ModuleFirmware>;
    addOpen: boolean;
    onAddOpenChange: (open: boolean) => void;
    onAddLogger: () => void;
}) {
    const [search, setSearch] = useState('');
    const [qcFilter, setQcFilter] = useState<QcStatus | 'all'>('all');
    const [editTarget, setEditTarget] = useState<ProductionModule | null>(null);
    // Security System unit being set up over USB / Bluetooth.
    const [setupTarget, setSetupTarget] = useState<ProductionModule | null>(
        null,
    );
    const [deleteTarget, setDeleteTarget] = useState<ProductionModule | null>(
        null,
    );

    const term = search.trim().toLowerCase();
    const filtered = modules.filter(
        (m) =>
            (qcFilter === 'all' || m.qcStatus === qcFilter) &&
            (term === '' ||
                [m.serialNumber, m.deviceId, m.model ?? '', m.name ?? '']
                    .join(' ')
                    .toLowerCase()
                    .includes(term)),
    );
    const registered = modules.filter((m) => m.logger !== null).length;
    const count = (status: QcStatus) =>
        modules.filter((m) => m.qcStatus === status).length;

    return (
        <>
            {/* Summary Cards */}
            <div className="grid gap-3 sm:grid-cols-4">
                <div className="flex items-center gap-3 rounded-xl border p-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                        <Boxes className="size-5 text-blue-500" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold">{modules.length}</p>
                        <p className="text-xs text-muted-foreground">
                            Total Devices
                        </p>
                    </div>
                </div>
                {SUMMARY.map((s) => (
                    <button
                        key={s.key}
                        type="button"
                        onClick={() =>
                            setQcFilter(qcFilter === s.key ? 'all' : s.key)
                        }
                        className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-accent ${qcFilter === s.key ? s.active : ''}`}
                    >
                        <div
                            className={`flex h-10 w-10 items-center justify-center rounded-lg ${s.iconBox}`}
                        >
                            <s.icon className={`size-5 ${s.iconColor}`} />
                        </div>
                        <div>
                            <p className={`text-2xl font-bold ${s.text}`}>
                                {count(s.key)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {s.label}
                            </p>
                        </div>
                    </button>
                ))}
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <Boxes className="size-5" />
                                Production Modules
                            </CardTitle>
                            <CardDescription>
                                {filtered.length} of {modules.length} modules ·{' '}
                                {registered} registered
                            </CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <div className="relative">
                                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    placeholder="Search serial, model…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="w-full pl-9 sm:w-[240px]"
                                />
                            </div>
                            <Select
                                value={qcFilter}
                                onValueChange={(v) =>
                                    setQcFilter(v as QcStatus | 'all')
                                }
                            >
                                <SelectTrigger className="w-[130px]">
                                    <SelectValue placeholder="QC Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">
                                        All Status
                                    </SelectItem>
                                    <SelectItem value="passed">
                                        Passed
                                    </SelectItem>
                                    <SelectItem value="pending">
                                        Pending
                                    </SelectItem>
                                    <SelectItem value="failed">
                                        Failed
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <ImportModulesDialog />
                            <AddDeviceMenu
                                onLogger={onAddLogger}
                                onModule={() => onAddOpenChange(true)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <Separator />
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Serial Number</TableHead>
                                <TableHead className="hidden md:table-cell">
                                    Device ID
                                </TableHead>
                                <TableHead className="hidden lg:table-cell">
                                    Model
                                </TableHead>
                                <TableHead>Firmware</TableHead>
                                <TableHead>QC Status</TableHead>
                                <TableHead>Registered</TableHead>
                                <TableHead className="hidden md:table-cell">
                                    Production Date
                                </TableHead>
                                <TableHead className="w-[120px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map((m) => (
                                <TableRow key={m.key}>
                                    <TableCell className="font-mono text-sm font-medium">
                                        {m.kind === 'security' ? (
                                            <span className="flex items-center gap-2">
                                                <span
                                                    className={`size-2 shrink-0 rounded-full ${m.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
                                                    title={
                                                        m.online
                                                            ? 'Online'
                                                            : 'Offline'
                                                    }
                                                />
                                                <Link
                                                    href={`/production/security-devices/${m.deviceId}`}
                                                    className="hover:underline"
                                                >
                                                    {m.serialNumber}
                                                </Link>
                                            </span>
                                        ) : (
                                            m.serialNumber
                                        )}
                                    </TableCell>
                                    <TableCell className="hidden font-mono text-sm text-muted-foreground md:table-cell">
                                        {m.deviceId ?? '—'}
                                    </TableCell>
                                    <TableCell className="hidden text-sm lg:table-cell">
                                        {m.model || '—'}
                                    </TableCell>
                                    <TableCell>
                                        {/* Same as a logger row: the model's latest firmware. */}
                                        <div className="flex flex-col gap-1">
                                            <span className="font-mono text-xs">
                                                {(m.model &&
                                                    firmwares[m.model]
                                                        ?.version) ||
                                                    '—'}
                                            </span>
                                            {m.model && firmwares[m.model] ? (
                                                <span className="max-w-[170px] truncate text-xs text-muted-foreground">
                                                    {
                                                        firmwares[m.model]
                                                            .fileName
                                                    }
                                                </span>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">
                                                    No OTA file
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <QcBadge status={m.qcStatus} />
                                    </TableCell>
                                    <TableCell>
                                        {m.logger ? (
                                            <div className="flex flex-col gap-1">
                                                <Badge
                                                    variant="default"
                                                    className="gap-1"
                                                >
                                                    <Check className="size-3" />{' '}
                                                    Yes
                                                </Badge>
                                                <Link
                                                    href={`/loggers/${m.logger.id}`}
                                                    className="max-w-[160px] truncate text-xs text-muted-foreground hover:underline"
                                                >
                                                    {m.logger.name}
                                                </Link>
                                            </div>
                                        ) : m.kind === 'security' ? (
                                            <Badge variant="secondary">
                                                No
                                            </Badge>
                                        ) : (
                                            <span className="text-muted-foreground">
                                                —
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                                        {m.productionDate || '—'}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center justify-end gap-1">
                                            {m.model && firmwares[m.model] && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    asChild
                                                >
                                                    <a
                                                        href={
                                                            firmwares[m.model]
                                                                .fileUrl
                                                        }
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        aria-label={`Download firmware ${m.serialNumber}`}
                                                    >
                                                        <Download className="size-4" />
                                                    </a>
                                                </Button>
                                            )}
                                            {m.kind === 'security' && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    onClick={() =>
                                                        setSetupTarget(m)
                                                    }
                                                    aria-label={`Setup ${m.serialNumber} lewat USB atau Bluetooth`}
                                                    title="Setup alat (USB / Bluetooth)"
                                                >
                                                    <Usb className="size-4" />
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() => setEditTarget(m)}
                                                disabled={
                                                    m.qcStatus !== 'pending'
                                                }
                                                aria-label={`Edit ${m.serialNumber}`}
                                            >
                                                <Pencil className="size-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                className="text-red-500 hover:bg-red-500/10 hover:text-red-600"
                                                onClick={() =>
                                                    setDeleteTarget(m)
                                                }
                                                disabled={m.logger !== null}
                                                aria-label={`Delete ${m.serialNumber}`}
                                            >
                                                <Trash2 className="size-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {filtered.length === 0 && (
                                <TableRow>
                                    <TableCell
                                        colSpan={8}
                                        className="py-12 text-center text-muted-foreground"
                                    >
                                        {modules.length === 0
                                            ? 'No modules registered yet.'
                                            : 'No modules match the filter.'}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <AddModuleDialog open={addOpen} onOpenChange={onAddOpenChange} />
            <SecuritySetupDialog
                deviceId={setupTarget?.deviceId ?? null}
                serialNumber={setupTarget?.serialNumber ?? ''}
                onClose={() => setSetupTarget(null)}
            />
            {/* Keyed so the form starts from the chosen module each time. */}
            <EditModuleDialog
                key={editTarget?.key ?? 'none'}
                target={editTarget}
                onClose={() => setEditTarget(null)}
            />

            <AlertDialog
                open={deleteTarget !== null}
                onOpenChange={(o) => !o && setDeleteTarget(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Delete module {deleteTarget?.serialNumber}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteTarget?.kind === 'security'
                                ? 'Catatan produksi, riwayat kejadian, foto, dan nama kartu modul ini ikut terhapus dan tidak bisa dikembalikan.'
                                : 'Catatan produksi modul ini dihapus dan tidak bisa dikembalikan.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-red-600 text-white hover:bg-red-700"
                            onClick={() => {
                                if (!deleteTarget) return;
                                router.delete(moduleUrl(deleteTarget), {
                                    preserveScroll: true,
                                });
                                setDeleteTarget(null);
                            }}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
