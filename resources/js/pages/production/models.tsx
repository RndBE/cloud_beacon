import { Head, router, useForm, usePage } from '@inertiajs/react';
import {
    Box,
    Edit2,
    ImagePlus,
    Loader2,
    Package,
    Plus,
    Search,
    Trash2,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
    image: string | null;
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

export default function ModelsIndex({ models }: ModelsPageProps) {
    const { t } = useTranslation();
    const { flash } = usePage<{ flash: { success?: string; error?: string } }>().props;
    const [search, setSearch] = useState('');
    const [addOpen, setAddOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<DeviceModelItem | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<DeviceModelItem | null>(null);
    const [flashMsg, setFlashMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Image preview states
    const [addPreview, setAddPreview] = useState<string | null>(null);
    const [editPreview, setEditPreview] = useState<string | null>(null);
    const addFileRef = useRef<HTMLInputElement>(null);
    const editFileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (flash?.success) setFlashMsg({ type: 'success', text: flash.success });
        else if (flash?.error) setFlashMsg({ type: 'error', text: flash.error });
        if (flashMsg) {
            const timer = setTimeout(() => setFlashMsg(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [flash]);

    const createForm = useForm<{ name: string; description: string; image: File | null }>({
        name: '',
        description: '',
        image: null,
    });

    const editForm = useForm<{ name: string; description: string; image: File | null }>({
        name: '',
        description: '',
        image: null,
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
                    <div className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${flashMsg.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700' : 'border-red-500/30 bg-red-500/10 text-red-700'}`}>
                        <span>{flashMsg.text}</span>
                        <button onClick={() => setFlashMsg(null)}><X className="size-4" /></button>
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
                                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
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
                                    <h3 className="font-semibold">{model.name}</h3>
                                    {model.description && (
                                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{model.description}</p>
                                    )}
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
