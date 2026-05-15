import { Head, router, useForm, usePage } from '@inertiajs/react';
import {
    Box,
    Code2,
    Download,
    Edit2,
    History,
    ImagePlus,
    Layers,
    Loader2,
    Package,
    Plus,
    Search,
    Trash2,
    UploadCloud,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Textarea } from '@/components/ui/textarea';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

interface DeviceModelItem {
    id: number;
    name: string;
    description: string | null;
    channelCount: number;
    image: string | null;
    firmwareVersion: string | null;
    firmwareFileName: string | null;
    firmwareFileUrl: string | null;
    firmwareFileSize: number | null;
    firmwareUploadedAt: string | null;
    firmwareLogs: DeviceModelFirmwareLogItem[];
    createdAt: string | null;
}

interface DeviceModelFirmwareLogItem {
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

interface ModelsPageProps {
    models: DeviceModelItem[];
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Production', href: '/production' },
    { title: 'Models', href: '/production/models' },
];

function formatBytes(bytes: number | null) {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
}

export default function ModelsIndex({ models }: ModelsPageProps) {
    const { t } = useTranslation();
    const { flash } = usePage<{ flash: { success?: string; error?: string } }>().props;
    const [search, setSearch] = useState('');
    const [addOpen, setAddOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<DeviceModelItem | null>(null);
    const [firmwareTarget, setFirmwareTarget] = useState<DeviceModelItem | null>(null);
    const [logTarget, setLogTarget] = useState<DeviceModelItem | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<DeviceModelItem | null>(null);
    const flashMsg = flash?.success
        ? { type: 'success' as const, text: flash.success }
        : flash?.error
          ? { type: 'error' as const, text: flash.error }
          : null;

    // Image preview states
    const [addPreview, setAddPreview] = useState<string | null>(null);
    const [editPreview, setEditPreview] = useState<string | null>(null);
    const addFileRef = useRef<HTMLInputElement>(null);
    const editFileRef = useRef<HTMLInputElement>(null);
    const firmwareFileRef = useRef<HTMLInputElement>(null);

    const createForm = useForm<{ name: string; description: string; channel_count: number; image: File | null }>({
        name: '',
        description: '',
        channel_count: 0,
        image: null,
    });

    const editForm = useForm<{ name: string; description: string; channel_count: number; image: File | null }>({
        name: '',
        description: '',
        channel_count: 0,
        image: null,
    });

    const firmwareForm = useForm<{
        firmware_version: string;
        firmware_file: File | null;
    }>({
        firmware_version: '',
        firmware_file: null,
    });

    const filtered = useMemo(() => {
        if (!search) return models;
        const q = search.toLowerCase();
        return models.filter(
            (m) =>
                m.name.toLowerCase().includes(q) ||
                (m.description && m.description.toLowerCase().includes(q)),
        );
    }, [models, search]);

    // ─── Create ──────────────────────────────────────────
    function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        createForm.post('/production/models', {
            forceFormData: true,
            onSuccess: () => {
                setAddOpen(false);
                createForm.reset();
                setAddPreview(null);
            },
        });
    }

    // ─── Edit ────────────────────────────────────────────
    function openEdit(model: DeviceModelItem) {
        editForm.setData({
            name: model.name,
            description: model.description || '',
            channel_count: model.channelCount,
            image: null,
        });
        editForm.clearErrors();
        setEditPreview(model.image);
        setEditTarget(model);
    }

    function handleEdit(e: React.FormEvent) {
        e.preventDefault();
        if (!editTarget) return;
        editForm.post(`/production/models/${editTarget.id}`, {
            forceFormData: true,
            onSuccess: () => {
                setEditTarget(null);
                editForm.reset();
                setEditPreview(null);
            },
        });
    }

    function openFirmwareDialog(model: DeviceModelItem) {
        setFirmwareTarget(model);
        firmwareForm.clearErrors();
        firmwareForm.setData({
            firmware_version: model.firmwareVersion || '',
            firmware_file: null,
        });
        if (firmwareFileRef.current) firmwareFileRef.current.value = '';
    }

    function handleFirmwareSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!firmwareTarget || !firmwareForm.data.firmware_file) return;

        firmwareForm.post(`/production/models/${firmwareTarget.id}/firmware`, {
            forceFormData: true,
            onSuccess: () => {
                setFirmwareTarget(null);
                firmwareForm.reset();
                if (firmwareFileRef.current) firmwareFileRef.current.value = '';
            },
        });
    }

    // ─── Delete ──────────────────────────────────────────
    function handleDelete() {
        if (!deleteTarget) return;
        router.delete(`/production/models/${deleteTarget.id}`, {
            onSuccess: () => setDeleteTarget(null),
        });
    }

    // ─── Image helpers ───────────────────────────────────
    function handleAddImage(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (file) {
            createForm.setData('image', file);
            setAddPreview(URL.createObjectURL(file));
        }
    }

    function handleEditImage(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (file) {
            editForm.setData('image', file);
            setEditPreview(URL.createObjectURL(file));
        }
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('models.title')} />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* Flash message */}
                {flashMsg && (
                    <div className={`rounded-lg border px-4 py-3 text-sm ${flashMsg.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700' : 'border-red-500/30 bg-red-500/10 text-red-700'}`}>
                        <span>{flashMsg.text}</span>
                    </div>
                )}

                {/* Header */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{t('models.title')}</h1>
                        <p className="text-sm text-muted-foreground">
                            {t('models.description', { count: models.length })}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder={t('models.search_placeholder')}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full pl-9 sm:w-[240px]"
                            />
                        </div>
                        <Button className="gap-1.5" onClick={() => setAddOpen(true)}>
                            <Plus className="size-4" />
                            {t('models.add_model')}
                        </Button>
                    </div>
                </div>

                {/* Card Grid */}
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
                        <Package className="mb-3 size-10 text-muted-foreground/40" />
                        <p className="text-muted-foreground">{t('models.no_models')}</p>
                    </div>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {filtered.map((model) => (
                            <Card key={model.id} className="group overflow-hidden transition-shadow hover:shadow-lg">
                                {/* Image */}
                                <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                                    {model.image ? (
                                        <img
                                            src={model.image}
                                            alt={model.name}
                                            className="h-full w-full object-contain p-4 transition-transform duration-300 group-hover:scale-105"
                                        />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center">
                                            <Box className="size-12 text-muted-foreground/30" />
                                        </div>
                                    )}
                                    {/* Action overlay */}
                                    <div className="absolute inset-0 flex items-start justify-end gap-1 bg-gradient-to-b from-black/40 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                                        <Button
                                            size="icon"
                                            variant="secondary"
                                            className="size-8 rounded-full shadow-md"
                                            onClick={() => openEdit(model)}
                                        >
                                            <Edit2 className="size-3.5" />
                                        </Button>
                                        <Button
                                            size="icon"
                                            variant="secondary"
                                            className="size-8 rounded-full text-red-500 shadow-md hover:bg-red-500 hover:text-white"
                                            onClick={() => setDeleteTarget(model)}
                                        >
                                            <Trash2 className="size-3.5" />
                                        </Button>
                                    </div>
                                </div>
                                <CardContent className="p-4">
                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className="font-semibold">{model.name}</h3>
                                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                                            <Layers className="size-3" />
                                            {model.channelCount} ch
                                        </span>
                                    </div>
                                    {model.description && (
                                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{model.description}</p>
                                    )}
                                    <div className="mt-3 rounded-lg border p-3 text-xs">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-muted-foreground">OTA</span>
                                            <span className="font-mono font-medium">{model.firmwareVersion || '—'}</span>
                                        </div>
                                        <div className="mt-1 truncate font-mono text-muted-foreground">
                                            {model.firmwareFileName || 'No firmware file'}
                                        </div>
                                    </div>
                                    <div className="mt-3 flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="flex-1 gap-1.5"
                                            onClick={() => openFirmwareDialog(model)}
                                        >
                                            <UploadCloud className="size-3.5" />
                                            Upload OTA
                                        </Button>
                                        {model.firmwareFileUrl && (
                                            <Button variant="outline" size="icon-sm" asChild>
                                                <a href={model.firmwareFileUrl} target="_blank" rel="noreferrer" aria-label={`Download firmware ${model.name}`}>
                                                    <Download className="size-3.5" />
                                                </a>
                                            </Button>
                                        )}
                                        <Button variant="outline" size="icon-sm" asChild>
                                            <a
                                                href={`/api/v1/production/models/${encodeURIComponent(model.name)}/firmware`}
                                                target="_blank"
                                                rel="noreferrer"
                                                aria-label={`Check firmware API ${model.name}`}
                                            >
                                                <Code2 className="size-3.5" />
                                            </a>
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="icon-sm"
                                            onClick={() => setLogTarget(model)}
                                            aria-label={`Firmware logs ${model.name}`}
                                        >
                                            <History className="size-3.5" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

                {/* ═══ Add Model Dialog ═══ */}
                <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) { createForm.reset(); setAddPreview(null); } }}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>{t('models.add_model')}</DialogTitle>
                            <DialogDescription>{t('models.add_description')}</DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleCreate} className="grid gap-4 py-2">
                            {/* Image Upload */}
                            <div className="grid gap-2">
                                <Label>{t('models.image')}</Label>
                                <div
                                    className="group/upload relative flex aspect-[4/3] w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/50 transition-colors hover:border-primary/50 hover:bg-muted"
                                    onClick={() => addFileRef.current?.click()}
                                >
                                    {addPreview ? (
                                        <img src={addPreview} alt="Preview" className="h-full w-full object-cover" />
                                    ) : (
                                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                            <ImagePlus className="size-8" />
                                            <span className="text-xs">{t('models.click_to_upload')}</span>
                                        </div>
                                    )}
                                </div>
                                <input
                                    ref={addFileRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    className="hidden"
                                    onChange={handleAddImage}
                                />
                                {createForm.errors.image && <p className="text-xs text-red-500">{createForm.errors.image}</p>}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="add_name">{t('models.name')} *</Label>
                                <Input
                                    id="add_name"
                                    value={createForm.data.name}
                                    onChange={(e) => createForm.setData('name', e.target.value)}
                                    placeholder={t('models.name_placeholder')}
                                />
                                {createForm.errors.name && <p className="text-xs text-red-500">{createForm.errors.name}</p>}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="add_channels">Jumlah Channel *</Label>
                                <Input
                                    id="add_channels"
                                    type="number"
                                    min={0}
                                    max={255}
                                    value={createForm.data.channel_count}
                                    onChange={(e) => createForm.setData('channel_count', parseInt(e.target.value) || 0)}
                                    placeholder="e.g. 8"
                                />
                                {createForm.errors.channel_count && <p className="text-xs text-red-500">{createForm.errors.channel_count}</p>}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="add_desc">{t('models.description_label')}</Label>
                                <Textarea
                                    id="add_desc"
                                    value={createForm.data.description}
                                    onChange={(e) => createForm.setData('description', e.target.value)}
                                    placeholder={t('models.description_placeholder')}
                                    rows={3}
                                />
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => { setAddOpen(false); createForm.reset(); setAddPreview(null); }}>
                                    {t('common.cancel')}
                                </Button>
                                <Button type="submit" disabled={createForm.processing}>
                                    {createForm.processing ? <><Loader2 className="mr-2 size-4 animate-spin" />{t('common.saving')}</> : t('models.create')}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                {/* ═══ Edit Model Dialog ═══ */}
                <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) { setEditTarget(null); setEditPreview(null); } }}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>{t('models.edit_model')}</DialogTitle>
                            <DialogDescription>{t('models.edit_description')}</DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleEdit} className="grid gap-4 py-2">
                            {/* Image Upload */}
                            <div className="grid gap-2">
                                <Label>{t('models.image')}</Label>
                                <div
                                    className="group/upload relative flex aspect-[4/3] w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/50 transition-colors hover:border-primary/50 hover:bg-muted"
                                    onClick={() => editFileRef.current?.click()}
                                >
                                    {editPreview ? (
                                        <img src={editPreview} alt="Preview" className="h-full w-full object-cover" />
                                    ) : (
                                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                            <ImagePlus className="size-8" />
                                            <span className="text-xs">{t('models.click_to_upload')}</span>
                                        </div>
                                    )}
                                </div>
                                <input
                                    ref={editFileRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    className="hidden"
                                    onChange={handleEditImage}
                                />
                                {editForm.errors.image && <p className="text-xs text-red-500">{editForm.errors.image}</p>}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit_name">{t('models.name')} *</Label>
                                <Input
                                    id="edit_name"
                                    value={editForm.data.name}
                                    onChange={(e) => editForm.setData('name', e.target.value)}
                                />
                                {editForm.errors.name && <p className="text-xs text-red-500">{editForm.errors.name}</p>}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit_channels">Jumlah Channel *</Label>
                                <Input
                                    id="edit_channels"
                                    type="number"
                                    min={0}
                                    max={255}
                                    value={editForm.data.channel_count}
                                    onChange={(e) => editForm.setData('channel_count', parseInt(e.target.value) || 0)}
                                />
                                {editForm.errors.channel_count && <p className="text-xs text-red-500">{editForm.errors.channel_count}</p>}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit_desc">{t('models.description_label')}</Label>
                                <Textarea
                                    id="edit_desc"
                                    value={editForm.data.description}
                                    onChange={(e) => editForm.setData('description', e.target.value)}
                                    rows={3}
                                />
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => { setEditTarget(null); setEditPreview(null); }}>
                                    {t('common.cancel')}
                                </Button>
                                <Button type="submit" disabled={editForm.processing}>
                                    {editForm.processing ? <><Loader2 className="mr-2 size-4 animate-spin" />{t('common.saving')}</> : t('common.save')}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                {/* ═══ Firmware Dialog ═══ */}
                <Dialog open={!!firmwareTarget} onOpenChange={(open) => { if (!open) setFirmwareTarget(null); }}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Upload OTA Firmware</DialogTitle>
                            <DialogDescription>
                                {firmwareTarget?.name} · current {firmwareTarget?.firmwareVersion || '—'}
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleFirmwareSubmit} className="grid gap-4 py-2">
                            <div className="rounded-lg border p-3 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-muted-foreground">Current file</span>
                                    <span className="max-w-[220px] truncate font-mono text-xs">
                                        {firmwareTarget?.firmwareFileName || '—'}
                                    </span>
                                </div>
                                <div className="mt-1 flex items-center justify-between gap-3">
                                    <span className="text-muted-foreground">Size</span>
                                    <span className="font-mono text-xs">
                                        {formatBytes(firmwareTarget?.firmwareFileSize ?? null)}
                                    </span>
                                </div>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="model_ota_firmware_version">Firmware Version *</Label>
                                <Input
                                    id="model_ota_firmware_version"
                                    value={firmwareForm.data.firmware_version}
                                    onChange={(e) => firmwareForm.setData('firmware_version', e.target.value)}
                                    placeholder="e.g. v2.0"
                                />
                                {firmwareForm.errors.firmware_version && (
                                    <p className="text-xs text-red-500">{firmwareForm.errors.firmware_version}</p>
                                )}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="model_ota_firmware_file">Firmware File (.bin) *</Label>
                                <Input
                                    id="model_ota_firmware_file"
                                    type="file"
                                    accept=".bin,application/octet-stream"
                                    ref={firmwareFileRef}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        firmwareForm.setData('firmware_file', file || null);
                                    }}
                                />
                                {firmwareForm.errors.firmware_file && (
                                    <p className="text-xs text-red-500">{firmwareForm.errors.firmware_file}</p>
                                )}
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setFirmwareTarget(null)}>
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
                                    {firmwareForm.processing ? 'Uploading…' : 'Upload Firmware'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                {/* ═══ Firmware Logs Dialog ═══ */}
                <Dialog open={!!logTarget} onOpenChange={(open) => { if (!open) setLogTarget(null); }}>
                    <DialogContent className="sm:max-w-xl">
                        <DialogHeader>
                            <DialogTitle>Firmware Logs</DialogTitle>
                            <DialogDescription>
                                {logTarget?.name} · OTA update history
                            </DialogDescription>
                        </DialogHeader>
                        <div className="max-h-[420px] overflow-auto rounded-lg border">
                            {logTarget?.firmwareLogs.length ? (
                                <div className="divide-y">
                                    {logTarget.firmwareLogs.map((log) => (
                                        <div key={log.id} className="grid gap-1 p-3 text-sm">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="font-mono text-xs text-muted-foreground">{log.createdAt || '—'}</span>
                                                <span className="font-mono text-xs">{log.fromVersion || '—'} -&gt; {log.toVersion || '—'}</span>
                                            </div>
                                            <div className="truncate text-xs">{log.fileName || '—'}</div>
                                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                <span>{formatBytes(log.fileSize)}</span>
                                                <span>{log.userName || 'System'}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="py-8 text-center text-sm text-muted-foreground">No firmware logs yet.</div>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>

                {/* ═══ Delete Dialog ═══ */}
                <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{t('models.delete_model')}</AlertDialogTitle>
                            <AlertDialogDescription>
                                {t('models.delete_confirm', { name: deleteTarget?.name })}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                                {t('common.delete')}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </AppLayout>
    );
}
