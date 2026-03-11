import { Head, Link, router, usePage } from '@inertiajs/react';
import {
    Activity,
    AlertTriangle,
    ArrowLeft,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Clock,
    Code2,
    Copy,
    Cpu,
    Database,
    Download,
    Eye,
    EyeOff,
    HardDrive,
    Key,
    Link2,
    MapPin,
    MemoryStick,
    Network,
    Pencil,
    Plug,
    Plus,
    Power,
    Radio,
    RefreshCw,
    RotateCcw,
    Save,
    Settings,
    Signal,
    SlidersHorizontal,
    Terminal,
    Thermometer,
    Trash2,
    Timer,
    Upload,
    Wifi,
    XCircle,
    Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

interface SensorItem {
    id: number;
    name: string;
    type: string;
    value: number;
    unit: string;
    status: 'active' | 'inactive' | 'error';
    lastReading: string;
    min: number;
    max: number;
}

interface LogItem {
    id: number;
    timestamp: string;
    action: string;
    status: 'success' | 'failed' | 'pending';
    level: 'info' | 'warning' | 'error' | 'debug';
    message: string;
}

interface LoggerDetail {
    id: number;
    name: string;
    serialNumber: string;
    location: string;
    status: 'online' | 'offline' | 'warning';
    connectionType: string;
    firmwareVersion: string;
    lastSeen: string;
    ipAddress: string;
    macAddress: string;
    model: string;
    uptime: string;
    cpuUsage: number;
    memoryUsage: number;
    memoryTotal: number;
    storageUsage: number;
    storageTotal: number;
    signalStrength: number;
    dataUsage: string;
    gateway: string;
    dns: string;
    subnet: string;
    logFileCount: number;
    configBackups: number;
    lastConfigBackup: string;
    intervalRead: number;
    intervalSend: number;
    maxReset: number;
    ministesyEnabled: boolean;
    ministesyKey: string | null;
    ministesyInterval: number;
    sensors: SensorItem[];
    activityLogs: LogItem[];
}

interface LoggerShowProps {
    logger: LoggerDetail;
}

// =============================================================================
// Sensor CRUD Panel
// =============================================================================

const SENSOR_TYPES = [
    { value: 'temperature', label: 'Temperature', defaultUnit: '°C' },
    { value: 'humidity', label: 'Humidity', defaultUnit: '%' },
    { value: 'pressure', label: 'Pressure', defaultUnit: 'hPa' },
    { value: 'water-level', label: 'Water Level', defaultUnit: 'm' },
    { value: 'flow-rate', label: 'Flow Rate', defaultUnit: 'm³/s' },
    { value: 'rainfall', label: 'Rainfall', defaultUnit: 'mm' },
    { value: 'voltage', label: 'Voltage', defaultUnit: 'V' },
    { value: 'current', label: 'Current', defaultUnit: 'A' },
] as const;

const EMPTY_FORM = {
    name: '',
    type: 'temperature' as string,
    unit: '°C',
    status: 'active' as string,
    min_value: 0,
    max_value: 100,
};

function SensorCrudPanel({ loggerId, sensors }: { loggerId: number; sensors: SensorItem[] }) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [editingSensor, setEditingSensor] = useState<SensorItem | null>(null);
    const [deletingSensor, setDeletingSensor] = useState<SensorItem | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [processing, setProcessing] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const openCreate = () => {
        setEditingSensor(null);
        setForm(EMPTY_FORM);
        setErrors({});
        setDialogOpen(true);
    };

    const openEdit = (sensor: SensorItem) => {
        setEditingSensor(sensor);
        setForm({
            name: sensor.name,
            type: sensor.type,
            unit: sensor.unit,
            status: sensor.status,
            min_value: sensor.min,
            max_value: sensor.max,
        });
        setErrors({});
        setDialogOpen(true);
    };

    const openDelete = (sensor: SensorItem) => {
        setDeletingSensor(sensor);
        setDeleteDialogOpen(true);
    };

    const handleTypeChange = (type: string) => {
        const found = SENSOR_TYPES.find(t => t.value === type);
        setForm(prev => ({
            ...prev,
            type,
            unit: found?.defaultUnit || prev.unit,
        }));
    };

    const handleSubmit = () => {
        setProcessing(true);
        setErrors({});

        const url = editingSensor
            ? `/loggers/${loggerId}/sensors/${editingSensor.id}`
            : `/loggers/${loggerId}/sensors`;

        const method = editingSensor ? 'put' : 'post';

        router[method](url, form, {
            preserveScroll: true,
            onSuccess: () => {
                setDialogOpen(false);
                setEditingSensor(null);
                setForm(EMPTY_FORM);
            },
            onError: (errs) => setErrors(errs as Record<string, string>),
            onFinish: () => setProcessing(false),
        });
    };

    const handleDelete = () => {
        if (!deletingSensor) return;
        setProcessing(true);
        router.delete(`/loggers/${loggerId}/sensors/${deletingSensor.id}`, {
            preserveScroll: true,
            onSuccess: () => {
                setDeleteDialogOpen(false);
                setDeletingSensor(null);
            },
            onFinish: () => setProcessing(false),
        });
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2"><Thermometer className="size-5" /> Sensor Channels</CardTitle>
                            <CardDescription>{sensors.length} channels configured</CardDescription>
                        </div>
                        <Button size="sm" className="gap-1.5" onClick={openCreate}>
                            <Plus className="size-4" />
                            Add Sensor
                        </Button>
                    </div>
                </CardHeader>
                <Separator />
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Channel</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Value</TableHead>
                                <TableHead>Range</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="hidden md:table-cell">Last Reading</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sensors.map((sensor) => (
                                <TableRow key={sensor.id}>
                                    <TableCell className="font-medium">{sensor.name}</TableCell>
                                    <TableCell className="capitalize text-muted-foreground">{sensor.type.replace('-', ' ')}</TableCell>
                                    <TableCell className="font-mono font-semibold">{sensor.value} <span className="text-xs font-normal text-muted-foreground">{sensor.unit}</span></TableCell>
                                    <TableCell className="font-mono text-xs text-muted-foreground">{sensor.min} – {sensor.max} {sensor.unit}</TableCell>
                                    <TableCell>
                                        <Badge variant={sensor.status === 'active' ? 'default' : sensor.status === 'error' ? 'destructive' : 'secondary'} className="capitalize text-xs">
                                            {sensor.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{sensor.lastReading || '—'}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(sensor)}>
                                                <Pencil className="size-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="size-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950" onClick={() => openDelete(sensor)}>
                                                <Trash2 className="size-3.5" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {sensors.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                                        No sensors configured. Click "Add Sensor" to create one.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Create / Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingSensor ? 'Edit Sensor' : 'Add Sensor'}</DialogTitle>
                        <DialogDescription>
                            {editingSensor ? 'Update the sensor channel configuration.' : 'Add a new sensor channel to this logger.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        {/* Name */}
                        <div className="grid gap-2">
                            <Label htmlFor="sensor-name">Name</Label>
                            <Input
                                id="sensor-name"
                                value={form.name}
                                onChange={e => setForm({ ...form, name: e.target.value })}
                                placeholder="e.g. Water Level Sensor"
                            />
                            {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
                        </div>

                        {/* Type + Unit */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-2">
                                <Label htmlFor="sensor-type">Type</Label>
                                <select
                                    id="sensor-type"
                                    value={form.type}
                                    onChange={e => handleTypeChange(e.target.value)}
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                    {SENSOR_TYPES.map(t => (
                                        <option key={t.value} value={t.value}>{t.label}</option>
                                    ))}
                                </select>
                                {errors.type && <p className="text-xs text-red-500">{errors.type}</p>}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="sensor-unit">Unit</Label>
                                <Input
                                    id="sensor-unit"
                                    value={form.unit}
                                    onChange={e => setForm({ ...form, unit: e.target.value })}
                                    placeholder="e.g. °C, m, mm"
                                />
                                {errors.unit && <p className="text-xs text-red-500">{errors.unit}</p>}
                            </div>
                        </div>

                        {/* Status */}
                        <div className="grid gap-2">
                            <Label htmlFor="sensor-status">Status</Label>
                            <select
                                id="sensor-status"
                                value={form.status}
                                onChange={e => setForm({ ...form, status: e.target.value })}
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                                <option value="error">Error</option>
                            </select>
                            {errors.status && <p className="text-xs text-red-500">{errors.status}</p>}
                        </div>

                        {/* Min / Max */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-2">
                                <Label htmlFor="sensor-min">Min Value</Label>
                                <Input
                                    id="sensor-min"
                                    type="number"
                                    step="any"
                                    value={form.min_value}
                                    onChange={e => setForm({ ...form, min_value: parseFloat(e.target.value) || 0 })}
                                />
                                {errors.min_value && <p className="text-xs text-red-500">{errors.min_value}</p>}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="sensor-max">Max Value</Label>
                                <Input
                                    id="sensor-max"
                                    type="number"
                                    step="any"
                                    value={form.max_value}
                                    onChange={e => setForm({ ...form, max_value: parseFloat(e.target.value) || 0 })}
                                />
                                {errors.max_value && <p className="text-xs text-red-500">{errors.max_value}</p>}
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSubmit} disabled={processing}>
                            {processing ? 'Saving...' : editingSensor ? 'Save Changes' : 'Create Sensor'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Sensor</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete <strong>{deletingSensor?.name}</strong>? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleDelete} disabled={processing}>
                            {processing ? 'Deleting...' : 'Delete Sensor'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function getStatusBadgeVariant(status: string): 'default' | 'destructive' | 'secondary' {
    switch (status) {
        case 'online': return 'default';
        case 'offline': return 'destructive';
        case 'warning': return 'secondary';
        default: return 'secondary';
    }
}

function getLogLevelColor(level: string) {
    switch (level) {
        case 'info': return 'text-blue-500';
        case 'warning': return 'text-amber-500';
        case 'error': return 'text-red-500';
        default: return 'text-muted-foreground';
    }
}

function DeviceConfigCard({ loggerId, intervalRead, intervalSend, maxReset, disabled }: {
    loggerId: number;
    intervalRead: number;
    intervalSend: number;
    maxReset: number;
    disabled: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const [values, setValues] = useState({
        interval_read: intervalRead,
        interval_send: intervalSend,
        max_reset: maxReset,
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const handleSave = () => {
        setSaving(true);
        router.put(`/loggers/${loggerId}/config`, values, {
            preserveScroll: true,
            onSuccess: () => {
                setSaved(true);
                setEditing(false);
                setTimeout(() => setSaved(false), 2000);
            },
            onFinish: () => setSaving(false),
        });
    };

    const handleCancel = () => {
        setValues({ interval_read: intervalRead, interval_send: intervalSend, max_reset: maxReset });
        setEditing(false);
    };

    return (
        <Card className="mt-4">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2"><SlidersHorizontal className="size-5" /> Device Configuration</CardTitle>
                        <CardDescription>Data acquisition and watchdog settings</CardDescription>
                    </div>
                    {!editing && !disabled && (
                        <Button variant="ghost" size="icon" onClick={() => setEditing(true)} className="size-8">
                            <Pencil className="size-4" />
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {!editing ? (
                    <div className="space-y-3">
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                            <dt className="text-muted-foreground flex items-center gap-1.5">
                                <Timer className="size-3.5 text-blue-500" /> Interval Ambil Data
                            </dt>
                            <dd className="font-medium">{intervalRead} menit</dd>
                            <dt className="text-muted-foreground flex items-center gap-1.5">
                                <Upload className="size-3.5 text-emerald-500" /> Interval Kirim Data
                            </dt>
                            <dd className="font-medium">{intervalSend} menit</dd>
                            <dt className="text-muted-foreground flex items-center gap-1.5">
                                <RotateCcw className="size-3.5 text-amber-500" /> Max Reset (Watchdog)
                            </dt>
                            <dd className="font-medium">{maxReset} kali</dd>
                        </dl>
                        {saved && (
                            <span className="flex items-center gap-1 text-sm text-emerald-600">
                                <CheckCircle2 className="size-4" /> Configuration saved!
                            </span>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-3">
                            <div className="space-y-2">
                                <label className="text-sm font-medium flex items-center gap-1.5">
                                    <Timer className="size-4 text-blue-500" />
                                    Interval Ambil Data
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min={1}
                                        max={1440}
                                        value={values.interval_read}
                                        onChange={(e) => setValues({ ...values, interval_read: parseInt(e.target.value) || 1 })}
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    />
                                    <span className="text-sm text-muted-foreground whitespace-nowrap">menit</span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium flex items-center gap-1.5">
                                    <Upload className="size-4 text-emerald-500" />
                                    Interval Kirim Data
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min={1}
                                        max={1440}
                                        value={values.interval_send}
                                        onChange={(e) => setValues({ ...values, interval_send: parseInt(e.target.value) || 1 })}
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    />
                                    <span className="text-sm text-muted-foreground whitespace-nowrap">menit</span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium flex items-center gap-1.5">
                                    <RotateCcw className="size-4 text-amber-500" />
                                    Max Reset (Watchdog)
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        value={values.max_reset}
                                        onChange={(e) => setValues({ ...values, max_reset: parseInt(e.target.value) || 0 })}
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    />
                                    <span className="text-sm text-muted-foreground whitespace-nowrap">kali</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
                                <Save className="size-4" />
                                {saving ? 'Saving...' : 'Save'}
                            </Button>
                            <Button onClick={handleCancel} variant="outline" size="sm" className="gap-2">
                                <XCircle className="size-4" />
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function PlatformIntegrationCard({ loggerId, ministesyEnabled, ministesyKey, ministesyInterval, disabled }: {
    loggerId: number;
    ministesyEnabled: boolean;
    ministesyKey: string | null;
    ministesyInterval: number;
    disabled: boolean;
}) {
    const [showKey, setShowKey] = useState(false);
    const [editing, setEditing] = useState(false);
    const [values, setValues] = useState({
        ministesy_enabled: ministesyEnabled,
        ministesy_key: ministesyKey || '',
        ministesy_interval: ministesyInterval,
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [showDisableDialog, setShowDisableDialog] = useState(false);
    const [showSaveDialog, setShowSaveDialog] = useState(false);

    const isDirty = values.ministesy_enabled !== ministesyEnabled
        || values.ministesy_key !== (ministesyKey || '')
        || values.ministesy_interval !== ministesyInterval;

    const handleToggle = () => {
        const newEnabled = !values.ministesy_enabled;
        if (!newEnabled && ministesyEnabled) {
            // Disabling → show confirmation
            setShowDisableDialog(true);
        } else if (newEnabled && !ministesyEnabled) {
            // First time enabling → open edit mode
            setValues({ ...values, ministesy_enabled: true });
            setEditing(true);
        } else {
            // Re-enabling with existing config → save immediately
            const newValues = { ...values, ministesy_enabled: newEnabled };
            setValues(newValues);
            doSave(newValues);
        }
    };

    const confirmDisable = () => {
        const newValues = { ...values, ministesy_enabled: false };
        setValues(newValues);
        setShowDisableDialog(false);
        doSave(newValues);
    };

    const doSave = (data: typeof values) => {
        setSaving(true);
        router.put(`/loggers/${loggerId}/platform`, data, {
            preserveScroll: true,
            onSuccess: () => {
                setSaved(true);
                setEditing(false);
                setTimeout(() => setSaved(false), 2000);
            },
            onFinish: () => setSaving(false),
        });
    };

    const handleSave = () => {
        setShowSaveDialog(true);
    };

    const confirmSave = () => {
        setShowSaveDialog(false);
        doSave(values);
    };

    const handleCancel = () => {
        setValues({
            ministesy_enabled: ministesyEnabled,
            ministesy_key: ministesyKey || '',
            ministesy_interval: ministesyInterval,
        });
        setEditing(false);
    };

    const maskedKey = ministesyKey
        ? ministesyKey.slice(0, 4) + '••••••••' + ministesyKey.slice(-4)
        : '—';

    return (
        <Card className="mt-4">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Link2 className="size-5" /> Platform Integration</CardTitle>
                <CardDescription>Send telemetry data to external platforms</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {/* Mini STESY Platform */}
                <div className="rounded-lg border overflow-hidden">
                    {/* Platform Header */}
                    <div className="flex items-center gap-3 p-3">
                        <div className="flex size-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950">
                            <Radio className="size-5 text-blue-600" />
                        </div>
                        <div className="flex-1">
                            <p className="text-sm font-semibold">Mini STESY</p>
                            <p className="text-xs text-muted-foreground">Telemetry data relay platform</p>
                        </div>
                        {!editing && ministesyEnabled && !disabled && (
                            <Button variant="ghost" size="icon" onClick={() => setEditing(true)} className="size-8">
                                <Pencil className="size-4" />
                            </Button>
                        )}
                        <label className="flex items-center gap-2 cursor-pointer">
                            <button
                                type="button"
                                role="switch"
                                aria-checked={values.ministesy_enabled}
                                onClick={handleToggle}
                                disabled={disabled}
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${values.ministesy_enabled ? 'bg-primary' : 'bg-input'}`}
                            >
                                <span className={`pointer-events-none inline-block size-5 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200 ease-in-out ${values.ministesy_enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                        </label>
                    </div>

                    {/* Expanded content when enabled */}
                    {values.ministesy_enabled && (
                        <div className="border-t bg-muted/30 p-3 space-y-3">
                            {!editing ? (
                                <>
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                        <dt className="text-muted-foreground flex items-center gap-1.5">
                                            <Key className="size-3.5 text-violet-500" /> Encryption Key
                                        </dt>
                                        <dd className="font-mono text-xs">{maskedKey}</dd>
                                        <dt className="text-muted-foreground flex items-center gap-1.5">
                                            <Timer className="size-3.5 text-blue-500" /> Interval Kirim Data
                                        </dt>
                                        <dd className="font-medium">{ministesyInterval} menit</dd>
                                    </dl>
                                    {saved && (
                                        <span className="flex items-center gap-1 text-sm text-emerald-600">
                                            <CheckCircle2 className="size-4" /> Saved!
                                        </span>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium flex items-center gap-1.5">
                                                <Key className="size-4 text-violet-500" />
                                                Encryption Key
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type={showKey ? 'text' : 'password'}
                                                    value={values.ministesy_key}
                                                    onChange={(e) => setValues({ ...values, ministesy_key: e.target.value })}
                                                    placeholder="Enter encryption key"
                                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pr-9 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowKey(!showKey)}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                                >
                                                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium flex items-center gap-1.5">
                                                <Timer className="size-4 text-blue-500" />
                                                Interval Kirim Data
                                            </label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={1440}
                                                    value={values.ministesy_interval}
                                                    onChange={(e) => setValues({ ...values, ministesy_interval: parseInt(e.target.value) || 1 })}
                                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                />
                                                <span className="text-sm text-muted-foreground whitespace-nowrap">menit</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
                                            <Save className="size-4" />
                                            {saving ? 'Saving...' : 'Save'}
                                        </Button>
                                        <Button onClick={handleCancel} variant="outline" size="sm" className="gap-2">
                                            <XCircle className="size-4" />
                                            Cancel
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Future platforms go here as additional bordered rows */}
            </CardContent>

            {/* Disable Confirmation */}
            <AlertDialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Disable Mini STESY?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Logger will stop sending telemetry data to Mini STESY platform. You can re-enable it anytime.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={confirmDisable}>Disable</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Save Confirmation */}
            <AlertDialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Save Configuration?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Platform integration settings will be updated and applied immediately.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmSave}>Save</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}

export default function LoggerShow({ logger }: LoggerShowProps) {
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    const breadcrumbs: BreadcrumbItem[] = [
        { title: 'Dashboard', href: '/dashboard' },
        { title: 'Loggers', href: '/loggers' },
        { title: logger.name, href: `/loggers/${logger.id}` },
    ];

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={logger.name} />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* Back link */}
                <Link href="/loggers" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
                    <ArrowLeft className="size-4" />
                    Back to loggers
                </Link>

                {/* Device Header */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-4">
                        <div className={`mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${logger.status === 'online' ? 'bg-emerald-500/10' :
                            logger.status === 'warning' ? 'bg-amber-500/10' : 'bg-red-500/10'
                            }`}>
                            <Radio className={`size-6 ${logger.status === 'online' ? 'text-emerald-500' :
                                logger.status === 'warning' ? 'text-amber-500' : 'text-red-500'
                                }`} />
                        </div>
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-xl font-bold">{logger.name}</h1>
                                <Badge variant={getStatusBadgeVariant(logger.status)} className="capitalize">
                                    {logger.status}
                                </Badge>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1">
                                    <Terminal className="size-3.5" />
                                    {logger.serialNumber}
                                </span>
                                {logger.location && (
                                    <span className="flex items-center gap-1">
                                        <MapPin className="size-3.5" />
                                        {logger.location}
                                    </span>
                                )}
                                {logger.model && (
                                    <span className="flex items-center gap-1">
                                        <Cpu className="size-3.5" />
                                        {logger.model}
                                    </span>
                                )}
                                {logger.firmwareVersion && <span className="font-mono text-xs">{logger.firmwareVersion}</span>}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5" disabled={logger.status === 'offline'}>
                            <Plug className="size-4" />
                            Connect
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5" disabled={logger.status === 'offline'}>
                            <RefreshCw className="size-4" />
                            Sync
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5" disabled={logger.status === 'offline'}>
                            <Save className="size-4" />
                            Save Config
                        </Button>
                        <Button variant="destructive" size="sm" className="gap-1.5" disabled={logger.status === 'offline'}>
                            <Power className="size-4" />
                            Reboot
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                            onClick={() => setShowDeleteDialog(true)}
                        >
                            <Trash2 className="size-4" />
                            Delete
                        </Button>
                    </div>
                </div>

                <Separator />

                {/* Tabs */}
                <Tabs defaultValue="overview" className="w-full">
                    <TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden h-auto">
                        <TabsTrigger value="overview" className="gap-1.5"><Activity className="size-3.5" />Overview</TabsTrigger>
                        <TabsTrigger value="sensors" className="gap-1.5"><Thermometer className="size-3.5" />Sensors</TabsTrigger>
                        <TabsTrigger value="system" className="gap-1.5"><Cpu className="size-3.5" />System</TabsTrigger>
                        <TabsTrigger value="maintenance" className="gap-1.5"><Settings className="size-3.5" />Maintenance</TabsTrigger>
                        <TabsTrigger value="logs" className="gap-1.5"><Terminal className="size-3.5" />Logs</TabsTrigger>
                        <TabsTrigger value="api" className="gap-1.5"><Code2 className="size-3.5" />API</TabsTrigger>
                    </TabsList>

                    {/* ==================== OVERVIEW ==================== */}
                    <TabsContent value="overview" className="mt-6">
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <InfoCard icon={Wifi} label="Connection" value={logger.connectionType.toUpperCase()} color="blue" />
                            <InfoCard icon={Signal} label="Signal Strength" value={`${logger.signalStrength}%`} color="emerald" />
                            <InfoCard icon={Clock} label="Uptime" value={logger.uptime || '—'} color="violet" />
                            <InfoCard icon={Activity} label="Active Sensors" value={`${logger.sensors.filter(s => s.status === 'active').length}/${logger.sensors.length}`} color="amber" />
                        </div>

                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                            <Card>
                                <CardHeader><CardTitle>Device Info</CardTitle></CardHeader>
                                <CardContent>
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                        <dt className="text-muted-foreground">Model</dt>
                                        <dd className="font-medium">{logger.model || '—'}</dd>
                                        <dt className="text-muted-foreground">Serial Number</dt>
                                        <dd className="font-mono text-xs">{logger.serialNumber}</dd>
                                        <dt className="text-muted-foreground">Firmware</dt>
                                        <dd className="font-mono text-xs">{logger.firmwareVersion || '—'}</dd>
                                        <dt className="text-muted-foreground">IP Address</dt>
                                        <dd className="font-mono text-xs">{logger.ipAddress || '—'}</dd>
                                        <dt className="text-muted-foreground">MAC Address</dt>
                                        <dd className="font-mono text-xs">{logger.macAddress || '—'}</dd>
                                        <dt className="text-muted-foreground">Last Seen</dt>
                                        <dd className="text-xs">{logger.lastSeen || '—'}</dd>
                                    </dl>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><Network className="size-5" /> Network Configuration</CardTitle></CardHeader>
                                <CardContent>
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                        <dt className="text-muted-foreground">Connection Type</dt>
                                        <dd className="font-medium uppercase">{logger.connectionType}</dd>
                                        <dt className="text-muted-foreground">IP Address</dt>
                                        <dd className="font-mono text-xs">{logger.ipAddress || '—'}</dd>
                                        <dt className="text-muted-foreground">Subnet Mask</dt>
                                        <dd className="font-mono text-xs">{logger.subnet || '—'}</dd>
                                        <dt className="text-muted-foreground">Gateway</dt>
                                        <dd className="font-mono text-xs">{logger.gateway || '—'}</dd>
                                        <dt className="text-muted-foreground">DNS Server</dt>
                                        <dd className="font-mono text-xs">{logger.dns || '—'}</dd>
                                        <dt className="text-muted-foreground">MAC Address</dt>
                                        <dd className="font-mono text-xs">{logger.macAddress || '—'}</dd>
                                    </dl>
                                </CardContent>
                            </Card>
                        </div>

                        <Card className="mt-4">
                            <CardHeader>
                                <CardTitle>Sensor Summary</CardTitle>
                                <CardDescription>Latest readings from all channels</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                    {logger.sensors.map((sensor) => (
                                        <div key={sensor.id} className="flex items-center gap-3 rounded-lg border p-3">
                                            <div className={`h-2 w-2 rounded-full ${sensor.status === 'active' ? 'bg-emerald-500' : sensor.status === 'error' ? 'bg-red-500' : 'bg-gray-400'}`} />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs text-muted-foreground">{sensor.name}</p>
                                                <p className="font-mono text-sm font-semibold">{sensor.value} <span className="text-xs font-normal text-muted-foreground">{sensor.unit}</span></p>
                                            </div>
                                        </div>
                                    ))}
                                    {logger.sensors.length === 0 && <p className="text-sm text-muted-foreground col-span-full">No sensors configured.</p>}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ==================== SENSORS ==================== */}
                    <TabsContent value="sensors" className="mt-6">
                        <SensorCrudPanel loggerId={logger.id} sensors={logger.sensors} />
                    </TabsContent>

                    {/* ==================== SYSTEM ==================== */}
                    <TabsContent value="system" className="mt-6">
                        <div className="grid gap-4 lg:grid-cols-2">
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="size-5" /> System Information</CardTitle></CardHeader>
                                <CardContent>
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                        <dt className="text-muted-foreground">Model</dt>
                                        <dd className="font-medium">{logger.model || '—'}</dd>
                                        <dt className="text-muted-foreground">Serial Number</dt>
                                        <dd className="font-mono text-xs">{logger.serialNumber}</dd>
                                        <dt className="text-muted-foreground">Device ID</dt>
                                        <dd className="font-mono text-xs">{logger.id}</dd>
                                        <dt className="text-muted-foreground">Firmware</dt>
                                        <dd className="font-mono text-xs">{logger.firmwareVersion || '—'}</dd>
                                        <dt className="text-muted-foreground">Uptime</dt>
                                        <dd className="font-medium">{logger.uptime || '—'}</dd>
                                        <dt className="text-muted-foreground">Location</dt>
                                        <dd>{logger.location || '—'}</dd>
                                    </dl>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><Database className="size-5" /> Storage Overview</CardTitle></CardHeader>
                                <CardContent className="space-y-5">
                                    <ResourceBar label="Disk Usage" value={logger.storageUsage} max={logger.storageTotal} unit="GB" />
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                        <dt className="text-muted-foreground">Log Files</dt>
                                        <dd className="font-medium">{logger.logFileCount.toLocaleString()}</dd>
                                        <dt className="text-muted-foreground">Config Backups</dt>
                                        <dd className="font-medium">{logger.configBackups}</dd>
                                        <dt className="text-muted-foreground">Last Backup</dt>
                                        <dd className="text-xs">{logger.lastConfigBackup || '—'}</dd>
                                    </dl>
                                </CardContent>
                            </Card>
                        </div>
                        <DeviceConfigCard
                            loggerId={logger.id}
                            intervalRead={logger.intervalRead}
                            intervalSend={logger.intervalSend}
                            maxReset={logger.maxReset}
                            disabled={logger.status === 'offline'}
                        />
                        <PlatformIntegrationCard
                            loggerId={logger.id}
                            ministesyEnabled={logger.ministesyEnabled}
                            ministesyKey={logger.ministesyKey}
                            ministesyInterval={logger.ministesyInterval}
                            disabled={logger.status === 'offline'}
                        />
                        <Card className="mt-4">
                            <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="size-5" /> Storage Management</CardTitle></CardHeader>
                            <CardContent>
                                <div className="flex flex-wrap gap-3">
                                    <Button variant="outline" className="gap-2" disabled={logger.status === 'offline'}>
                                        <Trash2 className="size-4" /> Clean Old Logs
                                    </Button>
                                    <Button variant="outline" className="gap-2" disabled={logger.status === 'offline'}>
                                        <Download className="size-4" /> Export Log Files
                                    </Button>
                                    <Button variant="outline" className="gap-2" disabled={logger.status === 'offline'}>
                                        <Save className="size-4" /> Backup Configuration
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ==================== MAINTENANCE ==================== */}
                    <TabsContent value="maintenance" className="mt-6">
                        <div className="grid gap-4 lg:grid-cols-2">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><Zap className="size-5" /> Firmware</CardTitle>
                                    <CardDescription>Current: {logger.firmwareVersion || '—'}</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid gap-3">
                                        <div className="flex items-center justify-between rounded-lg border p-3">
                                            <div>
                                                <p className="text-sm font-medium">Current Firmware</p>
                                                <p className="font-mono text-xs text-muted-foreground">{logger.firmwareVersion || '—'}</p>
                                            </div>
                                            <Badge variant="default">Up to date</Badge>
                                        </div>
                                        <Button variant="outline" className="gap-2" disabled={logger.status === 'offline'}>
                                            <Upload className="size-4" /> Upload Firmware
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><HardDrive className="size-5" /> Device Actions</CardTitle></CardHeader>
                                <CardContent>
                                    <div className="grid gap-3">
                                        <Button variant="outline" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <Power className="size-4" /> Schedule Reboot
                                        </Button>
                                        <Button variant="outline" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <Download className="size-4" /> Export Configuration
                                        </Button>
                                        <Button variant="outline" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <Upload className="size-4" /> Import Configuration
                                        </Button>
                                        <Separator />
                                        <Button variant="destructive" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <RotateCcw className="size-4" /> Factory Reset
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    {/* ==================== LOGS ==================== */}
                    <TabsContent value="logs" className="mt-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><Terminal className="size-5" /> Activity Logs</CardTitle>
                                <CardDescription>{logger.activityLogs.length} log entries</CardDescription>
                            </CardHeader>
                            <Separator />
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[180px]">Timestamp</TableHead>
                                            <TableHead>Level</TableHead>
                                            <TableHead>Action</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="hidden md:table-cell">Message</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {logger.activityLogs.map((log) => (
                                            <TableRow key={log.id}>
                                                <TableCell className="font-mono text-xs text-muted-foreground">{log.timestamp}</TableCell>
                                                <TableCell>
                                                    <span className={`text-xs font-medium uppercase ${getLogLevelColor(log.level)}`}>{log.level}</span>
                                                </TableCell>
                                                <TableCell className="font-medium">{log.action}</TableCell>
                                                <TableCell>
                                                    <Badge variant={log.status === 'success' ? 'default' : log.status === 'failed' ? 'destructive' : 'secondary'} className="text-xs">
                                                        {log.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="hidden max-w-[300px] truncate text-sm text-muted-foreground md:table-cell">{log.message}</TableCell>
                                            </TableRow>
                                        ))}
                                        {logger.activityLogs.length === 0 && (
                                            <TableRow><TableCell colSpan={5} className="py-12 text-center text-muted-foreground">No logs found.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ==================== API ==================== */}
                    <TabsContent value="api" className="mt-6">
                        <ApiDocumentation loggerId={logger.id} loggerName={logger.name} />
                    </TabsContent>
                </Tabs>

                {/* Delete Dialog */}
                <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete Logger</AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to delete <strong>{logger.name}</strong> ({logger.serialNumber})?
                                This will also delete all associated sensors and activity logs. This action cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                className="bg-red-600 hover:bg-red-700"
                                onClick={() => router.delete(`/loggers/${logger.id}`)}
                            >
                                Delete Logger
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </AppLayout >
    );
}

// =============================================================================
// Helper Components
// =============================================================================

function InfoCard({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; color: string }) {
    const colorMap: Record<string, string> = {
        blue: 'bg-blue-500/10 text-blue-500',
        emerald: 'bg-emerald-500/10 text-emerald-500',
        violet: 'bg-violet-500/10 text-violet-500',
        amber: 'bg-amber-500/10 text-amber-500',
    };

    return (
        <Card className="h-full">
            <CardContent className="flex h-full items-center gap-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colorMap[color] || ''}`}>
                    <Icon className="size-5" />
                </div>
                <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-lg font-bold">{value}</p>
                </div>
            </CardContent>
        </Card>
    );
}

function ResourceBar({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
    const pct = max > 0 ? (value / max) * 100 : 0;
    const barColor = pct > 80 ? '[&>div]:bg-red-500' : pct > 60 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500';

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
                <span>{label}</span>
                <span className="font-mono text-xs font-medium">{value} / {max} {unit} <span className="text-muted-foreground">({pct.toFixed(0)}%)</span></span>
            </div>
            <Progress value={pct} className={`h-2 ${barColor}`} />
        </div>
    );
}

// =============================================================================
// API Documentation Component
// =============================================================================

interface ApiEndpoint {
    method: 'GET' | 'POST';
    path: string;
    title: string;
    description: string;
    params?: { name: string; type: string; required: boolean; description: string }[];
    requestBody?: string;
    responseExample: string;
}

function ApiDocumentation({ loggerId, loggerName }: { loggerId: number; loggerName: string }) {
    const [expandedEndpoint, setExpandedEndpoint] = useState<number | null>(null);
    const [copiedUrl, setCopiedUrl] = useState(false);

    const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/v1` : '/api/v1';

    const endpoints: ApiEndpoint[] = [
        {
            method: 'GET',
            path: `/loggers/${loggerId}`,
            title: 'Get Logger Details',
            description: `Retrieve complete device information for "${loggerName}" including status, location, firmware, and GPS coordinates.`,
            responseExample: JSON.stringify({
                success: true,
                data: {
                    id: loggerId,
                    name: loggerName,
                    serial_number: 'BLC-2024-XXXXX',
                    status: 'online',
                    connection_type: '4g-lte',
                    firmware_version: 'v3.2.1',
                    battery: '13.2',
                    signal_strength: 85,
                    gps: { lat: '-6.6301', lng: '106.8517', alt: '250' },
                    last_seen_at: '2026-03-11T01:00:00+07:00',
                },
            }, null, 2),
        },
        {
            method: 'GET',
            path: `/loggers/${loggerId}/sensors`,
            title: 'Get Sensor Readings',
            description: 'Retrieve all sensor channel readings including current values, units, status, and min/max ranges.',
            responseExample: JSON.stringify({
                success: true,
                data: {
                    logger_id: loggerId,
                    logger_name: loggerName,
                    sensors: [
                        {
                            id: 1,
                            name: 'Water Level',
                            type: 'water-level',
                            value: 2.45,
                            unit: 'm',
                            status: 'active',
                            min_value: 0,
                            max_value: 10,
                            last_reading_at: '2026-03-11T01:00:00+07:00',
                        },
                    ],
                },
            }, null, 2),
        },
        {
            method: 'GET',
            path: `/loggers/${loggerId}/logs`,
            title: 'Get Activity Logs',
            description: 'Retrieve activity log entries for this logger. Supports pagination via limit parameter.',
            params: [
                { name: 'limit', type: 'integer', required: false, description: 'Number of log entries (default: 50, max: 100)' },
            ],
            responseExample: JSON.stringify({
                success: true,
                data: [
                    {
                        id: 1,
                        action: 'Config Sync',
                        status: 'success',
                        level: 'info',
                        message: 'Configuration synced successfully',
                        created_at: '2026-03-11T01:00:00+07:00',
                    },
                ],
            }, null, 2),
        },
        {
            method: 'POST',
            path: `/loggers/${loggerId}/command`,
            title: 'Send Command',
            description: 'Send a remote command to the logger device. Available commands: reboot, sync_config, backup_config, check_firmware, request_info.',
            params: [
                { name: 'command', type: 'string', required: true, description: 'Command to execute: reboot | sync_config | backup_config | check_firmware | request_info' },
                { name: 'params', type: 'object', required: false, description: 'Optional parameters for the command' },
            ],
            requestBody: JSON.stringify({
                command: 'sync_config',
                params: {},
            }, null, 2),
            responseExample: JSON.stringify({
                success: true,
                data: {
                    logger_id: loggerId,
                    command: 'sync_config',
                    status: 'queued',
                    message: `Command 'sync_config' has been queued for ${loggerName}.`,
                },
            }, null, 2),
        },
        {
            method: 'POST',
            path: `/loggers/${loggerId}/sensors/data`,
            title: 'Push Sensor Data',
            description: 'Push new sensor readings to the logger. Each reading must specify the sensor type and value.',
            params: [
                { name: 'readings', type: 'array', required: true, description: 'Array of sensor readings' },
                { name: 'readings[].sensor_type', type: 'string', required: true, description: 'Sensor type identifier (e.g. water-level, temperature)' },
                { name: 'readings[].value', type: 'number', required: true, description: 'Sensor reading value' },
                { name: 'readings[].timestamp', type: 'datetime', required: false, description: 'Reading timestamp (ISO 8601, defaults to now)' },
            ],
            requestBody: JSON.stringify({
                readings: [
                    { sensor_type: 'water-level', value: 2.45 },
                    { sensor_type: 'temperature', value: 28.3, timestamp: '2026-03-11T01:00:00+07:00' },
                ],
            }, null, 2),
            responseExample: JSON.stringify({
                success: true,
                data: {
                    logger_id: loggerId,
                    results: [
                        { sensor_type: 'water-level', value: 2.45, status: 'updated' },
                        { sensor_type: 'temperature', value: 28.3, status: 'updated' },
                    ],
                },
            }, null, 2),
        },
    ];

    function copyToClipboard(text: string) {
        navigator.clipboard.writeText(text);
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
    }

    function toggleEndpoint(index: number) {
        setExpandedEndpoint(expandedEndpoint === index ? null : index);
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Base URL Card */}
            <Card>
                <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-muted-foreground">Base URL</p>
                        <code className="text-sm font-semibold break-all">{baseUrl}</code>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1.5"
                        onClick={() => copyToClipboard(baseUrl)}
                    >
                        <Copy className="size-3.5" />
                        {copiedUrl ? 'Copied!' : 'Copy'}
                    </Button>
                </CardContent>
            </Card>

            {/* Endpoints */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Code2 className="size-5" />
                        API Endpoints
                    </CardTitle>
                    <CardDescription>
                        {endpoints.length} endpoints available for this logger
                    </CardDescription>
                </CardHeader>
                <Separator />
                <CardContent className="p-0">
                    {endpoints.map((endpoint, idx) => (
                        <div key={idx} className={idx > 0 ? 'border-t' : ''}>
                            {/* Endpoint Header */}
                            <button
                                onClick={() => toggleEndpoint(idx)}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                            >
                                {expandedEndpoint === idx
                                    ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                                    : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                                }
                                <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${endpoint.method === 'GET'
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                    }`}>
                                    {endpoint.method}
                                </span>
                                <code className="text-sm font-medium">{endpoint.path}</code>
                                <span className="ml-auto text-xs text-muted-foreground">{endpoint.title}</span>
                            </button>

                            {/* Expanded Details */}
                            {expandedEndpoint === idx && (
                                <div className="border-t bg-muted/30 px-6 py-5">
                                    <div className="flex flex-col gap-5">
                                        {/* Description */}
                                        <p className="text-sm text-muted-foreground">{endpoint.description}</p>

                                        {/* Full URL */}
                                        <div>
                                            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">URL</p>
                                            <div className="flex items-center gap-2">
                                                <code className="flex-1 rounded-md border bg-background px-3 py-2 text-sm break-all">
                                                    {baseUrl}{endpoint.path}
                                                </code>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => copyToClipboard(`${baseUrl}${endpoint.path}`)}
                                                >
                                                    <Copy className="size-3.5" />
                                                </Button>
                                            </div>
                                        </div>

                                        {/* Parameters */}
                                        {endpoint.params && endpoint.params.length > 0 && (
                                            <div>
                                                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Parameters</p>
                                                <div className="rounded-md border overflow-hidden">
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow>
                                                                <TableHead className="text-xs">Name</TableHead>
                                                                <TableHead className="text-xs">Type</TableHead>
                                                                <TableHead className="text-xs">Required</TableHead>
                                                                <TableHead className="text-xs">Description</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {endpoint.params.map((param, pIdx) => (
                                                                <TableRow key={pIdx}>
                                                                    <TableCell className="font-mono text-xs font-medium">{param.name}</TableCell>
                                                                    <TableCell>
                                                                        <Badge variant="outline" className="text-[10px]">{param.type}</Badge>
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        {param.required
                                                                            ? <Badge variant="default" className="text-[10px] bg-red-500/80">Required</Badge>
                                                                            : <Badge variant="secondary" className="text-[10px]">Optional</Badge>
                                                                        }
                                                                    </TableCell>
                                                                    <TableCell className="text-xs text-muted-foreground">{param.description}</TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            </div>
                                        )}

                                        {/* Request Body */}
                                        {endpoint.requestBody && (
                                            <div>
                                                <div className="mb-1.5 flex items-center justify-between">
                                                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Request Body</p>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 text-xs gap-1"
                                                        onClick={() => copyToClipboard(endpoint.requestBody!)}
                                                    >
                                                        <Copy className="size-3" /> Copy
                                                    </Button>
                                                </div>
                                                <pre className="overflow-x-auto rounded-md border bg-zinc-950 p-4 text-xs text-emerald-400">
                                                    <code>{endpoint.requestBody}</code>
                                                </pre>
                                            </div>
                                        )}

                                        {/* Response Example */}
                                        <div>
                                            <div className="mb-1.5 flex items-center justify-between">
                                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Response Example</p>
                                                <Badge variant="default" className="text-[10px] gap-1 bg-emerald-500/80">
                                                    <CheckCircle2 className="size-2.5" /> 200 OK
                                                </Badge>
                                            </div>
                                            <pre className="overflow-x-auto rounded-md border bg-zinc-950 p-4 text-xs text-emerald-400">
                                                <code>{endpoint.responseExample}</code>
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </CardContent>
            </Card>

            {/* Usage Notes */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">Integration Notes</CardTitle>
                </CardHeader>
                <CardContent>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                            <span><strong className="text-foreground">GET</strong> endpoints are read-only and safe to call at any frequency.</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                            <span><strong className="text-foreground">POST</strong> endpoints modify data or send commands. Use the <code className="rounded bg-muted px-1 text-xs">Content-Type: application/json</code> header.</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                            <span>All responses follow the format <code className="rounded bg-muted px-1 text-xs">{'{ "success": true, "data": {...} }'}</code>.</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                            <span>Timestamps are in <strong className="text-foreground">ISO 8601</strong> format with timezone offset.</span>
                        </li>
                    </ul>
                </CardContent>
            </Card>
        </div>
    );
}

