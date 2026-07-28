import { Head, Link, router, useForm, usePage } from '@inertiajs/react';
import {
    AlertTriangle,
    Check,
    CheckCircle2,
    Clock,
    ExternalLink,
    FolderKanban,
    Loader2,
    MapPin,
    Pencil,
    Plus,
    Radio,
    Trash2,
    Wifi,
    WifiOff,
    X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

interface ProjectItem {
    id: number;
    name: string;
    code: string | null;
    description: string | null;
    color: string;
    loggerCount: number;
    createdAt: string;
    loggers: ProjectLoggerItem[];
}

interface ProjectLoggerItem {
    id: string;
    name: string;
    serialNumber: string | null;
    deviceIdentifier: string | null;
    status: 'online' | 'offline' | 'warning';
    connectionType: string | null;
    location: string | null;
    lastSeen: string | null;
}

interface ProjectListProps {
    projects: ProjectItem[];
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Projects', href: '/projects' },
];

const PRESET_COLORS = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444',
    '#f97316', '#eab308', '#22c55e', '#14b8a6',
    '#06b6d4', '#6366f1', '#a855f7', '#64748b',
];

function loggerStatusClass(status: ProjectLoggerItem['status']): string {
    switch (status) {
        case 'online':
            return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
        case 'warning':
            return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
        case 'offline':
            return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300';
        default:
            return 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300';
    }
}

export default function ProjectList({ projects }: ProjectListProps) {
    const { t } = useTranslation();
    const { flash } = usePage<{ flash: { success?: string; error?: string } }>().props;
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // Dialog state
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingProject, setEditingProject] = useState<ProjectItem | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<ProjectItem | null>(null);
    const [loggerModalProject, setLoggerModalProject] = useState<ProjectItem | null>(null);

    const form = useForm({
        name: '',
        code: '',
        description: '',
        color: '#3b82f6',
    });

    useEffect(() => {
        if (flash?.success) setSuccessMsg(flash.success);
    }, [flash]);

    function openCreate() {
        setEditingProject(null);
        form.reset();
        form.setData({ name: '', code: '', description: '', color: '#3b82f6' });
        setDialogOpen(true);
    }

    function openEdit(project: ProjectItem) {
        setEditingProject(project);
        form.setData({
            name: project.name,
            code: project.code || '',
            description: project.description || '',
            color: project.color,
        });
        setDialogOpen(true);
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (editingProject) {
            form.put(`/projects/${editingProject.id}`, {
                onSuccess: () => setDialogOpen(false),
            });
        } else {
            form.post('/projects', {
                onSuccess: () => setDialogOpen(false),
            });
        }
    }

    function handleDelete() {
        if (!deleteTarget) return;
        router.delete(`/projects/${deleteTarget.id}`, {
            onSuccess: () => setDeleteTarget(null),
        });
    }

    function openLoggerModal(project: ProjectItem) {
        setLoggerModalProject(project);
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Projects" />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* Success banner */}
                {successMsg && (
                    <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 className="size-4 shrink-0" />
                            <span>{successMsg}</span>
                        </div>
                        <button onClick={() => setSuccessMsg(null)}>
                            <X className="size-4" />
                        </button>
                    </div>
                )}

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                            <FolderKanban className="size-6" /> Projects
                        </h1>   
                    </div>
                    <Button className="gap-1.5" onClick={openCreate}>
                        <Plus className="size-4" /> Tambah Project
                    </Button>
                </div>

                {/* Project Cards Grid */}
                {projects.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center justify-center py-16">
                            <FolderKanban className="mb-3 size-12 text-muted-foreground/30" />
                            <p className="text-sm text-muted-foreground">Belum ada project.</p>
                            <Button variant="outline" className="mt-4 gap-1.5" onClick={openCreate}>
                                <Plus className="size-4" /> Buat Project Pertama
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {projects.map(project => (
                            <Card
                                key={project.id}
                                className="group relative cursor-pointer gap-0 overflow-hidden py-0 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                                role="button"
                                tabIndex={0}
                                onClick={() => openLoggerModal(project)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        openLoggerModal(project);
                                    }
                                }}
                            >
                                {/* Color stripe */}
                                <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: project.color }} />
                                <CardHeader className="px-4 pt-6 pb-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div
                                                className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center"
                                                style={{ backgroundColor: project.color + '20' }}
                                            >
                                                <FolderKanban className="size-4" style={{ color: project.color }} />
                                            </div>
                                            <div className="min-w-0">
                                                <CardTitle className="text-sm truncate">{project.name}</CardTitle>
                                                {project.code && (
                                                    <p className="font-mono text-[10px] text-muted-foreground">{project.code}</p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    openEdit(project);
                                                }}
                                            >
                                                <Pencil className="size-3.5" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    setDeleteTarget(project);
                                                }}
                                            >
                                                <Trash2 className="size-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                    {project.description && (
                                        <CardDescription className="mt-1.5 line-clamp-2 text-xs">
                                            {project.description}
                                        </CardDescription>
                                    )}
                                </CardHeader>
                                <Separator />
                                <CardContent className="px-4 py-3">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="flex items-center gap-1.5 text-muted-foreground">
                                            <Radio className="size-3.5" />
                                            {project.loggerCount} logger{project.loggerCount !== 1 ? 's' : ''}
                                        </span>
                                        <span className="text-muted-foreground/60">
                                            {project.createdAt}
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

                {/* Project Loggers Dialog */}
                <Dialog
                    open={!!loggerModalProject}
                    onOpenChange={(open) => {
                        if (!open) setLoggerModalProject(null);
                    }}
                >
                    <DialogContent className="sm:max-w-2xl">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <span
                                    className="h-2.5 w-2.5 rounded-full"
                                    style={{
                                        backgroundColor:
                                            loggerModalProject?.color ||
                                            '#64748b',
                                    }}
                                />
                                {loggerModalProject?.name || 'Project Loggers'}
                            </DialogTitle>
                            <DialogDescription>
                                {loggerModalProject?.loggerCount || 0} logger
                                {(loggerModalProject?.loggerCount || 0) !== 1
                                    ? 's'
                                    : ''}{' '}
                                di project ini
                            </DialogDescription>
                        </DialogHeader>
                        {loggerModalProject?.loggers.length ? (
                            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                                {loggerModalProject.loggers.map((logger) => (
                                    <div
                                        key={logger.id}
                                        className="flex items-start justify-between gap-3 rounded-lg border p-3"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="truncate text-sm font-semibold">
                                                    {logger.name}
                                                </p>
                                                <Badge
                                                    variant="outline"
                                                    className={`capitalize ${loggerStatusClass(logger.status)}`}
                                                >
                                                    {logger.status ===
                                                    'online' ? (
                                                        <Wifi className="mr-1 size-3" />
                                                    ) : (
                                                        <WifiOff className="mr-1 size-3" />
                                                    )}
                                                    {logger.status}
                                                </Badge>
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                                <span className="font-mono">
                                                    {logger.serialNumber ||
                                                        logger.deviceIdentifier ||
                                                        '-'}
                                                </span>
                                                {logger.connectionType && (
                                                    <span className="capitalize">
                                                        {
                                                            logger.connectionType
                                                        }
                                                    </span>
                                                )}
                                                {logger.location && (
                                                    <span className="flex items-center gap-1">
                                                        <MapPin className="size-3" />
                                                        {logger.location}
                                                    </span>
                                                )}
                                                {logger.lastSeen && (
                                                    <span className="flex items-center gap-1">
                                                        <Clock className="size-3" />
                                                        {logger.lastSeen}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <Button
                                            asChild
                                            variant="outline"
                                            size="sm"
                                            className="shrink-0 gap-1.5"
                                        >
                                            <Link href={`/loggers/${logger.id}`}>
                                                Detail
                                                <ExternalLink className="size-3.5" />
                                            </Link>
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center rounded-lg border py-10 text-center">
                                <Radio className="mb-2 size-8 text-muted-foreground/40" />
                                <p className="text-sm font-medium">
                                    Belum ada logger
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Project ini belum memiliki logger.
                                </p>
                            </div>
                        )}
                    </DialogContent>
                </Dialog>

                {/* Create/Edit Dialog */}
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>{editingProject ? 'Edit Project' : 'Tambah Project'}</DialogTitle>
                            <DialogDescription>
                                {editingProject
                                    ? 'Ubah detail project.'
                                    : 'Buat project baru untuk mengelompokkan logger.'}
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
                            <div className="grid gap-2">
                                <Label htmlFor="name">Nama Project *</Label>
                                <Input
                                    id="name"
                                    value={form.data.name}
                                    onChange={e => form.setData('name', e.target.value)}
                                    placeholder="e.g. Bendungan Ngrancah"
                                />
                                {form.errors.name && <p className="text-xs text-red-500">{form.errors.name}</p>}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="code">Kode (opsional)</Label>
                                <Input
                                    id="code"
                                    value={form.data.code}
                                    onChange={e => form.setData('code', e.target.value)}
                                    placeholder="e.g. PRJ-001"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="description">Deskripsi (opsional)</Label>
                                <Textarea
                                    id="description"
                                    value={form.data.description}
                                    onChange={e => form.setData('description', e.target.value)}
                                    placeholder="Deskripsi singkat project..."
                                    rows={2}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Warna</Label>
                                <div className="flex flex-wrap gap-2">
                                    {PRESET_COLORS.map(c => (
                                        <button
                                            key={c}
                                            type="button"
                                            className={`h-7 w-7 rounded-lg border-2 transition-all ${
                                                form.data.color === c
                                                    ? 'border-foreground scale-110 shadow-md'
                                                    : 'border-transparent hover:scale-105'
                                            }`}
                                            style={{ backgroundColor: c }}
                                            onClick={() => form.setData('color', c)}
                                        />
                                    ))}
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                                    Batal
                                </Button>
                                <Button type="submit" disabled={form.processing} className="gap-1.5">
                                    {form.processing ? (
                                        <><Loader2 className="size-4 animate-spin" /> Menyimpan...</>
                                    ) : editingProject ? (
                                        <><Check className="size-4" /> Simpan</>
                                    ) : (
                                        <><Plus className="size-4" /> Tambah</>
                                    )}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                {/* Delete Dialog */}
                <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Hapus Project?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Project <strong>{deleteTarget?.name}</strong> akan dihapus.
                                Logger yang ada di project ini <strong>tidak akan terhapus</strong>, hanya assignment project-nya yang dihilangkan.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Batal</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                                Hapus Project
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </AppLayout>
    );
}
