import { Head, router, useForm } from '@inertiajs/react';
import {
    Check,
    CheckCircle2,
    Download,
    Factory,
    FileUp,
    History,
    Loader2,
    Plus,
    Search,
    Trash2,
    UploadCloud,
    XCircle,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
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
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

interface ProductionDeviceItem {
    id: number;
    serialNumber: string;
    deviceId: string | null;
    model: string | null;
    hardwareVersion: string | null;
    firmwareVersion: string | null;
    firmwareFileName: string | null;
    firmwareFileUrl: string | null;
    firmwareFileSize: number | null;
    firmwareUploadedAt: string | null;
    firmwareLogs: ProductionFirmwareLogItem[];
    batchNumber: string | null;
    productionDate: string | null;
    testedBy: string | null;
    qcStatus: 'passed' | 'failed' | 'pending';
    notes: string | null;
    isRegistered: boolean;
    createdAt: string | null;
}

interface ProductionFirmwareLogItem {
    id: number;
    action: string;
    fromVersion: string | null;
    toVersion: string | null;
    fileName: string | null;
    fileSize: number | null;
    message: string | null;
    userName: string | null;
    createdAt: string | null;
}

interface ProductionPageProps {
    devices: ProductionDeviceItem[];
    deviceModels: string[];
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Production', href: '/production' },
];

function getQcBadge(status: string) {
    switch (status) {
        case 'passed':
            return (
                <Badge variant="default" className="capitalize">
                    Passed
                </Badge>
            );
        case 'failed':
            return (
                <Badge variant="destructive" className="capitalize">
                    Failed
                </Badge>
            );
        default:
            return (
                <Badge variant="secondary" className="capitalize">
                    Pending
                </Badge>
            );
    }
}

function formatBytes(bytes: number | null) {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
}

export default function ProductionIndex({
    devices,
    deviceModels,
}: ProductionPageProps) {
    const initialSearch =
        typeof window === 'undefined'
            ? ''
            : new URLSearchParams(window.location.search).get('model') || '';
    const [search, setSearch] = useState(initialSearch);
    const [qcFilter, setQcFilter] = useState<string>('all');
    const [addOpen, setAddOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [firmwareTarget, setFirmwareTarget] =
        useState<ProductionDeviceItem | null>(null);
    const [logTarget, setLogTarget] = useState<ProductionDeviceItem | null>(
        null,
    );
    const [deleteTarget, setDeleteTarget] =
        useState<ProductionDeviceItem | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const firmwareFileInputRef = useRef<HTMLInputElement>(null);

    const form = useForm({
        serial_number: '',
        device_id: '',
        model: '',
        hardware_version: '',
        firmware_version: '',
        production_date: '',
        tested_by: '',
        qc_status: 'pending',
        notes: '',
    });

    const importForm = useForm<{ csv_file: File | null }>({
        csv_file: null,
    });

    const firmwareForm = useForm<{
        firmware_version: string;
        firmware_file: File | null;
    }>({
        firmware_version: '',
        firmware_file: null,
    });

    const filtered = useMemo(() => {
        return devices.filter((d) => {
            const matchSearch =
                search === '' ||
                d.serialNumber.toLowerCase().includes(search.toLowerCase()) ||
                (d.model &&
                    d.model.toLowerCase().includes(search.toLowerCase())) ||
                (d.firmwareVersion &&
                    d.firmwareVersion
                        .toLowerCase()
                        .includes(search.toLowerCase())) ||
                (d.deviceId &&
                    d.deviceId.toLowerCase().includes(search.toLowerCase()));

            const matchQc = qcFilter === 'all' || d.qcStatus === qcFilter;
            return matchSearch && matchQc;
        });
    }, [devices, search, qcFilter]);

    const passedCount = devices.filter((d) => d.qcStatus === 'passed').length;
    const pendingCount = devices.filter((d) => d.qcStatus === 'pending').length;
    const failedCount = devices.filter((d) => d.qcStatus === 'failed').length;
    const registeredCount = devices.filter((d) => d.isRegistered).length;

    function handleAddSubmit(e: React.FormEvent) {
        e.preventDefault();
        form.post('/production', {
            onSuccess: () => {
                setAddOpen(false);
                form.reset();
            },
        });
    }

    function handleImportSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!importForm.data.csv_file) return;
        importForm.post('/production/import', {
            forceFormData: true,
            onSuccess: () => {
                setImportOpen(false);
                importForm.reset();
            },
        });
    }

    function openFirmwareDialog(device: ProductionDeviceItem) {
        setFirmwareTarget(device);
        firmwareForm.clearErrors();
        firmwareForm.setData({
            firmware_version: device.firmwareVersion || '',
            firmware_file: null,
        });
        if (firmwareFileInputRef.current)
            firmwareFileInputRef.current.value = '';
    }

    function handleFirmwareSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!firmwareTarget || !firmwareForm.data.firmware_file) return;

        firmwareForm.post(`/production/${firmwareTarget.id}/firmware`, {
            forceFormData: true,
            onSuccess: () => {
                setFirmwareTarget(null);
                firmwareForm.reset();
                if (firmwareFileInputRef.current)
                    firmwareFileInputRef.current.value = '';
            },
        });
    }

    function handleDelete() {
        if (!deleteTarget) return;
        router.delete(`/production/${deleteTarget.id}`, {
            onSuccess: () => setDeleteTarget(null),
        });
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Production Registry" />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* Summary Cards */}
                <div className="grid gap-3 sm:grid-cols-4">
                    <div className="flex items-center gap-3 rounded-xl border p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                            <Factory className="size-5 text-blue-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">
                                {devices.length}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Total Devices
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() =>
                            setQcFilter(
                                qcFilter === 'passed' ? 'all' : 'passed',
                            )
                        }
                        className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-accent ${qcFilter === 'passed' ? 'border-emerald-500 bg-emerald-500/5' : ''}`}
                    >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                            <CheckCircle2 className="size-5 text-emerald-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-emerald-600">
                                {passedCount}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                QC Passed
                            </p>
                        </div>
                    </button>
                    <button
                        onClick={() =>
                            setQcFilter(
                                qcFilter === 'pending' ? 'all' : 'pending',
                            )
                        }
                        className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-accent ${qcFilter === 'pending' ? 'border-amber-500 bg-amber-500/5' : ''}`}
                    >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                            <Loader2 className="size-5 text-amber-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-amber-600">
                                {pendingCount}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Pending QC
                            </p>
                        </div>
                    </button>
                    <button
                        onClick={() =>
                            setQcFilter(
                                qcFilter === 'failed' ? 'all' : 'failed',
                            )
                        }
                        className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-accent ${qcFilter === 'failed' ? 'border-red-500 bg-red-500/5' : ''}`}
                    >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
                            <XCircle className="size-5 text-red-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-red-600">
                                {failedCount}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                QC Failed
                            </p>
                        </div>
                    </button>
                </div>

                {/* Devices Table */}
                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Factory className="size-5" />
                                    Production Devices
                                </CardTitle>
                                <CardDescription>
                                    {filtered.length} of {devices.length}{' '}
                                    devices · {registeredCount} registered
                                </CardDescription>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <div className="relative">
                                    <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        placeholder="Search serial, model…"
                                        value={search}
                                        onChange={(e) =>
                                            setSearch(e.target.value)
                                        }
                                        className="w-full pl-9 sm:w-[240px]"
                                    />
                                </div>
                                <Select
                                    value={qcFilter}
                                    onValueChange={setQcFilter}
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

                                {/* Import CSV */}
                                <Dialog
                                    open={importOpen}
                                    onOpenChange={setImportOpen}
                                >
                                    <DialogTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className="gap-1.5"
                                        >
                                            <FileUp className="size-4" />
                                            Import CSV
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-md">
                                        <DialogHeader>
                                            <DialogTitle>
                                                Import Devices from CSV
                                            </DialogTitle>
                                            <DialogDescription>
                                                Upload a CSV file with columns:
                                                serial_number, device_id, model,
                                                hardware_version,
                                                firmware_version,
                                                production_date, tested_by,
                                                qc_status, notes
                                            </DialogDescription>
                                        </DialogHeader>
                                        <form
                                            onSubmit={handleImportSubmit}
                                            className="grid gap-4 py-2"
                                        >
                                            <div className="grid gap-2">
                                                <Label htmlFor="csv_file">
                                                    CSV File *
                                                </Label>
                                                <Input
                                                    id="csv_file"
                                                    type="file"
                                                    accept=".csv,.txt"
                                                    ref={fileInputRef}
                                                    onChange={(e) => {
                                                        const file =
                                                            e.target.files?.[0];
                                                        if (file)
                                                            importForm.setData(
                                                                'csv_file',
                                                                file,
                                                            );
                                                    }}
                                                />
                                                {importForm.errors.csv_file && (
                                                    <p className="text-xs text-red-500">
                                                        {
                                                            importForm.errors
                                                                .csv_file
                                                        }
                                                    </p>
                                                )}
                                            </div>
                                            <DialogFooter>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={() =>
                                                        setImportOpen(false)
                                                    }
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    type="submit"
                                                    disabled={
                                                        importForm.processing ||
                                                        !importForm.data
                                                            .csv_file
                                                    }
                                                >
                                                    {importForm.processing
                                                        ? 'Importing…'
                                                        : 'Import'}
                                                </Button>
                                            </DialogFooter>
                                        </form>
                                    </DialogContent>
                                </Dialog>

                                {/* Add Single Device */}
                                <Dialog
                                    open={addOpen}
                                    onOpenChange={setAddOpen}
                                >
                                    <DialogTrigger asChild>
                                        <Button className="gap-1.5">
                                            <Plus className="size-4" />
                                            Add Device
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-lg">
                                        <DialogHeader>
                                            <DialogTitle>
                                                Register Production Device
                                            </DialogTitle>
                                            <DialogDescription>
                                                Enter device details from the
                                                production line.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <form
                                            onSubmit={handleAddSubmit}
                                            className="grid gap-4 py-2"
                                        >
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="grid gap-2">
                                                    <Label htmlFor="serial_number">
                                                        Serial Number *
                                                    </Label>
                                                    <Input
                                                        id="serial_number"
                                                        value={
                                                            form.data
                                                                .serial_number
                                                        }
                                                        onChange={(e) =>
                                                            form.setData(
                                                                'serial_number',
                                                                e.target.value,
                                                            )
                                                        }
                                                        placeholder="e.g. BLC-2025-00011"
                                                    />
                                                    {form.errors
                                                        .serial_number && (
                                                        <p className="text-xs text-red-500">
                                                            {
                                                                form.errors
                                                                    .serial_number
                                                            }
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="grid gap-2">
                                                    <Label htmlFor="device_id">
                                                        Device ID
                                                    </Label>
                                                    <Input
                                                        id="device_id"
                                                        value={
                                                            form.data.device_id
                                                        }
                                                        onChange={(e) =>
                                                            form.setData(
                                                                'device_id',
                                                                e.target.value,
                                                            )
                                                        }
                                                        placeholder="e.g. DEV-011"
                                                    />
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="grid gap-2">
                                                    <Label htmlFor="prod_model">
                                                        Model
                                                    </Label>
                                                    <Select
                                                        value={form.data.model}
                                                        onValueChange={(v) =>
                                                            form.setData(
                                                                'model',
                                                                v,
                                                            )
                                                        }
                                                    >
                                                        <SelectTrigger
                                                            id="prod_model"
                                                            className="w-full"
                                                        >
                                                            <SelectValue placeholder="Select model" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {deviceModels.map(
                                                                (m) => (
                                                                    <SelectItem
                                                                        key={m}
                                                                        value={
                                                                            m
                                                                        }
                                                                    >
                                                                        {m}
                                                                    </SelectItem>
                                                                ),
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="grid gap-2">
                                                    <Label htmlFor="qc_status">
                                                        QC Status *
                                                    </Label>
                                                    <Select
                                                        value={
                                                            form.data.qc_status
                                                        }
                                                        onValueChange={(v) =>
                                                            form.setData(
                                                                'qc_status',
                                                                v,
                                                            )
                                                        }
                                                    >
                                                        <SelectTrigger
                                                            id="qc_status"
                                                            className="w-full"
                                                        >
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
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="grid gap-2">
                                                    <Label htmlFor="hardware_version">
                                                        Hardware Version
                                                    </Label>
                                                    <Input
                                                        id="hardware_version"
                                                        value={
                                                            form.data
                                                                .hardware_version
                                                        }
                                                        onChange={(e) =>
                                                            form.setData(
                                                                'hardware_version',
                                                                e.target.value,
                                                            )
                                                        }
                                                        placeholder="e.g. v4.0"
                                                    />
                                                </div>
                                                <div className="grid gap-2">
                                                    <Label htmlFor="firmware_version">
                                                        Firmware Version
                                                    </Label>
                                                    <Input
                                                        id="firmware_version"
                                                        value={
                                                            form.data
                                                                .firmware_version
                                                        }
                                                        onChange={(e) =>
                                                            form.setData(
                                                                'firmware_version',
                                                                e.target.value,
                                                            )
                                                        }
                                                        placeholder="e.g. v1.2.3"
                                                    />
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="grid gap-2">
                                                    <Label htmlFor="production_date">
                                                        Production Date
                                                    </Label>
                                                    <Input
                                                        id="production_date"
                                                        type="date"
                                                        value={
                                                            form.data
                                                                .production_date
                                                        }
                                                        onChange={(e) =>
                                                            form.setData(
                                                                'production_date',
                                                                e.target.value,
                                                            )
                                                        }
                                                    />
                                                </div>
                                                <div className="grid gap-2">
                                                    <Label htmlFor="tested_by">
                                                        Tested By
                                                    </Label>
                                                    <Input
                                                        id="tested_by"
                                                        value={
                                                            form.data.tested_by
                                                        }
                                                        onChange={(e) =>
                                                            form.setData(
                                                                'tested_by',
                                                                e.target.value,
                                                            )
                                                        }
                                                        placeholder="e.g. QC Team A"
                                                    />
                                                </div>
                                            </div>
                                            <div className="grid gap-2">
                                                <Label htmlFor="notes">
                                                    Notes
                                                </Label>
                                                <Textarea
                                                    id="notes"
                                                    value={form.data.notes}
                                                    onChange={(e) =>
                                                        form.setData(
                                                            'notes',
                                                            e.target.value,
                                                        )
                                                    }
                                                    placeholder="Optional notes about the device…"
                                                    rows={2}
                                                />
                                            </div>
                                            <DialogFooter>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={() =>
                                                        setAddOpen(false)
                                                    }
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    type="submit"
                                                    disabled={form.processing}
                                                >
                                                    {form.processing
                                                        ? 'Registering…'
                                                        : 'Register Device'}
                                                </Button>
                                            </DialogFooter>
                                        </form>
                                    </DialogContent>
                                </Dialog>
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
                                    <TableHead className="w-[132px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map((device) => (
                                    <TableRow key={device.id}>
                                        <TableCell className="font-mono text-sm font-medium">
                                            {device.serialNumber}
                                        </TableCell>
                                        <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                                            {device.deviceId || '—'}
                                        </TableCell>
                                        <TableCell className="hidden text-sm lg:table-cell">
                                            {device.model || '—'}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                <span className="font-mono text-xs">
                                                    {device.firmwareVersion ||
                                                        '—'}
                                                </span>
                                                {device.firmwareFileName ? (
                                                    <span className="max-w-[170px] truncate text-xs text-muted-foreground">
                                                        {
                                                            device.firmwareFileName
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
                                            {getQcBadge(device.qcStatus)}
                                        </TableCell>
                                        <TableCell>
                                            {device.isRegistered ? (
                                                <Badge
                                                    variant="default"
                                                    className="gap-1"
                                                >
                                                    <Check className="size-3" />{' '}
                                                    Yes
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary">
                                                    No
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                                            {device.productionDate || '—'}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center justify-end gap-1">
                                                {device.firmwareFileUrl && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        asChild
                                                    >
                                                        <a
                                                            href={
                                                                device.firmwareFileUrl
                                                            }
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            aria-label={`Download firmware ${device.serialNumber}`}
                                                        >
                                                            <Download className="size-4" />
                                                        </a>
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    onClick={() =>
                                                        openFirmwareDialog(
                                                            device,
                                                        )
                                                    }
                                                    aria-label={`Update firmware ${device.serialNumber}`}
                                                >
                                                    <UploadCloud className="size-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    onClick={() =>
                                                        setLogTarget(device)
                                                    }
                                                    aria-label={`Firmware logs ${device.serialNumber}`}
                                                >
                                                    <History className="size-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    className="text-red-500 hover:bg-red-500/10 hover:text-red-600"
                                                    onClick={() =>
                                                        setDeleteTarget(device)
                                                    }
                                                    disabled={
                                                        device.isRegistered
                                                    }
                                                    aria-label={`Delete ${device.serialNumber}`}
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
                                            No production devices found.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* Firmware Dialog */}
                <Dialog
                    open={!!firmwareTarget}
                    onOpenChange={(open) => {
                        if (!open) setFirmwareTarget(null);
                    }}
                >
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Update OTA Firmware</DialogTitle>
                            <DialogDescription>
                                {firmwareTarget?.serialNumber} · current{' '}
                                {firmwareTarget?.firmwareVersion || '—'}
                            </DialogDescription>
                        </DialogHeader>
                        <form
                            onSubmit={handleFirmwareSubmit}
                            className="grid gap-4 py-2"
                        >
                            <div className="rounded-lg border p-3 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-muted-foreground">
                                        Current file
                                    </span>
                                    <span className="max-w-[220px] truncate font-mono text-xs">
                                        {firmwareTarget?.firmwareFileName ||
                                            '—'}
                                    </span>
                                </div>
                                <div className="mt-1 flex items-center justify-between gap-3">
                                    <span className="text-muted-foreground">
                                        Size
                                    </span>
                                    <span className="font-mono text-xs">
                                        {formatBytes(
                                            firmwareTarget?.firmwareFileSize ??
                                                null,
                                        )}
                                    </span>
                                </div>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="ota_firmware_version">
                                    Firmware Version *
                                </Label>
                                <Input
                                    id="ota_firmware_version"
                                    value={firmwareForm.data.firmware_version}
                                    onChange={(e) =>
                                        firmwareForm.setData(
                                            'firmware_version',
                                            e.target.value,
                                        )
                                    }
                                    placeholder="e.g. v2.0"
                                />
                                {firmwareForm.errors.firmware_version && (
                                    <p className="text-xs text-red-500">
                                        {firmwareForm.errors.firmware_version}
                                    </p>
                                )}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="ota_firmware_file">
                                    Firmware File (.bin) *
                                </Label>
                                <Input
                                    id="ota_firmware_file"
                                    type="file"
                                    accept=".bin,application/octet-stream"
                                    ref={firmwareFileInputRef}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        firmwareForm.setData(
                                            'firmware_file',
                                            file || null,
                                        );
                                    }}
                                />
                                {firmwareForm.errors.firmware_file && (
                                    <p className="text-xs text-red-500">
                                        {firmwareForm.errors.firmware_file}
                                    </p>
                                )}
                            </div>
                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setFirmwareTarget(null)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={
                                        firmwareForm.processing ||
                                        !firmwareForm.data.firmware_version ||
                                        !firmwareForm.data.firmware_file
                                    }
                                >
                                    {firmwareForm.processing
                                        ? 'Updating…'
                                        : 'Update Firmware'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                {/* Firmware Logs Dialog */}
                <Dialog
                    open={!!logTarget}
                    onOpenChange={(open) => {
                        if (!open) setLogTarget(null);
                    }}
                >
                    <DialogContent className="sm:max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>Firmware Logs</DialogTitle>
                            <DialogDescription>
                                {logTarget?.serialNumber} · OTA update history
                            </DialogDescription>
                        </DialogHeader>
                        <div className="max-h-[420px] overflow-auto rounded-lg border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Time</TableHead>
                                        <TableHead>Version</TableHead>
                                        <TableHead>File</TableHead>
                                        <TableHead>User</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {logTarget?.firmwareLogs.map((log) => (
                                        <TableRow key={log.id}>
                                            <TableCell className="font-mono text-xs text-muted-foreground">
                                                {log.createdAt || '—'}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">
                                                {log.fromVersion || '—'} -&gt;{' '}
                                                {log.toVersion || '—'}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="max-w-[210px] truncate text-xs">
                                                        {log.fileName || '—'}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {formatBytes(
                                                            log.fileSize,
                                                        )}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {log.userName || 'System'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {(!logTarget ||
                                        logTarget.firmwareLogs.length ===
                                            0) && (
                                        <TableRow>
                                            <TableCell
                                                colSpan={4}
                                                className="py-8 text-center text-muted-foreground"
                                            >
                                                No firmware logs yet.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Delete Dialog */}
                <AlertDialog
                    open={!!deleteTarget}
                    onOpenChange={(open: boolean) => {
                        if (!open) setDeleteTarget(null);
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                Delete Production Device
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to delete{' '}
                                <strong>{deleteTarget?.serialNumber}</strong>?
                                This action cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={handleDelete}
                                className="bg-red-600 hover:bg-red-700"
                            >
                                Delete Device
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </AppLayout>
    );
}
