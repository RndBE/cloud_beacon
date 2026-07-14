import { Head, router, useForm, usePage } from '@inertiajs/react';
import { Edit2, Plus, Server, TerminalSquare, Trash2 } from 'lucide-react';
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
import type { BreadcrumbItem } from '@/types';

interface RemoteDeviceItem {
    id: number;
    name: string;
    host: string;
    port: number;
    username: string;
    description: string | null;
    createdAt: string | null;
}

interface DeviceFormData {
    name: string;
    host: string;
    port: number;
    username: string;
    description: string;
}

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Cloud SSH', href: '/cloud-ssh' }];

const emptyForm: DeviceFormData = { name: '', host: '', port: 22, username: '', description: '' };

export default function CloudSshIndex({ devices }: { devices: RemoteDeviceItem[] }) {
    const { auth, flash } = usePage<{
        auth: { permissions?: string[] };
        flash: { success?: string; error?: string };
    }>().props;
    const permissions = auth.permissions ?? [];
    const canConnect = permissions.includes('cloudssh.connect');
    const canManage = permissions.includes('cloudssh.manage');

    const [createOpen, setCreateOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<RemoteDeviceItem | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<RemoteDeviceItem | null>(null);

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

    function renderFormFields(form: typeof createForm, prefix: string) {
        return (
            <div className="grid gap-4">
                <div className="grid gap-2">
                    <Label htmlFor={`${prefix}-name`}>Nama</Label>
                    <Input
                        id={`${prefix}-name`}
                        value={form.data.name}
                        onChange={(e) => form.setData('name', e.target.value)}
                        placeholder="Modul AI (Orange Pi)"
                    />
                    {form.errors.name && <p className="text-sm text-destructive">{form.errors.name}</p>}
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 grid gap-2">
                        <Label htmlFor={`${prefix}-host`}>Host / IP</Label>
                        <Input
                            id={`${prefix}-host`}
                            value={form.data.host}
                            onChange={(e) => form.setData('host', e.target.value)}
                            placeholder="10.8.0.2"
                        />
                        {form.errors.host && <p className="text-sm text-destructive">{form.errors.host}</p>}
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor={`${prefix}-port`}>Port</Label>
                        <Input
                            id={`${prefix}-port`}
                            type="number"
                            min={1}
                            max={65535}
                            value={form.data.port}
                            onChange={(e) => form.setData('port', Number(e.target.value))}
                        />
                        {form.errors.port && <p className="text-sm text-destructive">{form.errors.port}</p>}
                    </div>
                </div>
                <div className="grid gap-2">
                    <Label htmlFor={`${prefix}-username`}>Username SSH</Label>
                    <Input
                        id={`${prefix}-username`}
                        value={form.data.username}
                        onChange={(e) => form.setData('username', e.target.value)}
                        placeholder="orangepi"
                    />
                    {form.errors.username && <p className="text-sm text-destructive">{form.errors.username}</p>}
                </div>
                <div className="grid gap-2">
                    <Label htmlFor={`${prefix}-description`}>Deskripsi (opsional)</Label>
                    <Input
                        id={`${prefix}-description`}
                        value={form.data.description}
                        onChange={(e) => form.setData('description', e.target.value)}
                        placeholder="Orange Pi RK3588 via WireGuard"
                    />
                    {form.errors.description && <p className="text-sm text-destructive">{form.errors.description}</p>}
                </div>
            </div>
        );
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Cloud SSH" />
            <div className="flex h-full flex-1 flex-col gap-4 p-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-semibold">Cloud SSH</h1>
                        <p className="text-sm text-muted-foreground">
                            Terminal SSH ke perangkat lapangan lewat tunnel WireGuard.
                        </p>
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

                {devices.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                            <Server className="size-8" />
                            <p>Belum ada perangkat terdaftar.</p>
                            {canManage && <p className="text-sm">Klik "Tambah Perangkat" untuk mendaftarkan perangkat pertama.</p>}
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {devices.map((device) => (
                            <Card key={device.id}>
                                <CardContent className="flex flex-col gap-3 p-4">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="truncate font-medium">{device.name}</p>
                                            <p className="truncate text-sm text-muted-foreground">
                                                {device.username}@{device.host}:{device.port}
                                            </p>
                                        </div>
                                        <Badge variant="outline" className="shrink-0">
                                            SSH
                                        </Badge>
                                    </div>
                                    {device.description && (
                                        <p className="truncate text-sm text-muted-foreground">{device.description}</p>
                                    )}
                                    <div className="flex items-center gap-2">
                                        {canConnect && (
                                            <Button size="sm" onClick={() => router.visit(`/cloud-ssh/${device.id}/terminal`)}>
                                                <TerminalSquare className="mr-1 size-4" /> Connect
                                            </Button>
                                        )}
                                        {canManage && (
                                            <>
                                                <Button size="sm" variant="outline" onClick={() => openEdit(device)}>
                                                    <Edit2 className="size-4" />
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="text-destructive"
                                                    onClick={() => setDeleteTarget(device)}
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
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Tambah Perangkat</DialogTitle>
                        <DialogDescription>Perangkat harus terjangkau dari server (mis. IP WireGuard 10.8.0.x).</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={submitCreate}>
                        {renderFormFields(createForm, 'create')}
                        <DialogFooter className="mt-4">
                            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                                Batal
                            </Button>
                            <Button type="submit" disabled={createForm.processing}>
                                Simpan
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Perangkat</DialogTitle>
                        <DialogDescription>Perbarui detail koneksi perangkat.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={submitEdit}>
                        {renderFormFields(editForm, 'edit')}
                        <DialogFooter className="mt-4">
                            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
                                Batal
                            </Button>
                            <Button type="submit" disabled={editForm.processing}>
                                Simpan
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Hapus perangkat?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Perangkat "{deleteTarget?.name}" akan dihapus dari daftar. Koneksi SSH-nya sendiri tidak berubah.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-white hover:bg-destructive/90">
                            Hapus
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </AppLayout>
    );
}
