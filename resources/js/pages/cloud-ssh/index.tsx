import { Head, router, useForm, usePage } from '@inertiajs/react';
import {
    Edit2,
    Globe2,
    LoaderCircle,
    Plus,
    Server,
    TerminalSquare,
    Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import AppLayout from '@/layouts/app-layout';
import {
    isLoggerSelectionDisabled,
    updateLoggerSelection,
} from '@/pages/cloud-ssh/logger-selection';
import type { BreadcrumbItem } from '@/types';

interface RemoteDeviceItem {
    id: number;
    name: string;
    host: string;
    port: number;
    username: string;
    description: string | null;
    webEnabled: boolean;
    webSlug: string | null;
    webPort: number;
    webUrl: string | null;
    loggerIds: number[];
    createdAt: string | null;
}

interface LoggerChoice {
    id: number;
    name: string;
    serialNumber: string;
    remoteDeviceId: number | null;
    remoteDeviceName: string | null;
}

interface DeviceFormData {
    name: string;
    host: string;
    port: number;
    username: string;
    description: string;
    web_enabled: boolean;
    web_port: number;
    logger_ids: number[];
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Akses Perangkat', href: '/cloud-ssh' },
];

const emptyForm: DeviceFormData = {
    name: '',
    host: '',
    port: 22,
    username: '',
    description: '',
    web_enabled: false,
    web_port: 80,
    logger_ids: [],
};

export default function CloudSshIndex({
    devices,
    availableLoggers,
}: {
    devices: RemoteDeviceItem[];
    availableLoggers: LoggerChoice[];
}) {
    const { auth, flash } = usePage<{
        auth: { permissions?: string[] };
        flash: { success?: string; error?: string };
    }>().props;
    const permissions = auth.permissions ?? [];
    const canSshConnect = permissions.includes('cloudssh.connect');
    const canWebConnect = permissions.includes('cloudweb.connect');
    const canManage = permissions.includes('cloudssh.manage');

    const [createOpen, setCreateOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<RemoteDeviceItem | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<RemoteDeviceItem | null>(
        null,
    );
    const [openingWebId, setOpeningWebId] = useState<number | null>(null);
    const [webError, setWebError] = useState<string | null>(null);

    // Flash diturunkan dari props; dismissedFor menandai flash yang sudah lewat masa tampilnya.
    const [dismissedFor, setDismissedFor] = useState<typeof flash | null>(null);
    const flashMsg =
        dismissedFor !== flash && (flash?.success || flash?.error)
            ? flash.success
                ? { type: 'success' as const, text: flash.success }
                : { type: 'error' as const, text: flash.error! }
            : null;

    useEffect(() => {
        if (!flash?.success && !flash?.error) return;
        const timer = setTimeout(() => setDismissedFor(flash), 4000);
        return () => clearTimeout(timer);
    }, [flash]);

    const createForm = useForm<DeviceFormData>(emptyForm);
    const editForm = useForm<DeviceFormData>(emptyForm);

    function submitCreate(e: React.FormEvent) {
        e.preventDefault();
        createForm.post('/cloud-ssh', {
            onSuccess: () => {
                setCreateOpen(false);
                createForm.reset();
            },
        });
    }

    function openEdit(device: RemoteDeviceItem) {
        editForm.setData({
            name: device.name,
            host: device.host,
            port: device.port,
            username: device.username,
            description: device.description ?? '',
            web_enabled: device.webEnabled,
            web_port: device.webPort,
            logger_ids: device.loggerIds,
        });
        setEditTarget(device);
    }

    function submitEdit(e: React.FormEvent) {
        e.preventDefault();
        if (!editTarget) return;
        editForm.put(`/cloud-ssh/${editTarget.id}`, {
            onSuccess: () => setEditTarget(null),
        });
    }

    function confirmDelete() {
        if (!deleteTarget) return;
        router.delete(`/cloud-ssh/${deleteTarget.id}`, {
            onFinish: () => setDeleteTarget(null),
        });
    }

    async function openWeb(device: RemoteDeviceItem) {
        setOpeningWebId(device.id);
        setWebError(null);

        try {
            const xsrfCookie = document.cookie
                .split(';')
                .map((cookie) => cookie.trim())
                .find((cookie) => cookie.startsWith('XSRF-TOKEN='));
            const headers: Record<string, string> = {
                Accept: 'application/json',
            };

            if (xsrfCookie) {
                headers['X-XSRF-TOKEN'] = decodeURIComponent(
                    xsrfCookie.slice('XSRF-TOKEN='.length),
                );
            } else {
                headers['X-CSRF-TOKEN'] =
                    document
                        .querySelector('meta[name="csrf-token"]')
                        ?.getAttribute('content') ?? '';
            }

            const response = await fetch(`/cloud-web/${device.id}/session`, {
                method: 'POST',
                headers,
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data: { url: string } = await response.json();
            window.location.assign(data.url);
        } catch (error) {
            setWebError(
                `Gagal membuka web perangkat: ${error instanceof Error ? error.message : String(error)}`,
            );
            setOpeningWebId(null);
        }
    }

    function renderFormFields(
        form: typeof createForm,
        prefix: string,
        webUrl: string | null = null,
    ) {
        return (
            <div className="grid gap-4">
                <div className="grid gap-2">
                    <Label htmlFor={`${prefix}-name`}>Nama</Label>
                    <Input
                        id={`${prefix}-name`}
                        value={form.data.name}
                        onChange={(e) => form.setData('name', e.target.value)}
                        placeholder="Modul AI"
                    />
                    {form.errors.name && (
                        <p className="text-sm text-destructive">
                            {form.errors.name}
                        </p>
                    )}
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 grid gap-2">
                        <Label htmlFor={`${prefix}-host`}>Host / IP</Label>
                        <Input
                            id={`${prefix}-host`}
                            value={form.data.host}
                            onChange={(e) =>
                                form.setData('host', e.target.value)
                            }
                            placeholder="10.8.0.2"
                        />
                        {form.errors.host && (
                            <p className="text-sm text-destructive">
                                {form.errors.host}
                            </p>
                        )}
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor={`${prefix}-port`}>Port</Label>
                        <Input
                            id={`${prefix}-port`}
                            type="number"
                            min={1}
                            max={65535}
                            value={form.data.port}
                            onChange={(e) =>
                                form.setData('port', Number(e.target.value))
                            }
                        />
                        {form.errors.port && (
                            <p className="text-sm text-destructive">
                                {form.errors.port}
                            </p>
                        )}
                    </div>
                </div>
                <div className="grid gap-2">
                    <Label htmlFor={`${prefix}-username`}>Username SSH</Label>
                    <Input
                        id={`${prefix}-username`}
                        value={form.data.username}
                        onChange={(e) =>
                            form.setData('username', e.target.value)
                        }
                        placeholder="orangepi"
                    />
                    {form.errors.username && (
                        <p className="text-sm text-destructive">
                            {form.errors.username}
                        </p>
                    )}
                </div>
                <div className="grid gap-2">
                    <Label htmlFor={`${prefix}-description`}>
                        Deskripsi (opsional)
                    </Label>
                    <Input
                        id={`${prefix}-description`}
                        value={form.data.description}
                        onChange={(e) =>
                            form.setData('description', e.target.value)
                        }
                        placeholder="Perangkat lapangan via WireGuard"
                    />
                    {form.errors.description && (
                        <p className="text-sm text-destructive">
                            {form.errors.description}
                        </p>
                    )}
                </div>
                <div className="grid gap-3 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-4">
                        <div className="grid gap-1">
                            <Label htmlFor={`${prefix}-web-enabled`}>
                                Aktifkan akses web
                            </Label>
                            {/* <p className="text-xs text-muted-foreground">
                                Teruskan HTTP perangkat melalui alamat Cloud
                                Web.
                            </p> */}
                        </div>
                        <Checkbox
                            id={`${prefix}-web-enabled`}
                            checked={form.data.web_enabled}
                            onCheckedChange={(checked) =>
                                form.setData('web_enabled', checked === true)
                            }
                        />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                        <div className="grid gap-2">
                            <Label htmlFor={`${prefix}-web-port`}>
                                Port Web
                            </Label>
                            <Input
                                id={`${prefix}-web-port`}
                                type="number"
                                min={1}
                                max={65535}
                                disabled={!form.data.web_enabled}
                                value={form.data.web_port}
                                onChange={(e) =>
                                    form.setData(
                                        'web_port',
                                        Number(e.target.value),
                                    )
                                }
                            />
                            {form.errors.web_port && (
                                <p className="text-sm text-destructive">
                                    {form.errors.web_port}
                                </p>
                            )}
                        </div>
                        <div className="grid gap-2 sm:col-span-2">
                            <Label htmlFor={`${prefix}-web-url`}>URL Web</Label>
                            <Input
                                id={`${prefix}-web-url`}
                                readOnly
                                value={webUrl ?? ''}
                                placeholder="Dibuat otomatis setelah perangkat disimpan"
                            />
                            {/* <p className="text-xs text-muted-foreground">
                                Nama subdomain dikelola otomatis oleh server.
                            </p> */}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    function renderLoggerPicker(
        form: typeof createForm,
        prefix: string,
        currentDeviceId: number | null = null,
    ) {
        return (
            <div className="grid gap-2">
                <div className="max-h-[52vh] overflow-y-auto rounded-md border">
                    {availableLoggers.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-muted-foreground">
                            Belum ada Logger tersedia.
                        </p>
                    ) : (
                        availableLoggers.map((logger) => {
                            const disabled = isLoggerSelectionDisabled(
                                logger,
                                currentDeviceId,
                            );

                            return (
                                <label
                                    key={logger.id}
                                    htmlFor={`${prefix}-logger-${logger.id}`}
                                    className={`flex items-start gap-3 border-b px-3 py-2.5 last:border-b-0 ${
                                        disabled
                                            ? 'cursor-not-allowed bg-muted/40 text-muted-foreground'
                                            : 'cursor-pointer hover:bg-muted/30'
                                    }`}
                                >
                                    <Checkbox
                                        id={`${prefix}-logger-${logger.id}`}
                                        className="mt-0.5"
                                        checked={form.data.logger_ids.includes(
                                            logger.id,
                                        )}
                                        disabled={disabled}
                                        onCheckedChange={(checked) =>
                                            form.setData(
                                                'logger_ids',
                                                updateLoggerSelection(
                                                    form.data.logger_ids,
                                                    logger.id,
                                                    checked === true,
                                                ),
                                            )
                                        }
                                    />
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm font-medium">
                                            {logger.name}
                                        </span>
                                        <span className="block truncate text-xs text-muted-foreground">
                                            {logger.serialNumber}
                                        </span>
                                        {disabled &&
                                            logger.remoteDeviceName && (
                                                <span className="block text-xs text-amber-600 dark:text-amber-400">
                                                    Terhubung ke:{' '}
                                                    {logger.remoteDeviceName}
                                                </span>
                                            )}
                                    </span>
                                </label>
                            );
                        })
                    )}
                </div>
                {form.errors.logger_ids && (
                    <p className="text-sm text-destructive">
                        {form.errors.logger_ids}
                    </p>
                )}
            </div>
        );
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Akses Perangkat" />
            <div className="flex h-full flex-1 flex-col gap-6 p-4 md:p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                            <TerminalSquare className="size-6" />
                            Registry Akses Perangkat
                        </h1>
                    </div>
                    {canManage && (
                        <Button onClick={() => setCreateOpen(true)}>
                            <Plus className="mr-1 size-4" /> Tambah Perangkat
                        </Button>
                    )}
                </div>

                {flashMsg && (
                    <div
                        className={`rounded-md border px-4 py-2 text-sm ${
                            flashMsg.type === 'success'
                                ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
                                : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
                        }`}
                    >
                        {flashMsg.text}
                    </div>
                )}

                {webError && (
                    <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                        {webError}
                    </div>
                )}

                {devices.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                            <Server className="size-8" />
                            <p>Belum ada perangkat terdaftar.</p>
                            {canManage && (
                                <p className="text-sm">
                                    Klik "Tambah Perangkat" untuk mendaftarkan
                                    perangkat pertama.
                                </p>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {devices.map((device) => (
                            <Card key={device.id} className="py-0">
                                <CardContent className="flex flex-col gap-3 p-4">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="truncate font-medium">
                                                {device.name}
                                            </p>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1">
                                            <Badge variant="outline">SSH</Badge>
                                            {device.webEnabled && (
                                                <Badge variant="secondary">
                                                    Web
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                    {device.description && (
                                        <p className="truncate text-sm text-muted-foreground">
                                            {device.description}
                                        </p>
                                    )}
                                    {device.webEnabled && device.webUrl && (
                                        <p className="truncate text-xs text-muted-foreground">
                                            {device.webUrl}
                                        </p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-2">
                                        {canSshConnect && (
                                            <Button
                                                size="sm"
                                                onClick={() =>
                                                    router.visit(
                                                        `/cloud-ssh/${device.id}/terminal`,
                                                    )
                                                }
                                            >
                                                <TerminalSquare className="mr-1 size-4" />{' '}
                                                Buka SSH
                                            </Button>
                                        )}
                                        {canWebConnect &&
                                            device.webEnabled &&
                                            device.webSlug && (
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    disabled={
                                                        openingWebId ===
                                                        device.id
                                                    }
                                                    onClick={() =>
                                                        void openWeb(device)
                                                    }
                                                >
                                                    {openingWebId ===
                                                    device.id ? (
                                                        <LoaderCircle className="mr-1 size-4 animate-spin" />
                                                    ) : (
                                                        <Globe2 className="mr-1 size-4" />
                                                    )}
                                                    Buka Web
                                                </Button>
                                            )}
                                        {canManage && (
                                            <>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() =>
                                                        openEdit(device)
                                                    }
                                                >
                                                    <Edit2 className="size-4" />
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="text-destructive"
                                                    onClick={() =>
                                                        setDeleteTarget(device)
                                                    }
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-5xl">
                    <DialogHeader>
                        <DialogTitle>Tambah Perangkat</DialogTitle>
                        {/* <DialogDescription>
                            Perangkat harus terjangkau dari server (mis. IP
                            WireGuard 10.8.0.x).
                        </DialogDescription> */}
                    </DialogHeader>
                    <form onSubmit={submitCreate} className="grid gap-4">
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
                            <div className="grid gap-4">
                                {renderFormFields(createForm, 'create')}
                            </div>
                            <div className="grid content-start gap-2 self-start rounded-lg border bg-muted/20 p-4">
                                <Label>Project Logger</Label>
                                {renderLoggerPicker(createForm, 'create')}
                            </div>
                        </div>
                        <DialogFooter className="mt-4">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setCreateOpen(false)}
                            >
                                Batal
                            </Button>
                            <Button
                                type="submit"
                                disabled={createForm.processing}
                            >
                                Simpan
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog
                open={editTarget !== null}
                onOpenChange={(open) => !open && setEditTarget(null)}
            >
                <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-5xl">
                    <DialogHeader>
                        <DialogTitle>Edit Perangkat</DialogTitle>
                        <DialogDescription>
                            Perbarui detail koneksi perangkat.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={submitEdit} className="grid gap-4">
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
                            <div className="grid gap-4">
                                {renderFormFields(
                                    editForm,
                                    'edit',
                                    editTarget?.webUrl ?? null,
                                )}
                            </div>
                            <div className="grid content-start gap-2 self-start rounded-lg border bg-muted/20 p-4">
                                <Label>Project Logger</Label>
                                {renderLoggerPicker(
                                    editForm,
                                    'edit',
                                    editTarget?.id ?? null,
                                )}
                            </div>
                        </div>
                        <DialogFooter className="mt-4">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setEditTarget(null)}
                            >
                                Batal
                            </Button>
                            <Button
                                type="submit"
                                disabled={editForm.processing}
                            >
                                Simpan
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <AlertDialog
                open={deleteTarget !== null}
                onOpenChange={(open) => !open && setDeleteTarget(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Hapus perangkat?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Perangkat "{deleteTarget?.name}" akan dihapus dari
                            registry. Koneksi SSH dan layanan Web pada perangkat
                            tidak ikut diubah.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            className="bg-destructive text-white hover:bg-destructive/90"
                        >
                            Hapus
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </AppLayout>
    );
}
