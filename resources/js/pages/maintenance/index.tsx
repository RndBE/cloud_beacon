import { Head, Link, router, useForm, usePage } from '@inertiajs/react';
import {
    AlertTriangle,
    CheckCircle2,
    ClipboardList,
    FileText,
    Filter,
    ImageIcon,
    Loader2,
    Plus,
    Save,
    Search,
    Trash2,
    Wrench,
    X,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

type TicketSummary = {
    id: number;
    issueTitle: string;
    failureType: string | null;
    priority: TicketPriority;
    status: TicketStatus;
    reportedAt: string | null;
    logger: {
        name: string | null;
        serialNumber: string | null;
        deviceIdentifier: string | null;
        location: string | null;
        status: string | null;
        projectName: string | null;
    };
    assignee: {
        name: string;
    } | null;
};

type LoggerOption = {
    id: number;
    name: string;
    serialNumber: string;
    deviceIdentifier: string | null;
    location: string | null;
    status: string;
};

type TechnicianOption = {
    id: number;
    name: string;
    email: string;
};

type MaintenanceIndexProps = {
    tickets: TicketSummary[];
    loggers: LoggerOption[];
    technicians: TechnicianOption[];
    filters: {
        status: string;
        priority: string;
        search: string;
    };
    stats: {
        open: number;
        inProgress: number;
        resolved: number;
        critical: number;
    };
};

type CreateMaintenanceForm = {
    logger_id: string;
    assigned_to: string;
    performed_at: string;
    issues: string[];
    repairs: string[];
    report: File | null;
    photos: File[];
    priority: string;
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Maintenance', href: '/maintenance' },
];

const statusLabels: Record<TicketStatus, string> = {
    open: 'Open',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    closed: 'Closed',
};

const priorityLabels: Record<TicketPriority, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    critical: 'Critical',
};

function statusTone(status: TicketStatus): string {
    if (status === 'open') return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300';
    if (status === 'in_progress') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    if (status === 'resolved') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    return 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300';
}

function priorityTone(priority: TicketPriority): string {
    if (priority === 'critical') return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300';
    if (priority === 'high') return 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300';
    if (priority === 'medium') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    return 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300';
}

export default function MaintenanceIndex({
    tickets,
    loggers,
    technicians,
    filters,
    stats,
}: MaintenanceIndexProps) {
    const { auth, flash } = usePage<{
        auth: { permissions?: string[] };
        flash: { success?: string; error?: string };
    }>().props;
    const permissions = auth.permissions ?? [];
    const canCreate = permissions.includes('maintenance.create');
    const canDelete = permissions.includes('maintenance.delete');
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<TicketSummary | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [statusFilter, setStatusFilter] = useState(filters.status || 'all');
    const [priorityFilter, setPriorityFilter] = useState(filters.priority || 'all');
    const [search, setSearch] = useState(filters.search || '');

    const createForm = useForm<CreateMaintenanceForm>({
        logger_id: '',
        assigned_to: '',
        performed_at: '',
        issues: [''],
        repairs: [''],
        report: null,
        photos: [],
        priority: 'medium',
    });

    useEffect(() => {
        if (flash?.success) setSuccessMsg(flash.success);
    }, [flash]);

    const activeTickets = useMemo(
        () => tickets.filter((ticket) => ticket.status === 'open' || ticket.status === 'in_progress').length,
        [tickets],
    );

    function applyFilters() {
        router.get(
            '/maintenance',
            {
                status: statusFilter,
                priority: priorityFilter,
                search,
            },
            { preserveState: true, preserveScroll: true },
        );
    }

    function clearFilters() {
        setStatusFilter('all');
        setPriorityFilter('all');
        setSearch('');
        router.get('/maintenance', {}, { preserveState: false });
    }

    function openCreate() {
        createForm.reset();
        createForm.setData({
            logger_id: '',
            assigned_to: '',
            performed_at: '',
            issues: [''],
            repairs: [''],
            report: null,
            photos: [],
            priority: 'medium',
        });
        setDialogOpen(true);
    }

    function submitCreate(e: FormEvent) {
        e.preventDefault();
        createForm.post('/maintenance', {
            forceFormData: true,
            onSuccess: () => setDialogOpen(false),
        });
    }

    function formError(field: string) {
        return (createForm.errors as Record<string, string>)[field];
    }

    function handleDelete() {
        if (!deleteTarget) return;
        router.delete(`/maintenance/${deleteTarget.id}`, {
            preserveScroll: true,
            onStart: () => setDeleting(true),
            onFinish: () => setDeleting(false),
            onSuccess: () => setDeleteTarget(null),
        });
    }

    function updateIssue(index: number, value: string) {
        const issues = [...createForm.data.issues];
        issues[index] = value;
        createForm.setData('issues', issues);
    }

    function addIssue() {
        createForm.setData('issues', [...createForm.data.issues, '']);
    }

    function removeIssue(index: number) {
        createForm.setData('issues', createForm.data.issues.filter((_, currentIndex) => currentIndex !== index));
    }

    function updateRepair(index: number, value: string) {
        const repairs = [...createForm.data.repairs];
        repairs[index] = value;
        createForm.setData('repairs', repairs);
    }

    function addRepair() {
        createForm.setData('repairs', [...createForm.data.repairs, '']);
    }

    function removeRepair(index: number) {
        createForm.setData('repairs', createForm.data.repairs.filter((_, currentIndex) => currentIndex !== index));
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Maintenance" />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {successMsg && (
                    <div className="flex items-center justify-between rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                        <span className="flex items-center gap-2">
                            <CheckCircle2 className="size-4" />
                            {successMsg}
                        </span>
                        <button type="button" className="cursor-pointer" onClick={() => setSuccessMsg(null)}>
                            <X className="size-4" />
                        </button>
                    </div>
                )}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                            <Wrench className="size-6" />
                            Maintenance
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Tiket perbaikan untuk logger yang sudah terdaftar.
                        </p>
                    </div>
                    {canCreate && (
                        <Button className="gap-1.5" onClick={openCreate}>
                            <Plus className="size-4" />
                            Buat Tiket
                        </Button>
                    )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Card>
                        <CardHeader className="p-4">
                            <CardDescription>Open</CardDescription>
                            <CardTitle>{stats.open}</CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader className="p-4">
                            <CardDescription>In Progress</CardDescription>
                            <CardTitle>{stats.inProgress}</CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader className="p-4">
                            <CardDescription>Resolved</CardDescription>
                            <CardTitle>{stats.resolved}</CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader className="p-4">
                            <CardDescription>Critical Active</CardDescription>
                            <CardTitle className="flex items-center gap-2">
                                {stats.critical}
                                {stats.critical > 0 && <AlertTriangle className="size-5 text-red-500" />}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <ClipboardList className="size-5" />
                                    Daftar Tiket
                                </CardTitle>
                                <CardDescription>
                                    {activeTickets} tiket aktif dari {tickets.length} tiket yang tampil.
                                </CardDescription>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_150px_150px_auto_auto]">
                                <div className="relative sm:col-span-2 xl:col-span-1">
                                    <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                                    <Input
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') applyFilters();
                                        }}
                                        className="pl-8"
                                        placeholder="Cari logger/tiket"
                                    />
                                </div>
                                <Select value={statusFilter} onValueChange={setStatusFilter}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Semua status</SelectItem>
                                        <SelectItem value="open">Open</SelectItem>
                                        <SelectItem value="in_progress">In Progress</SelectItem>
                                        <SelectItem value="resolved">Resolved</SelectItem>
                                        <SelectItem value="closed">Closed</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Semua prioritas</SelectItem>
                                        <SelectItem value="critical">Critical</SelectItem>
                                        <SelectItem value="high">High</SelectItem>
                                        <SelectItem value="medium">Medium</SelectItem>
                                        <SelectItem value="low">Low</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Button variant="outline" className="gap-1.5 sm:w-full xl:w-auto" onClick={applyFilters}>
                                    <Filter className="size-4" />
                                    Filter
                                </Button>
                                <Button variant="ghost" className="sm:w-full xl:w-auto" onClick={clearFilters}>
                                    Reset
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Tiket</TableHead>
                                        <TableHead>Logger</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Prioritas</TableHead>
                                        <TableHead>Teknisi</TableHead>
                                        <TableHead>Dibuat</TableHead>
                                        <TableHead className="text-right">Aksi</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {tickets.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                                                Belum ada tiket maintenance.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        tickets.map((ticket) => (
                                            <TableRow key={ticket.id}>
                                                <TableCell>
                                                    <div className="font-medium">{ticket.issueTitle}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        #{ticket.id} {ticket.failureType ? `- ${ticket.failureType}` : ''}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-medium">{ticket.logger.name}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {ticket.logger.serialNumber || ticket.logger.deviceIdentifier || '-'}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={statusTone(ticket.status)}>
                                                        {statusLabels[ticket.status]}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={priorityTone(ticket.priority)}>
                                                        {priorityLabels[ticket.priority]}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>{ticket.assignee?.name || '-'}</TableCell>
                                                <TableCell className="whitespace-nowrap">{ticket.reportedAt || '-'}</TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <Link href={`/maintenance/${ticket.id}`}>
                                                            <Button variant="ghost" size="sm">
                                                                Detail
                                                            </Button>
                                                        </Link>
                                                        {canDelete && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="text-red-600 hover:bg-red-500/10 hover:text-red-700"
                                                                onClick={() => setDeleteTarget(ticket)}
                                                                aria-label={`Hapus tiket #${ticket.id}`}
                                                            >
                                                                <Trash2 className="size-4" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent
                        className="max-h-[90vh] overflow-y-auto"
                        style={{
                            width: 'min(1120px, calc(100vw - 4rem))',
                            maxWidth: 'min(1120px, calc(100vw - 4rem))',
                        }}
                    >
                        <DialogHeader>
                            <DialogTitle>Buat Tiket Maintenance</DialogTitle>
                            <DialogDescription>
                                Isi kendala, perbaikan, laporan, dan dokumentasi untuk logger terdaftar.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={submitCreate} className="space-y-4">
                            <div className="grid gap-4 lg:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>
                                        Pos / Logger <span className="text-red-500">*</span>
                                    </Label>
                                    <Select
                                        value={createForm.data.logger_id}
                                        onValueChange={(value) => createForm.setData('logger_id', value)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="-- Pilih Pos --" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {loggers.map((logger) => (
                                                <SelectItem key={logger.id} value={String(logger.id)}>
                                                    {logger.name} - {logger.serialNumber}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {createForm.errors.logger_id && (
                                        <p className="text-xs text-red-500">{createForm.errors.logger_id}</p>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label>
                                        Tanggal Pelaksanaan <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        type="date"
                                        required
                                        value={createForm.data.performed_at}
                                        onChange={(e) => createForm.setData('performed_at', e.target.value)}
                                    />
                                    {createForm.errors.performed_at && (
                                        <p className="text-xs text-red-500">{createForm.errors.performed_at}</p>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label>
                                        Kendala & Masalah <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="space-y-2">
                                        {createForm.data.issues.map((issue, index) => (
                                            <div key={index} className="flex gap-2">
                                                <Input
                                                    required
                                                    value={issue}
                                                    onChange={(e) => updateIssue(index, e.target.value)}
                                                    placeholder={`Kendala ${index + 1}`}
                                                />
                                                {createForm.data.issues.length > 1 && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon"
                                                        onClick={() => removeIssue(index)}
                                                        aria-label={`Hapus kendala ${index + 1}`}
                                                    >
                                                        <Trash2 className="size-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    {(createForm.errors.issues || formError('issues.0')) && (
                                        <p className="text-xs text-red-500">{createForm.errors.issues || formError('issues.0')}</p>
                                    )}
                                    <Button type="button" variant="outline" className="h-8 w-full gap-1.5 border-emerald-500 text-emerald-700 hover:text-emerald-800" onClick={addIssue}>
                                        <Plus className="size-4" />
                                        Tambah Kendala
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    <Label>
                                        Perbaikan <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="space-y-2">
                                        {createForm.data.repairs.map((repair, index) => (
                                            <div key={index} className="flex gap-2">
                                                <Input
                                                    required
                                                    value={repair}
                                                    onChange={(e) => updateRepair(index, e.target.value)}
                                                    placeholder={`Perbaikan ${index + 1}`}
                                                />
                                                {createForm.data.repairs.length > 1 && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon"
                                                        onClick={() => removeRepair(index)}
                                                        aria-label={`Hapus perbaikan ${index + 1}`}
                                                    >
                                                        <Trash2 className="size-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    {(createForm.errors.repairs || formError('repairs.0')) && (
                                        <p className="text-xs text-red-500">{createForm.errors.repairs || formError('repairs.0')}</p>
                                    )}
                                    <Button type="button" variant="outline" className="h-8 w-full gap-1.5 border-emerald-500 text-emerald-700 hover:text-emerald-800" onClick={addRepair}>
                                        <Plus className="size-4" />
                                        Tambah Perbaikan
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    <Label className="flex items-center gap-2">
                                        <FileText className="size-4" />
                                        Upload Laporan (PDF)
                                    </Label>
                                    <Input
                                        type="file"
                                        accept="application/pdf"
                                        onChange={(e) => createForm.setData('report', e.target.files?.[0] ?? null)}
                                    />
                                    {createForm.data.report && (
                                        <p className="text-xs text-muted-foreground">{createForm.data.report.name}</p>
                                    )}
                                    {createForm.errors.report && (
                                        <p className="text-xs text-red-500">{createForm.errors.report}</p>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label className="flex items-center gap-2">
                                        <ImageIcon className="size-4" />
                                        Upload Foto Dokumentasi
                                    </Label>
                                    <Input
                                        type="file"
                                        multiple
                                        accept="image/jpeg,image/png,image/webp"
                                        onChange={(e) => createForm.setData('photos', Array.from(e.target.files ?? []))}
                                    />
                                    {createForm.data.photos.length > 0 && (
                                        <p className="text-xs text-muted-foreground">
                                            {createForm.data.photos.map((file) => file.name).join(', ')}
                                        </p>
                                    )}
                                    {(createForm.errors.photos || formError('photos.0')) && (
                                        <p className="text-xs text-red-500">{createForm.errors.photos || formError('photos.0')}</p>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label>Prioritas</Label>
                                    <Select
                                        value={createForm.data.priority}
                                        onValueChange={(value) => createForm.setData('priority', value)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="low">Low</SelectItem>
                                            <SelectItem value="medium">Medium</SelectItem>
                                            <SelectItem value="high">High</SelectItem>
                                            <SelectItem value="critical">Critical</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Teknisi</Label>
                                    <Select
                                        value={createForm.data.assigned_to || 'unassigned'}
                                        onValueChange={(value) => createForm.setData('assigned_to', value === 'unassigned' ? '' : value)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="unassigned">Belum ditugaskan</SelectItem>
                                            {technicians.map((technician) => (
                                                <SelectItem key={technician.id} value={String(technician.id)}>
                                                    {technician.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                                    Batal
                                </Button>
                                <Button type="submit" disabled={createForm.processing}>
                                    {createForm.processing ? (
                                        <>
                                            <Loader2 className="mr-2 size-4 animate-spin" />
                                            Menyimpan
                                        </>
                                    ) : (
                                        <>
                                            <Save className="mr-2 size-4" />
                                            Simpan
                                        </>
                                    )}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Hapus Tiket Maintenance</DialogTitle>
                            <DialogDescription>
                                Tiket #{deleteTarget?.id} ({deleteTarget?.issueTitle}) beserta laporan dan foto dokumentasinya akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                                Batal
                            </Button>
                            <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleting}>
                                {deleting ? (
                                    <>
                                        <Loader2 className="mr-2 size-4 animate-spin" />
                                        Menghapus
                                    </>
                                ) : (
                                    <>
                                        <Trash2 className="mr-2 size-4" />
                                        Hapus Permanen
                                    </>
                                )}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </AppLayout>
    );
}
