import { Head, Link, router } from '@inertiajs/react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    CloudDownload,
    Download,
    HardDrive,
    Loader2,
    MapPin,
    Power,
    Radio,
    RefreshCw,
    Save,
    Server,
    Wifi,
    WifiOff,
    XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
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
import AppLayout from '@/layouts/app-layout';
import { dashboard } from '@/routes';
import type { BreadcrumbItem } from '@/types';

const LoggerMap = lazy(() => import('@/components/logger-map'));

interface MapLogger {
    id: number;
    name: string;
    status: 'online' | 'offline' | 'warning';
    location: string;
    lat: number;
    lng: number;
    sensorsCount: number;
    serialNumber: string | null;
    loggerMode: string | null;
    projectName: string | null;
    projectColor: string | null;
}

interface ActivityLogItem {
    id: number;
    timestamp: string;
    device: string;
    deviceId: number;
    action: string;
    status: 'success' | 'failed' | 'pending';
    level: 'info' | 'warning' | 'error' | 'debug';
    message: string;
}

interface DashboardProps {
    stats: {
        totalLoggers: number;
        onlineLoggers: number;
        offlineLoggers: number;
        warningLoggers: number;
        totalSensors: number;
        activeSensors: number;
    };
    recentActivity: ActivityLogItem[];
    loggers: MapLogger[];
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: dashboard() },
];

function getLogLevelColor(level: string) {
    switch (level) {
        case 'info': return 'text-blue-500';
        case 'warning': return 'text-amber-500';
        case 'error': return 'text-red-500';
        default: return 'text-muted-foreground';
    }
}

function getStatusColor(status: string) {
    switch (status) {
        case 'online': return 'bg-emerald-500';
        case 'offline': return 'bg-red-500';
        case 'warning': return 'bg-amber-500';
        default: return 'bg-muted-foreground';
    }
}

export default function Dashboard({ stats, recentActivity, loggers }: DashboardProps) {
    const activeAlerts = stats.warningLoggers + stats.offlineLoggers;
    const { t } = useTranslation();

    // ─── Backup Config Modal ──────────────────────────
    const [backupOpen, setBackupOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [isExporting, setIsExporting] = useState(false);

    const allSelected = loggers.length > 0 && selectedIds.size === loggers.length;
    const someSelected = selectedIds.size > 0 && selectedIds.size < loggers.length;

    function toggleAll() {
        if (allSelected) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(loggers.map(l => l.id)));
        }
    }

    function toggleOne(id: number) {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function openBackupModal() {
        setSelectedIds(new Set(loggers.map(l => l.id))); // Select all by default
        setBackupOpen(true);
    }

    async function handleExport() {
        if (selectedIds.size === 0) return;
        setIsExporting(true);

        try {
            const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || '';
            const res = await fetch('/loggers/export-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': csrfToken,
                    'Accept': 'application/json',
                },
                body: JSON.stringify({ logger_ids: Array.from(selectedIds) }),
            });

            if (!res.ok) {
                throw new Error('Export failed');
            }

            // Get filename from Content-Disposition header or use default
            const disposition = res.headers.get('Content-Disposition');
            let filename = 'beacon_config_backup.json';
            if (disposition) {
                const match = disposition.match(/filename="?(.+?)"?$/);
                if (match) filename = match[1];
            }

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();

            setBackupOpen(false);
        } catch (err) {
            console.error('Export error:', err);
        } finally {
            setIsExporting(false);
        }
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('dashboard.title')} />
            <div className="dashboard-glass-bg">
                <div className="relative z-10 flex flex-col gap-6 p-4 md:p-6">
                    {/* Stats Row */}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Card className="glass-card glass-animate-in glass-delay-1">
                            <CardContent className="flex items-center gap-4 px-4 py-0">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-500/10">
                                    <Radio className="size-6 text-blue-500" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm text-muted-foreground">{t('dashboard.total_loggers')}</p>
                                    <p className="text-2xl font-bold">{stats.totalLoggers}</p>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="glass-card glass-animate-in glass-delay-2">
                            <CardContent className="flex items-center gap-4 px-4 py-0">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
                                    <Wifi className="size-6 text-emerald-500" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm text-muted-foreground">{t('dashboard.online')}</p>
                                    <p className="text-2xl font-bold text-emerald-600">{stats.onlineLoggers}</p>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="glass-card glass-animate-in glass-delay-3">
                            <CardContent className="flex items-center gap-4 px-4 py-0">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-500/10">
                                    <AlertTriangle className="size-6 text-red-500" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm text-muted-foreground">{t('dashboard.active_alerts')}</p>
                                    <p className="text-2xl font-bold text-red-600">{activeAlerts}</p>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="glass-card glass-animate-in glass-delay-4">
                            <CardContent className="flex items-center gap-4 px-4 py-0">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-500/10">
                                    <Activity className="size-6 text-violet-500" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm text-muted-foreground">{t('dashboard.active_sensors')}</p>
                                    <p className="text-2xl font-bold">{stats.activeSensors}<span className="text-sm font-normal text-muted-foreground">/{stats.totalSensors}</span></p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Logger Map */}
                    <Card className="glass-card glass-animate-in glass-delay-5">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <MapPin className="size-5" />
                                Logger Distribution Map
                            </CardTitle>
                            <CardDescription>{t('dashboard.logger_map_desc')}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Suspense fallback={
                                <div className="flex h-[400px] items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                                    {t('dashboard.loading_map')}
                                </div>
                            }>
                                <LoggerMap loggers={loggers} />
                            </Suspense>
                        </CardContent>
                    </Card>

                    {/* Middle Row */}
                    <div className="grid gap-4 lg:grid-cols-3">
                        <Card className="glass-card glass-animate-in glass-delay-6 lg:col-span-2">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Server className="size-5" />
                                    Logger Health
                                </CardTitle>
                                <CardDescription>{t('dashboard.connection_status')}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-5">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="flex items-center gap-2">
                                                <CheckCircle2 className="size-4 text-emerald-500" />
                                                Online
                                            </span>
                                            <span className="font-medium">{stats.onlineLoggers}/{stats.totalLoggers}</span>
                                        </div>
                                        <Progress value={stats.totalLoggers > 0 ? (stats.onlineLoggers / stats.totalLoggers) * 100 : 0} className="h-2 [&>div]:bg-emerald-500" />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="flex items-center gap-2">
                                                <AlertTriangle className="size-4 text-amber-500" />
                                                Warning
                                            </span>
                                            <span className="font-medium">{stats.warningLoggers}/{stats.totalLoggers}</span>
                                        </div>
                                        <Progress value={stats.totalLoggers > 0 ? (stats.warningLoggers / stats.totalLoggers) * 100 : 0} className="h-2 [&>div]:bg-amber-500" />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="flex items-center gap-2">
                                                <XCircle className="size-4 text-red-500" />
                                                Offline
                                            </span>
                                            <span className="font-medium">{stats.offlineLoggers}/{stats.totalLoggers}</span>
                                        </div>
                                        <Progress value={stats.totalLoggers > 0 ? (stats.offlineLoggers / stats.totalLoggers) * 100 : 0} className="h-2 [&>div]:bg-red-500" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="glass-card glass-animate-in glass-delay-7">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <HardDrive className="size-5" />
                                    Quick Actions
                                </CardTitle>
                                <CardDescription>{t('dashboard.batch_operations')}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-3">
                                    <Button variant="outline" className="justify-start gap-2">
                                        <RefreshCw className="size-4" />
                                        Sync All Configs
                                    </Button>
                                    <Button variant="outline" className="justify-start gap-2">
                                        <Power className="size-4" />
                                        {t('dashboard.reboot_devices')}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="justify-start gap-2"
                                        onClick={openBackupModal}
                                    >
                                        <Save className="size-4" />
                                        {t('dashboard.backup_configs')}
                                    </Button>
                                    <Button variant="outline" className="justify-start gap-2">
                                        <CloudDownload className="size-4" />
                                        {t('dashboard.check_firmware')}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Recent Activity */}
                    <Card className="glass-card glass-animate-in glass-delay-7">
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="flex items-center gap-2">
                                        <Activity className="size-5" />
                                        Recent Activity
                                    </CardTitle>
                                    <CardDescription>{t('dashboard.latest_events')}</CardDescription>
                                </div>
                                <Link href="/loggers">
                                    <Button variant="ghost" size="sm" className="gap-1">
                                        {t('dashboard.view_all_loggers')}
                                        <ArrowRight className="size-4" />
                                    </Button>
                                </Link>
                            </div>
                        </CardHeader>
                        <Separator />
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[180px]">{t('dashboard.timestamp')}</TableHead>
                                        <TableHead>{t('dashboard.device')}</TableHead>
                                        <TableHead>{t('dashboard.action')}</TableHead>
                                        <TableHead>{t('dashboard.status')}</TableHead>
                                        <TableHead className="hidden lg:table-cell">{t('dashboard.message')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {recentActivity.map((log) => (
                                        <TableRow key={log.id}>
                                            <TableCell className="font-mono text-xs text-muted-foreground">
                                                {log.timestamp}
                                            </TableCell>
                                            <TableCell>
                                                <Link href={`/loggers/${log.deviceId}`} className="font-medium hover:underline">
                                                    {log.device}
                                                </Link>
                                            </TableCell>
                                            <TableCell>
                                                <span className={`flex items-center gap-1.5 text-sm ${getLogLevelColor(log.level)}`}>
                                                    {log.level === 'error' && <WifiOff className="size-3.5" />}
                                                    {log.level === 'warning' && <AlertTriangle className="size-3.5" />}
                                                    {log.level === 'info' && <CheckCircle2 className="size-3.5" />}
                                                    {log.action}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant={
                                                        log.status === 'success' ? 'default' :
                                                            log.status === 'failed' ? 'destructive' : 'secondary'
                                                    }
                                                    className="text-xs"
                                                >
                                                    {log.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="hidden max-w-[300px] truncate text-sm text-muted-foreground lg:table-cell">
                                                {log.message}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {recentActivity.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                                                {t('dashboard.no_recent_activity')}
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* ═══ Backup Config Modal ═══ */}
            <Dialog open={backupOpen} onOpenChange={setBackupOpen}>
                <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Save className="size-5" /> Backup Konfigurasi Logger
                        </DialogTitle>
                        <DialogDescription>
                            Pilih logger yang ingin di-backup. File konfigurasi akan diunduh dalam format JSON.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Select all */}
                    <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
                        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                            <Checkbox
                                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                                onCheckedChange={toggleAll}
                            />
                            Pilih Semua
                        </label>
                        <span className="text-xs text-muted-foreground">
                            {selectedIds.size} dari {loggers.length} dipilih
                        </span>
                    </div>

                    {/* Logger list */}
                    <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1 min-h-0 max-h-[45vh]">
                        {loggers.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                                <Radio className="mb-2 size-8 text-muted-foreground/30" />
                                <p className="text-sm text-muted-foreground">Belum ada logger terdaftar.</p>
                            </div>
                        ) : (
                            loggers.map(logger => (
                                <label
                                    key={logger.id}
                                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-all ${
                                        selectedIds.has(logger.id)
                                            ? 'border-primary/30 bg-primary/5'
                                            : 'border-transparent hover:bg-muted/40'
                                    }`}
                                >
                                    <Checkbox
                                        checked={selectedIds.has(logger.id)}
                                        onCheckedChange={() => toggleOne(logger.id)}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{logger.name}</p>
                                        <p className="font-mono text-[10px] text-muted-foreground">
                                            {logger.serialNumber || '—'}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {logger.loggerMode && (
                                            <Badge variant="secondary" className="text-[10px]">
                                                {logger.loggerMode}
                                            </Badge>
                                        )}
                                        <div className={`h-2 w-2 rounded-full ${getStatusColor(logger.status)}`} />
                                    </div>
                                </label>
                            ))
                        )}
                    </div>

                    <DialogFooter className="border-t pt-3">
                        <Button
                            variant="outline"
                            onClick={() => setBackupOpen(false)}
                            disabled={isExporting}
                        >
                            Batal
                        </Button>
                        <Button
                            className="gap-2"
                            disabled={selectedIds.size === 0 || isExporting}
                            onClick={handleExport}
                        >
                            {isExporting ? (
                                <><Loader2 className="size-4 animate-spin" /> Mengekspor...</>
                            ) : (
                                <><Download className="size-4" /> Export JSON ({selectedIds.size})</>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
