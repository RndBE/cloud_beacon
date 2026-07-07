import { Head, Link, useForm, usePage } from '@inertiajs/react';
import {
    ArrowLeft,
    CheckCircle2,
    Clock,
    FileText,
    ImageIcon,
    Loader2,
    Radio,
    UserRound,
    Wrench,
    X,
} from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
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
    DialogClose,
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
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

type TechnicianOption = {
    id: number;
    name: string;
    email: string;
};

type TicketDetail = {
    id: number;
    issueTitle: string;
    issueDescription: string;
    issues: string[];
    failureType: string | null;
    priority: TicketPriority;
    status: TicketStatus;
    performedAt: string | null;
    repairAction: string | null;
    repairs: string[];
    partsUsed: string | null;
    technicianNotes: string | null;
    report: {
        path: string;
        url: string;
        name: string;
    } | null;
    documentationPhotos: {
        path: string;
        url: string;
        name: string;
    }[];
    reportedAt: string | null;
    startedAt: string | null;
    resolvedAt: string | null;
    closedAt: string | null;
    logger: {
        id: string | null;
        name: string | null;
        serialNumber: string | null;
        deviceIdentifier: string | null;
        location: string | null;
        status: string | null;
        projectName: string | null;
        firmwareVersion: string | null;
        connectionType: string | null;
        lastSeen: string | null;
        lastDataReceivedAt: string | null;
        sensorsCount: number;
    };
    reporter: {
        name: string | null;
    };
    assignee: {
        id: number;
        name: string;
    } | null;
    updatedAt: string | null;
    updatedBy: {
        id: number;
        name: string;
    } | null;
};

type MaintenanceShowProps = {
    ticket: TicketDetail;
    technicians: TechnicianOption[];
};

const statusLabels: Record<TicketStatus, string> = {
    open: 'Open',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    closed: 'Closed',
};

function statusTone(status: TicketStatus): string {
    if (status === 'open') return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300';
    if (status === 'in_progress') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    if (status === 'resolved') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    return 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300';
}

export default function MaintenanceShow({ ticket, technicians }: MaintenanceShowProps) {
    const { auth, flash } = usePage<{
        auth: { permissions?: string[] };
        flash: { success?: string; error?: string };
    }>().props;
    const permissions = auth.permissions ?? [];
    const canUpdate = permissions.includes('maintenance.update');
    const canClose = permissions.includes('maintenance.close');
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
    const [updateValidationError, setUpdateValidationError] = useState<string | null>(null);

    const breadcrumbs: BreadcrumbItem[] = [
        { title: 'Dashboard', href: '/dashboard' },
        { title: 'Maintenance', href: '/maintenance' },
        { title: `#${ticket.id}`, href: `/maintenance/${ticket.id}` },
    ];

    const form = useForm<{
        _method: 'put';
        assigned_to: string;
        status: TicketStatus;
        priority: TicketPriority;
        repair_action: string;
        parts_used: string;
        technician_notes: string;
        report: File | null;
        photos: File[];
    }>({
        _method: 'put',
        assigned_to: ticket.assignee ? String(ticket.assignee.id) : '',
        status: ticket.status,
        priority: ticket.priority,
        repair_action: ticket.repairAction || '',
        parts_used: ticket.partsUsed || '',
        technician_notes: ticket.technicianNotes || '',
        report: null,
        photos: [],
    });

    useEffect(() => {
        if (flash?.success) setSuccessMsg(flash.success);
    }, [flash]);

    function submitUpdate(e: FormEvent) {
        e.preventDefault();

        if (form.data.status === 'closed' && form.data.technician_notes.trim().length === 0) {
            setUpdateValidationError('Status Closed wajib diisi dengan Catatan Teknisi.');
            return;
        }

        setUpdateValidationError(null);
        form.post(`/maintenance/${ticket.id}`, {
            forceFormData: true,
            onSuccess: () => {
                form.setData('report', null);
                form.setData('photos', []);
                setUpdateDialogOpen(false);
            },
        });
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={`Maintenance #${ticket.id}`} />
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
                        <Link href="/maintenance" className="mb-2 flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                            <ArrowLeft className="size-4" />
                            Kembali ke Maintenance
                        </Link>
                        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                            <Wrench className="size-6" />
                            {ticket.issueTitle}
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Tiket #{ticket.id} untuk {ticket.logger.name || 'logger'}
                        </p>
                    </div>
                    <Badge variant="outline" className={statusTone(ticket.status)}>
                        {statusLabels[ticket.status]}
                    </Badge>
                </div>

                <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Masalah</CardTitle>
                                <CardDescription>{ticket.failureType || 'Jenis kerusakan belum diisi'}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {ticket.issues.length > 0 ? (
                                    <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">
                                        {ticket.issues.map((issue, index) => (
                                            <li key={`${issue}-${index}`}>{issue}</li>
                                        ))}
                                    </ol>
                                ) : (
                                    <p className="whitespace-pre-wrap text-sm leading-6">{ticket.issueDescription}</p>
                                )}
                                <Separator />
                                <div className="grid gap-3 text-sm sm:grid-cols-2">
                                    <div>
                                        <div className="text-muted-foreground">Pelapor</div>
                                        <div className="font-medium">{ticket.reporter.name || '-'}</div>
                                    </div>
                                    <div>
                                        <div className="text-muted-foreground">Tanggal Pelaksanaan</div>
                                        <div className="font-medium">{ticket.performedAt || '-'}</div>
                                    </div>
                                    <div>
                                        <div className="text-muted-foreground">Dilaporkan</div>
                                        <div className="font-medium">{ticket.reportedAt || '-'}</div>
                                    </div>
                                    <div>
                                        <div className="text-muted-foreground">Mulai</div>
                                        <div className="font-medium">{ticket.startedAt || '-'}</div>
                                    </div>
                                    <div>
                                        <div className="text-muted-foreground">Selesai</div>
                                        <div className="font-medium">{ticket.resolvedAt || ticket.closedAt || '-'}</div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Perbaikan & Dokumentasi</CardTitle>
                                <CardDescription>Referensi pekerjaan dan berkas pendukung dari tiket ini.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <div className="space-y-2">
                                    <div className="text-sm font-medium">Perbaikan</div>
                                    {ticket.repairs.length > 0 ? (
                                        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">
                                            {ticket.repairs.map((repair, index) => (
                                                <li key={`${repair}-${index}`}>{repair}</li>
                                            ))}
                                        </ol>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">Belum ada daftar perbaikan dari form awal.</p>
                                    )}
                                </div>
                                <div className="grid gap-4 lg:grid-cols-2">
                                    <div className="space-y-2">
                                        <div className="text-sm font-medium">Tindakan Perbaikan</div>
                                        {ticket.repairAction ? (
                                            <p className="whitespace-pre-wrap text-sm leading-6">{ticket.repairAction}</p>
                                        ) : (
                                            <p className="text-sm text-muted-foreground">Belum ada tindakan perbaikan.</p>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <div className="text-sm font-medium">Spare Part Digunakan</div>
                                        {ticket.partsUsed ? (
                                            <p className="whitespace-pre-wrap text-sm leading-6">{ticket.partsUsed}</p>
                                        ) : (
                                            <p className="text-sm text-muted-foreground">Tidak ada spare part yang dicatat.</p>
                                        )}
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <div className="text-sm font-medium">Catatan Teknisi</div>
                                    {ticket.technicianNotes ? (
                                        <p className="whitespace-pre-wrap text-sm leading-6">{ticket.technicianNotes}</p>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">Belum ada catatan teknisi.</p>
                                    )}
                                </div>
                                <Separator />
                                <div className="grid gap-4 lg:grid-cols-2">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-sm font-medium">
                                            <FileText className="size-4" />
                                            Laporan PDF
                                        </div>
                                        {ticket.report ? (
                                            <Button asChild variant="outline" className="w-full justify-start">
                                                <a href={ticket.report.url} target="_blank" rel="noreferrer">
                                                    {ticket.report.name}
                                                </a>
                                            </Button>
                                        ) : (
                                            <p className="text-sm text-muted-foreground">Belum ada laporan PDF.</p>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-sm font-medium">
                                            <ImageIcon className="size-4" />
                                            Foto Dokumentasi
                                        </div>
                                        {ticket.documentationPhotos.length > 0 ? (
                                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                                {ticket.documentationPhotos.map((photo) => (
                                                    <a
                                                        key={photo.path}
                                                        href={photo.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="group overflow-hidden rounded-md border bg-muted"
                                                    >
                                                        <img
                                                            src={photo.url}
                                                            alt={photo.name}
                                                            className="aspect-video w-full object-cover transition group-hover:scale-105"
                                                        />
                                                    </a>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-muted-foreground">Belum ada foto dokumentasi.</p>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {canUpdate && (
                            <div className="flex justify-end">
                                <Button size="sm" onClick={() => setUpdateDialogOpen(true)}>
                                    Buka Form Update
                                </Button>
                            </div>
                        )}

                        <Dialog
                            open={updateDialogOpen}
                            onOpenChange={(open) => {
                                setUpdateDialogOpen(open);
                                if (open) {
                                    setUpdateValidationError(null);
                                }
                            }}
                        >
                            <DialogContent
                                className="max-h-[90vh] overflow-y-auto"
                                style={{
                                    width: 'min(900px, calc(100vw - 3rem))',
                                    maxWidth: 'min(900px, calc(100vw - 3rem))',
                                }}
                            >
                                <DialogHeader>
                                    <DialogTitle>Update Perbaikan</DialogTitle>
                                    <DialogDescription>
                                        Update progres pengerjaan, tandai status terbaru, dan simpan catatan teknis agar historinya tercatat rapi.
                                    </DialogDescription>
                                    <div className="text-xs text-muted-foreground">
                                        Terakhir diubah: {ticket.updatedAt || '-'} · oleh {ticket.updatedBy?.name || '-'}
                                    </div>
                                </DialogHeader>
                                <form onSubmit={submitUpdate} className="space-y-5">
                                    <div className="grid gap-4 md:grid-cols-3">
                                        <div className="space-y-2">
                                            <Label>Status</Label>
                                            <Select value={form.data.status} onValueChange={(value) => form.setData('status', value as TicketStatus)}>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="open">Open</SelectItem>
                                                    <SelectItem value="in_progress">In Progress</SelectItem>
                                                    <SelectItem value="resolved">Resolved</SelectItem>
                                                    {(canClose || ticket.status === 'closed') && (
                                                        <SelectItem value="closed">Closed</SelectItem>
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Prioritas</Label>
                                            <Select value={form.data.priority} onValueChange={(value) => form.setData('priority', value as TicketPriority)}>
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
                                                value={form.data.assigned_to || 'unassigned'}
                                                onValueChange={(value) => form.setData('assigned_to', value === 'unassigned' ? '' : value)}
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
                                    <div className="rounded-md border bg-muted/40 p-3 text-xs leading-6 text-muted-foreground">
                                        Setiap perubahan status akan menyesuaikan jejak progres tiket di backend (open, in progress, resolved, closed).
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Tindakan Perbaikan</Label>
                                        <Textarea
                                            value={form.data.repair_action}
                                            onChange={(e) => form.setData('repair_action', e.target.value)}
                                            rows={4}
                                            placeholder="Contoh: cek power, ganti baterai, reset konfigurasi, update firmware."
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Spare Part Digunakan</Label>
                                        <Textarea
                                            value={form.data.parts_used}
                                            onChange={(e) => form.setData('parts_used', e.target.value)}
                                            rows={3}
                                            placeholder="Contoh: baterai 12V, konektor panel surya, antena GSM."
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Catatan Teknisi</Label>
                                        <Textarea
                                            value={form.data.technician_notes}
                                            onChange={(e) => form.setData('technician_notes', e.target.value)}
                                            rows={4}
                                            placeholder="Catatan tambahan hasil pengecekan."
                                        />
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label className="flex items-center gap-2">
                                                <FileText className="size-4" />
                                                Ganti Laporan PDF
                                            </Label>
                                            <Input
                                                type="file"
                                                accept="application/pdf"
                                                onChange={(e) => form.setData('report', e.target.files?.[0] ?? null)}
                                            />
                                            {form.data.report ? (
                                                <p className="text-xs text-muted-foreground">{form.data.report.name}</p>
                                            ) : ticket.report ? (
                                                <p className="text-xs text-muted-foreground">Saat ini: {ticket.report.name}</p>
                                            ) : (
                                                <p className="text-xs text-muted-foreground">Belum ada laporan PDF.</p>
                                            )}
                                            {form.errors.report && (
                                                <p className="text-xs text-red-500">{form.errors.report}</p>
                                            )}
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="flex items-center gap-2">
                                                <ImageIcon className="size-4" />
                                                Tambah Foto Dokumentasi
                                            </Label>
                                            <Input
                                                type="file"
                                                multiple
                                                accept="image/jpeg,image/png,image/webp"
                                                onChange={(e) => form.setData('photos', Array.from(e.target.files ?? []))}
                                            />
                                            {form.data.photos.length > 0 ? (
                                                <p className="text-xs text-muted-foreground">
                                                    {form.data.photos.map((file) => file.name).join(', ')}
                                                </p>
                                            ) : (
                                                <p className="text-xs text-muted-foreground">
                                                    {ticket.documentationPhotos.length} foto tersimpan · upload menambah, bukan mengganti.
                                                </p>
                                            )}
                                            {(form.errors.photos || (form.errors as Record<string, string>)['photos.0']) && (
                                                <p className="text-xs text-red-500">
                                                    {form.errors.photos || (form.errors as Record<string, string>)['photos.0']}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    {updateValidationError && (
                                        <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                                            {updateValidationError}
                                        </p>
                                    )}
                                    <DialogFooter>
                                        <DialogClose asChild>
                                            <Button type="button" variant="outline">
                                                Batal
                                            </Button>
                                        </DialogClose>
                                        <Button
                                            type="submit"
                                            disabled={
                                                form.processing ||
                                                (form.data.status === 'closed' && form.data.technician_notes.trim().length === 0)
                                            }
                                        >
                                            {form.processing ? (
                                                <>
                                                    <Loader2 className="mr-2 size-4 animate-spin" />
                                                    Menyimpan
                                                </>
                                            ) : (
                                                'Simpan Update'
                                            )}
                                        </Button>
                                    </DialogFooter>
                                </form>
                            </DialogContent>
                        </Dialog>
                    </div>

                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Radio className="size-5" />
                                    Logger
                                </CardTitle>
                                <CardDescription>Konteks perangkat yang diperbaiki.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3 text-sm">
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">Nama</span>
                                    <span className="font-medium text-right">{ticket.logger.name || '-'}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">Serial</span>
                                    <span className="font-mono text-xs">{ticket.logger.serialNumber || '-'}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">Device ID</span>
                                    <span className="font-mono text-xs">{ticket.logger.deviceIdentifier || '-'}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">Lokasi</span>
                                    <span className="text-right">{ticket.logger.location || '-'}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">Project</span>
                                    <span className="text-right">{ticket.logger.projectName || '-'}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">Firmware</span>
                                    <span>{ticket.logger.firmwareVersion || '-'}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">Sensor</span>
                                    <span>{ticket.logger.sensorsCount}</span>
                                </div>
                                <Separator />
                                <Link href={ticket.logger.id ? `/loggers/${ticket.logger.id}` : '/loggers'}>
                                    <Button variant="outline" className="w-full">
                                        Buka Detail Logger
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <UserRound className="size-5" />
                                    Penugasan
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3 text-sm">
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">Teknisi</span>
                                    <span className="font-medium">{ticket.assignee?.name || '-'}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">Prioritas</span>
                                    <span className="capitalize">{ticket.priority}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <span className="flex items-center gap-1 text-muted-foreground">
                                        <Clock className="size-4" />
                                        Status
                                    </span>
                                    <span>{statusLabels[ticket.status]}</span>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
