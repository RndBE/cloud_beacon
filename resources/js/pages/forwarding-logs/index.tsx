import { Head, router } from '@inertiajs/react';
import {
    AlertTriangle,
    ArrowUpDown,
    CalendarDays,
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Clock,
    Code,
    ExternalLink,
    Filter,
    Info,
    Loader2,
    RefreshCw,
    Search,
    SkipForward,
    X,
    XCircle,
    Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

interface LogEntry {
    id: number;
    loggerName: string;
    loggerSerial: string;
    deviceId: string;
    targetName: string;
    targetUrl: string;
    status: 'success' | 'error' | 'skipped';
    httpStatus: number | null;
    errorMessage: string | null;
    responseTimeMs: number | null;
    payloadSummary: {
        id_alat: string;
        jam: string;
        hari: string;
        sensor_count: number;
        sensors: string[];
    } | null;
    rawPayload: Record<string, unknown> | null;
    createdAt: string;
}

interface PaginatedLogs {
    data: LogEntry[];
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number | null;
    to: number | null;
}

interface LoggerOption {
    id: number;
    name: string;
    deviceId: string;
}

interface Stats {
    totalToday: number;
    successToday: number;
    errorToday: number;
    skippedToday: number;
}

interface Filters {
    status: string;
    target: string;
    logger_id: string;
    from: string;
    to: string;
}

interface PageProps {
    logs: PaginatedLogs;
    stats: Stats;
    loggers: LoggerOption[];
    filters: Filters;
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Forwarding Logs', href: '/forwarding-logs' },
];

function StatusBadge({ status }: { status: string }) {
    switch (status) {
        case 'success':
            return (
                <Badge className="gap-1 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 border-0">
                    <CheckCircle2 className="size-3" />
                    Success
                </Badge>
            );
        case 'error':
            return (
                <Badge className="gap-1 bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400 border-0">
                    <XCircle className="size-3" />
                    Error
                </Badge>
            );
        case 'skipped':
            return (
                <Badge className="gap-1 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400 border-0">
                    <SkipForward className="size-3" />
                    Skipped
                </Badge>
            );
        default:
            return <Badge variant="secondary">{status}</Badge>;
    }
}

function ResponseTimeBadge({ ms }: { ms: number | null }) {
    if (ms === null) return <span className="text-muted-foreground">—</span>;
    const color = ms < 500 ? 'text-emerald-600 dark:text-emerald-400' : ms < 2000 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
    return (
        <span className={`font-mono text-xs ${color}`}>
            {ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}
        </span>
    );
}

export default function ForwardingLogsIndex({ logs, stats, loggers, filters }: PageProps) {
    const [localFilters, setLocalFilters] = useState<Filters>(filters);
    const [detailLog, setDetailLog] = useState<LogEntry | null>(null);
    const [isFiltering, setIsFiltering] = useState(false);
    const [showRawPayload, setShowRawPayload] = useState(false);

    // Sync local filter state whenever server-returned filters prop changes
    useEffect(() => {
        setLocalFilters({
            status: filters.status || 'all',
            target: filters.target || '',
            logger_id: filters.logger_id || '',
            from: filters.from || '',
            to: filters.to || '',
        });
    }, [filters.status, filters.target, filters.logger_id, filters.from, filters.to]);

    function applyFilters(overrides: Partial<Filters> = {}) {
        const merged = { ...localFilters, ...overrides };
        setLocalFilters(merged);
        setIsFiltering(true);

        const params: Record<string, string> = {};
        if (merged.status && merged.status !== 'all') params.status = merged.status;
        if (merged.target) params.target = merged.target;
        if (merged.logger_id && merged.logger_id !== 'all') params.logger_id = merged.logger_id;
        if (merged.from) params.from = merged.from;
        if (merged.to) params.to = merged.to;

        router.get('/forwarding-logs', params, {
            preserveState: true,
            preserveScroll: true,
            onFinish: () => setIsFiltering(false),
        });
    }

    function clearFilters() {
        const defaults: Filters = { status: 'all', target: '', logger_id: '', from: '', to: '' };
        setLocalFilters(defaults);
        setIsFiltering(true);
        router.get('/forwarding-logs', {}, {
            preserveState: true,
            preserveScroll: true,
            onFinish: () => setIsFiltering(false),
        });
    }

    function goToPage(page: number) {
        const params: Record<string, string> = { page: String(page) };
        if (localFilters.status && localFilters.status !== 'all') params.status = localFilters.status;
        if (localFilters.target) params.target = localFilters.target;
        if (localFilters.logger_id && localFilters.logger_id !== 'all') params.logger_id = localFilters.logger_id;
        if (localFilters.from) params.from = localFilters.from;
        if (localFilters.to) params.to = localFilters.to;
        router.get('/forwarding-logs', params, { preserveState: true, preserveScroll: true });
    }

    const hasActiveFilters = localFilters.status !== 'all' || localFilters.target || localFilters.logger_id || localFilters.from || localFilters.to;
    const successRate = stats.totalToday > 0 ? Math.round((stats.successToday / (stats.totalToday - stats.skippedToday || 1)) * 100) : 0;

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Forwarding Logs" />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* Header */}
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <ArrowUpDown className="size-6" />
                        Forwarding Logs
                    </h1>
                </div>

                {/* Summary Cards */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardContent className="flex items-center gap-4 px-4 py-0">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-500/10">
                                <Zap className="size-6 text-blue-500" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm text-muted-foreground">Total Hari Ini</p>
                                <p className="text-2xl font-bold">{stats.totalToday}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex items-center gap-4 px-4 py-0">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
                                <CheckCircle2 className="size-6 text-emerald-500" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm text-muted-foreground">Success</p>
                                <p className="text-2xl font-bold text-emerald-600">{stats.successToday}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex items-center gap-4 px-4 py-0">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-500/10">
                                <XCircle className="size-6 text-red-500" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm text-muted-foreground">Error</p>
                                <p className="text-2xl font-bold text-red-600">{stats.errorToday}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex items-center gap-4 px-4 py-0">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-500/10">
                                <SkipForward className="size-6 text-violet-500" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm text-muted-foreground">Skipped</p>
                                <p className="text-2xl font-bold">{stats.skippedToday}
                                    <span className="ml-2 text-xs font-normal text-muted-foreground">({successRate}% rate)</span>
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Filters */}
                <Card>
                    <CardContent className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2.5">
                            <div className="flex items-center gap-2 pr-1 text-sm font-semibold text-foreground/80">
                                <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                    <Filter className="size-3.5" />
                                </span>
                                Filter
                            </div>
                            <div className="w-[150px]">
                                <Select
                                    key={`status-${localFilters.status}`}
                                    value={localFilters.status || 'all'}
                                    onValueChange={(v) => applyFilters({ status: v })}
                                >
                                    <SelectTrigger className="h-10 rounded-lg border-border/60 bg-muted/40 text-sm font-medium shadow-sm transition-colors hover:bg-muted focus:ring-2 focus:ring-primary/20">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Semua Status</SelectItem>
                                        <SelectItem value="success">Success</SelectItem>
                                        <SelectItem value="error">Error</SelectItem>
                                        <SelectItem value="skipped">Skipped</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="w-[230px] min-w-0">
                                <Select
                                    key={`logger-${localFilters.logger_id}`}
                                    value={localFilters.logger_id || 'all'}
                                    onValueChange={(v) => applyFilters({ logger_id: v === 'all' ? '' : v })}
                                >
                                    <SelectTrigger className="h-10 rounded-lg border-border/60 bg-muted/40 text-sm font-medium shadow-sm transition-colors hover:bg-muted focus:ring-2 focus:ring-primary/20">
                                        <SelectValue placeholder="Semua Logger" />
                                    </SelectTrigger>
                                    <SelectContent position="popper" className="min-w-[280px]">
                                        <SelectItem value="all">Semua Logger</SelectItem>
                                        {loggers.map((l) => (
                                            <SelectItem key={l.id} value={String(l.id)}>
                                                <span className="flex flex-col leading-tight">
                                                    <span className="truncate">{l.name}</span>
                                                    {l.deviceId && <span className="text-[10px] text-muted-foreground font-mono">{l.deviceId}</span>}
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="relative w-[190px]">
                                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    className="h-10 rounded-lg border-border/60 bg-muted/40 pl-9 text-sm shadow-sm transition-colors hover:bg-muted focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/20"
                                    placeholder="Target name..."
                                    value={localFilters.target}
                                    onChange={(e) => setLocalFilters(p => ({ ...p, target: e.target.value }))}
                                    onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                                />
                            </div>
                            <div className="flex h-10 items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-3 shadow-sm transition-colors focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/20">
                                <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                                <input
                                    type="date"
                                    aria-label="Tanggal mulai"
                                    className="w-[112px] bg-transparent text-sm text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
                                    value={localFilters.from}
                                    onChange={(e) => applyFilters({ from: e.target.value })}
                                />
                                <span className="text-sm text-muted-foreground/60">—</span>
                                <input
                                    type="date"
                                    aria-label="Tanggal akhir"
                                    className="w-[112px] bg-transparent text-sm text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
                                    value={localFilters.to}
                                    onChange={(e) => applyFilters({ to: e.target.value })}
                                />
                            </div>
                            {hasActiveFilters && (
                                <Button variant="ghost" size="sm" className="ml-auto h-10 gap-1 rounded-lg text-sm text-muted-foreground hover:text-foreground" onClick={clearFilters}>
                                    <X className="size-4" /> Clear
                                </Button>
                            )}
                            {isFiltering && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                        </div>
                    </CardContent>
                </Card>

                {/* Table */}
                <Card>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[150px]">Waktu</TableHead>
                                        <TableHead>Logger</TableHead>
                                        <TableHead>Target</TableHead>
                                        <TableHead className="w-[100px]">Status</TableHead>
                                        <TableHead className="w-[80px] text-center">HTTP</TableHead>
                                        <TableHead className="w-[90px] text-right">Response</TableHead>
                                        <TableHead className="w-[80px] text-center">Sensor</TableHead>
                                        <TableHead className="w-[60px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {logs.data.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="py-16 text-center">
                                                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                                    <ArrowUpDown className="size-10 opacity-30" />
                                                    <p>Belum ada log forwarding</p>
                                                    <p className="text-xs">Log akan muncul setiap kali data diteruskan ke platform integrasi</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : logs.data.map((log) => (
                                        <TableRow
                                            key={log.id}
                                            className="cursor-pointer hover:bg-muted/50 transition-colors"
                                            onClick={() => setDetailLog(log)}
                                        >
                                            <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                                                {log.createdAt}
                                            </TableCell>
                                            <TableCell>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium truncate">{log.loggerName}</p>
                                                    <p className="text-[11px] text-muted-foreground font-mono">{log.deviceId}</p>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium truncate">{log.targetName}</p>
                                                    <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">{log.targetUrl}</p>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <StatusBadge status={log.status} />
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {log.httpStatus ? (
                                                    <span className={`font-mono text-xs font-semibold ${
                                                        log.httpStatus < 300 ? 'text-emerald-600' :
                                                        log.httpStatus < 500 ? 'text-amber-600' : 'text-red-600'
                                                    }`}>
                                                        {log.httpStatus}
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <ResponseTimeBadge ms={log.responseTimeMs} />
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <span className="text-xs font-medium">{log.payloadSummary?.sensor_count ?? '—'}</span>
                                            </TableCell>
                                            <TableCell>
                                                <Button variant="ghost" size="icon" className="size-7" onClick={(e) => { e.stopPropagation(); setDetailLog(log); }}>
                                                    <Info className="size-3.5" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Pagination */}
                        {logs.last_page > 1 && (
                            <div className="flex items-center justify-between border-t px-4 py-3">
                                <p className="text-xs text-muted-foreground">
                                    {logs.from}–{logs.to} dari {logs.total} entries
                                </p>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="size-8"
                                        disabled={logs.current_page <= 1}
                                        onClick={() => goToPage(logs.current_page - 1)}
                                    >
                                        <ChevronLeft className="size-4" />
                                    </Button>
                                    {Array.from({ length: Math.min(logs.last_page, 5) }, (_, i) => {
                                        let page: number;
                                        if (logs.last_page <= 5) {
                                            page = i + 1;
                                        } else if (logs.current_page <= 3) {
                                            page = i + 1;
                                        } else if (logs.current_page >= logs.last_page - 2) {
                                            page = logs.last_page - 4 + i;
                                        } else {
                                            page = logs.current_page - 2 + i;
                                        }
                                        return (
                                            <Button
                                                key={page}
                                                variant={page === logs.current_page ? 'default' : 'outline'}
                                                size="icon"
                                                className="size-8 text-xs"
                                                onClick={() => goToPage(page)}
                                            >
                                                {page}
                                            </Button>
                                        );
                                    })}
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="size-8"
                                        disabled={logs.current_page >= logs.last_page}
                                        onClick={() => goToPage(logs.current_page + 1)}
                                    >
                                        <ChevronRight className="size-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Detail Dialog */}
                <Dialog open={!!detailLog} onOpenChange={(open) => { if (!open) setDetailLog(null); }}>
                    <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <ArrowUpDown className="size-5" />
                                Detail Forwarding Log
                            </DialogTitle>
                            <DialogDescription>
                                {detailLog?.targetName} — {detailLog?.createdAt}
                            </DialogDescription>
                        </DialogHeader>
                        {detailLog && (
                            <div className="space-y-4 py-2">
                                {/* Status */}
                                <div className="flex items-center gap-3">
                                    <StatusBadge status={detailLog.status} />
                                    {detailLog.httpStatus && (
                                        <span className="font-mono text-sm">HTTP {detailLog.httpStatus}</span>
                                    )}
                                    {detailLog.responseTimeMs !== null && (
                                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                            <Clock className="size-3" />
                                            <ResponseTimeBadge ms={detailLog.responseTimeMs} />
                                        </span>
                                    )}
                                </div>

                                {/* Error message */}
                                {detailLog.errorMessage && (
                                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                                        <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1 flex items-center gap-1">
                                            <AlertTriangle className="size-3" /> Error
                                        </p>
                                        <p className="text-xs text-red-600/80 dark:text-red-400/80 break-all">{detailLog.errorMessage}</p>
                                    </div>
                                )}

                                {/* Info grid */}
                                <div className="rounded-lg border bg-muted/30 p-3">
                                    <div className="grid grid-cols-[100px_1fr] gap-y-2 text-xs">
                                        <span className="text-muted-foreground">Logger</span>
                                        <span className="font-medium">{detailLog.loggerName} <span className="text-muted-foreground font-mono">({detailLog.deviceId})</span></span>

                                        <span className="text-muted-foreground">Serial</span>
                                        <span className="font-mono">{detailLog.loggerSerial}</span>

                                        <span className="text-muted-foreground">Target</span>
                                        <span className="font-medium">{detailLog.targetName}</span>

                                        <span className="text-muted-foreground">URL</span>
                                        <span className="font-mono text-[11px] break-all flex items-center gap-1">
                                            {detailLog.targetUrl}
                                            <a href={detailLog.targetUrl} target="_blank" rel="noreferrer" className="shrink-0 text-primary hover:text-primary/80">
                                                <ExternalLink className="size-3" />
                                            </a>
                                        </span>

                                        <span className="text-muted-foreground">Waktu</span>
                                        <span className="font-mono">{detailLog.createdAt}</span>
                                    </div>
                                </div>

                                {/* Payload summary */}
                                {detailLog.payloadSummary && (
                                    <div className="rounded-lg border bg-muted/30 p-3">
                                        <p className="text-xs font-medium mb-2">Payload Summary</p>
                                        <div className="grid grid-cols-[100px_1fr] gap-y-2 text-xs">
                                            <span className="text-muted-foreground">ID Alat</span>
                                            <span className="font-mono">{detailLog.payloadSummary.id_alat}</span>

                                            <span className="text-muted-foreground">Timestamp</span>
                                            <span className="font-mono">{detailLog.payloadSummary.hari} {detailLog.payloadSummary.jam}</span>

                                            <span className="text-muted-foreground">Jumlah Sensor</span>
                                            <span className="font-semibold">{detailLog.payloadSummary.sensor_count}</span>

                                            <span className="text-muted-foreground">Sensors</span>
                                            <div className="flex flex-wrap gap-1">
                                                {detailLog.payloadSummary.sensors.map((name, i) => (
                                                    <span key={i} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                                        {name}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Raw JSON Payload */}
                                {detailLog.rawPayload && (
                                    <div className="rounded-lg border bg-muted/30">
                                        <button
                                            type="button"
                                            className="flex w-full items-center justify-between p-3 text-xs font-medium hover:bg-muted/50 transition-colors"
                                            onClick={() => setShowRawPayload(!showRawPayload)}
                                        >
                                            <span className="flex items-center gap-1.5">
                                                <Code className="size-3.5" />
                                                Raw JSON Payload
                                            </span>
                                            <ChevronDown className={`size-4 transition-transform ${showRawPayload ? 'rotate-180' : ''}`} />
                                        </button>
                                        {showRawPayload && (
                                            <div className="border-t px-3 pb-3">
                                                <pre className="mt-2 max-h-[300px] overflow-auto rounded-md bg-zinc-950 p-3 text-[11px] leading-relaxed text-emerald-400 font-mono">
                                                    {JSON.stringify(detailLog.rawPayload, null, 2)}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </DialogContent>
                </Dialog>
            </div>
        </AppLayout>
    );
}
