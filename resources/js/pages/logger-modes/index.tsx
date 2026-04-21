import { Head, router, useForm, usePage } from '@inertiajs/react';
import {
    AlertTriangle,
    ChevronRight,
    Edit2,
    Loader2,
    Minus,
    Plus,
    Radio,
    Search,
    Settings,
    SlidersHorizontal,
    Trash2,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

interface CalibrationField {
    key: string;
    label: string;
    unit: string;
    type: 'number';
    min?: number;
    step?: number;
}

interface LoggerModeItem {
    id: number;
    slug: string;
    label: string;
    group: string;
    hasCalibration: boolean;
    calibrationFields: CalibrationField[] | null;
    description: string | null;
    loggersCount: number;
    createdAt: string | null;
}

interface ModeFormData {
    slug: string;
    label: string;
    group: string;
    has_calibration: boolean;
    calibration_fields: CalibrationField[];
    description: string;
}

const EMPTY_FIELD: CalibrationField = { key: '', label: '', unit: '', type: 'number', min: 0, step: 0.01 };

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Logger Modes', href: '/logger-modes' },
];

export default function LoggerModesIndex({ modes }: { modes: LoggerModeItem[] }) {
    const { t } = useTranslation();
    const { flash } = usePage<{ flash: { success?: string; error?: string } }>().props;
    const [search, setSearch] = useState('');
    const [addOpen, setAddOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<LoggerModeItem | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<LoggerModeItem | null>(null);
    const [flashMsg, setFlashMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        if (flash?.success) setFlashMsg({ type: 'success', text: flash.success });
        else if (flash?.error) setFlashMsg({ type: 'error', text: flash.error });
    }, [flash]);

    useEffect(() => {
        if (flashMsg) {
            const timer = setTimeout(() => setFlashMsg(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [flashMsg]);

    const createForm = useForm<ModeFormData>({
        slug: '',
        label: '',
        group: '',
        has_calibration: false,
        calibration_fields: [],
        description: '',
    });

    const editForm = useForm<ModeFormData>({
        slug: '',
        label: '',
        group: '',
        has_calibration: false,
        calibration_fields: [],
        description: '',
    });

    const filtered = useMemo(() => {
        if (!search) return modes;
        const q = search.toLowerCase();
        return modes.filter(
            (m) =>
                m.slug.toLowerCase().includes(q) ||
                m.label.toLowerCase().includes(q) ||
                m.group.toLowerCase().includes(q) ||
                (m.description && m.description.toLowerCase().includes(q)),
        );
    }, [modes, search]);

    // Group modes by group name
    const grouped = useMemo(() => {
        const groups: Record<string, LoggerModeItem[]> = {};
        for (const mode of filtered) {
            if (!groups[mode.group]) groups[mode.group] = [];
            groups[mode.group].push(mode);
        }
        return groups;
    }, [filtered]);

    // ─── Create ──────────────────────────────────────────
    function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        const data = { ...createForm.data };
        if (!data.has_calibration) {
            data.calibration_fields = [];
        }
        createForm.post('/logger-modes', {
            onSuccess: () => {
                setAddOpen(false);
                createForm.reset();
            },
        });
    }

    // ─── Edit ────────────────────────────────────────────
    function openEdit(mode: LoggerModeItem) {
        editForm.setData({
            slug: mode.slug,
            label: mode.label,
            group: mode.group,
            has_calibration: mode.hasCalibration,
            calibration_fields: mode.calibrationFields || [],
            description: mode.description || '',
        });
        editForm.clearErrors();
        setEditTarget(mode);
    }

    function handleEdit(e: React.FormEvent) {
        e.preventDefault();
        if (!editTarget) return;
        editForm.put(`/logger-modes/${editTarget.id}`, {
            onSuccess: () => {
                setEditTarget(null);
                editForm.reset();
            },
        });
    }

    // ─── Delete ──────────────────────────────────────────
    function handleDelete() {
        if (!deleteTarget) return;
        router.delete(`/logger-modes/${deleteTarget.id}`, {
            onSuccess: () => setDeleteTarget(null),
        });
    }

    // ─── Calibration field helpers ───────────────────────
    function addCalibrationField(form: ReturnType<typeof useForm<ModeFormData>>) {
        form.setData('calibration_fields', [...form.data.calibration_fields, { ...EMPTY_FIELD }]);
    }

    function removeCalibrationField(form: ReturnType<typeof useForm<ModeFormData>>, index: number) {
        const updated = form.data.calibration_fields.filter((_, i) => i !== index);
        form.setData('calibration_fields', updated);
    }

    function updateCalibrationField(form: ReturnType<typeof useForm<ModeFormData>>, index: number, key: keyof CalibrationField, value: string | number) {
        const updated = [...form.data.calibration_fields];
        updated[index] = { ...updated[index], [key]: value };
        form.setData('calibration_fields', updated);
    }

    // ─── Reusable form fields ────────────────────────────
    function renderFormFields(form: ReturnType<typeof useForm<ModeFormData>>, prefix: string) {
        return (
            <div className="grid gap-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor={`${prefix}_slug`}>Slug *</Label>
                        <Input
                            id={`${prefix}_slug`}
                            value={form.data.slug}
                            onChange={(e) => form.setData('slug', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                            placeholder="AWLR_US"
                            className="font-mono"
                        />
                        {form.errors.slug && <p className="text-xs text-red-500">{form.errors.slug}</p>}
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor={`${prefix}_group`}>Group *</Label>
                        <Input
                            id={`${prefix}_group`}
                            value={form.data.group}
                            onChange={(e) => form.setData('group', e.target.value)}
                            placeholder="AWLR"
                        />
                        {form.errors.group && <p className="text-xs text-red-500">{form.errors.group}</p>}
                    </div>
                </div>

                <div className="grid gap-2">
                    <Label htmlFor={`${prefix}_label`}>Label *</Label>
                    <Input
                        id={`${prefix}_label`}
                        value={form.data.label}
                        onChange={(e) => form.setData('label', e.target.value)}
                        placeholder="AWLR Ultrasonic"
                    />
                    {form.errors.label && <p className="text-xs text-red-500">{form.errors.label}</p>}
                </div>

                <div className="grid gap-2">
                    <Label htmlFor={`${prefix}_desc`}>Deskripsi</Label>
                    <Textarea
                        id={`${prefix}_desc`}
                        value={form.data.description}
                        onChange={(e) => form.setData('description', e.target.value)}
                        placeholder="Penjelasan singkat tentang mode ini..."
                        rows={2}
                    />
                </div>

                <Separator />

                {/* Calibration toggle */}
                <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                        <p className="text-sm font-medium">Fitur Kalibrasi</p>
                        <p className="text-xs text-muted-foreground">Mode ini memiliki form kalibrasi?</p>
                    </div>
                    <Checkbox
                        checked={form.data.has_calibration}
                        onCheckedChange={(checked) => {
                            form.setData('has_calibration', !!checked);
                            if (checked && form.data.calibration_fields.length === 0) {
                                form.setData('calibration_fields', [{ ...EMPTY_FIELD }]);
                            }
                        }}
                    />
                </div>

                {/* Calibration fields builder */}
                {form.data.has_calibration && (
                    <div className="rounded-lg border bg-muted/30 p-3">
                        <div className="mb-3 flex items-center justify-between">
                            <p className="text-sm font-medium">Field Kalibrasi</p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 text-xs"
                                onClick={() => addCalibrationField(form)}
                            >
                                <Plus className="size-3" /> Tambah Field
                            </Button>
                        </div>
                        <div className="space-y-3">
                            {form.data.calibration_fields.map((field, i) => (
                                <div key={i} className="rounded-md border bg-background p-3">
                                    <div className="mb-2 flex items-center justify-between">
                                        <span className="text-xs font-medium text-muted-foreground">Field #{i + 1}</span>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 w-6 p-0 text-red-500 hover:text-red-600"
                                            onClick={() => removeCalibrationField(form, i)}
                                        >
                                            <Minus className="size-3.5" />
                                        </Button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <Label className="text-xs">Key</Label>
                                            <Input
                                                value={field.key}
                                                onChange={(e) => updateCalibrationField(form, i, 'key', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                                                placeholder="sumur"
                                                className="h-8 font-mono text-xs"
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-xs">Label</Label>
                                            <Input
                                                value={field.label}
                                                onChange={(e) => updateCalibrationField(form, i, 'label', e.target.value)}
                                                placeholder="Kedalaman Sumur"
                                                className="h-8 text-xs"
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-xs">Unit</Label>
                                            <Input
                                                value={field.unit}
                                                onChange={(e) => updateCalibrationField(form, i, 'unit', e.target.value)}
                                                placeholder="m"
                                                className="h-8 text-xs"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <Label className="text-xs">Min</Label>
                                                <Input
                                                    type="number"
                                                    value={field.min ?? 0}
                                                    onChange={(e) => updateCalibrationField(form, i, 'min', parseFloat(e.target.value) || 0)}
                                                    className="h-8 text-xs"
                                                />
                                            </div>
                                            <div>
                                                <Label className="text-xs">Step</Label>
                                                <Input
                                                    type="number"
                                                    value={field.step ?? 0.01}
                                                    onChange={(e) => updateCalibrationField(form, i, 'step', parseFloat(e.target.value) || 0.01)}
                                                    className="h-8 text-xs"
                                                    step={0.01}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {form.data.calibration_fields.length === 0 && (
                                <p className="py-4 text-center text-xs text-muted-foreground">Belum ada field. Klik "Tambah Field" untuk menambahkan.</p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Logger Modes" />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* Flash message */}
                {flashMsg && (
                    <div className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${flashMsg.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400'}`}>
                        <span>{flashMsg.text}</span>
                        <button onClick={() => setFlashMsg(null)}><X className="size-4" /></button>
                    </div>
                )}

                {/* Header */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Logger Modes</h1>
                        <p className="text-sm text-muted-foreground">
                            Kelola mode operasi logger. {modes.length} mode terdaftar.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Cari mode..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full pl-9 sm:w-[240px]"
                            />
                        </div>
                        <Button className="gap-1.5" onClick={() => { createForm.reset(); setAddOpen(true); }}>
                            <Plus className="size-4" />
                            Tambah Mode
                        </Button>
                    </div>
                </div>

                {/* Cards by group */}
                {Object.keys(grouped).length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
                        <Settings className="mb-3 size-10 text-muted-foreground/40" />
                        <p className="text-muted-foreground">Belum ada mode terdaftar.</p>
                    </div>
                ) : (
                    Object.entries(grouped).map(([group, items]) => (
                        <div key={group}>
                            <div className="mb-3 flex items-center gap-2">
                                <Badge variant="outline" className="text-xs font-semibold">
                                    {group}
                                </Badge>
                                <span className="text-xs text-muted-foreground">{items.length} mode</span>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {items.map((mode) => (
                                    <Card key={mode.id} className="group transition-shadow hover:shadow-lg">
                                        <CardContent className="p-4">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                                                        <Radio className="size-5 text-primary" />
                                                    </div>
                                                    <div>
                                                        <h3 className="font-semibold">{mode.label}</h3>
                                                        <p className="font-mono text-xs text-muted-foreground">{mode.slug}</p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="size-8"
                                                        onClick={() => openEdit(mode)}
                                                    >
                                                        <Edit2 className="size-3.5" />
                                                    </Button>
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="size-8 text-red-500 hover:text-red-600"
                                                        onClick={() => setDeleteTarget(mode)}
                                                    >
                                                        <Trash2 className="size-3.5" />
                                                    </Button>
                                                </div>
                                            </div>

                                            {mode.description && (
                                                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{mode.description}</p>
                                            )}

                                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                                {mode.hasCalibration && (
                                                    <Badge variant="secondary" className="gap-1 text-[10px]">
                                                        <SlidersHorizontal className="size-3" />
                                                        Kalibrasi ({mode.calibrationFields?.length ?? 0} field)
                                                    </Badge>
                                                )}
                                                {mode.loggersCount > 0 && (
                                                    <Badge variant="outline" className="text-[10px]">
                                                        {mode.loggersCount} logger aktif
                                                    </Badge>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    ))
                )}

                {/* ═══ Add Mode Dialog ═══ */}
                <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) createForm.reset(); }}>
                    <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Tambah Mode Baru</DialogTitle>
                            <DialogDescription>Buat mode operasi baru untuk logger.</DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleCreate}>
                            {renderFormFields(createForm, 'add')}
                            <DialogFooter className="mt-4">
                                <Button type="button" variant="outline" onClick={() => { setAddOpen(false); createForm.reset(); }}>
                                    {t('common.cancel')}
                                </Button>
                                <Button type="submit" disabled={createForm.processing}>
                                    {createForm.processing ? <><Loader2 className="mr-2 size-4 animate-spin" />Menyimpan...</> : 'Buat Mode'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                {/* ═══ Edit Mode Dialog ═══ */}
                <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
                    <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Edit Mode</DialogTitle>
                            <DialogDescription>Perbarui konfigurasi mode "{editTarget?.label}".</DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleEdit}>
                            {renderFormFields(editForm, 'edit')}
                            <DialogFooter className="mt-4">
                                <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
                                    {t('common.cancel')}
                                </Button>
                                <Button type="submit" disabled={editForm.processing}>
                                    {editForm.processing ? <><Loader2 className="mr-2 size-4 animate-spin" />Menyimpan...</> : t('common.save')}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                {/* ═══ Delete Dialog ═══ */}
                <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Hapus Mode</AlertDialogTitle>
                            <AlertDialogDescription>
                                {deleteTarget && deleteTarget.loggersCount > 0 ? (
                                    <span className="flex items-start gap-2 text-amber-600">
                                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                                        Mode "{deleteTarget.label}" masih digunakan oleh {deleteTarget.loggersCount} logger. Hapus tidak dapat dilakukan.
                                    </span>
                                ) : (
                                    <>Yakin ingin menghapus mode "<strong>{deleteTarget?.label}</strong>" ({deleteTarget?.slug})? Aksi ini tidak dapat dibatalkan.</>
                                )}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={handleDelete}
                                className="bg-red-600 hover:bg-red-700"
                                disabled={!!deleteTarget && deleteTarget.loggersCount > 0}
                            >
                                {t('common.delete')}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </AppLayout>
    );
}
