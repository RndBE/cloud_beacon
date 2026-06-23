import { Head, Link } from '@inertiajs/react';
import { Filter, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
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
import type { BreadcrumbItem } from '@/types';

type Project = {
    id: number;
    name: string;
    color: string | null;
};

type AuditRow = {
    id: number;
    date: string;
    expected: number;
    present: number;
    missing: number;
    logger: {
        id: number;
        name: string;
        device_identifier: string;
        project: Project | null;
    };
};

interface DataAuditIndexProps {
    audits: AuditRow[];
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Data Audit', href: '/data-audit' },
];

function completenessPercent(row: AuditRow): number {
    if (row.expected === 0) return 100;
    return Math.min(100, Math.round((row.present / row.expected) * 100));
}

function completenessTone(pct: number): string {
    if (pct >= 99) return 'text-emerald-600 dark:text-emerald-400';
    if (pct >= 90) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
}

export default function DataAuditIndex({ audits }: DataAuditIndexProps) {
    const { t } = useTranslation();

    const [projectId, setProjectId] = useState('all');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('all');

    // Distinct projects present in the current audit rows (for the dropdown).
    const projects = useMemo(() => {
        const map = new Map<number, Project>();
        for (const row of audits) {
            if (row.logger.project) map.set(row.logger.project.id, row.logger.project);
        }
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [audits]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return audits.filter((row) => {
            if (projectId !== 'all') {
                if (String(row.logger.project?.id ?? '') !== projectId) return false;
            }
            if (status === 'incomplete' && row.missing === 0) return false;
            if (status === 'complete' && row.missing > 0) return false;
            if (q) {
                const hay = `${row.logger.name} ${row.logger.device_identifier}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [audits, projectId, status, search]);

    const hasActiveFilters = projectId !== 'all' || status !== 'all' || search.trim() !== '';

    function clearFilters() {
        setProjectId('all');
        setStatus('all');
        setSearch('');
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Data Audit" />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{t('data_audit.title', 'Data Audit')}</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {t('data_audit.description', 'Latest completeness summary per logger, sorted by most missing records.')}
                    </p>
                </div>

                {/* ── Filters ─────────────────────────────────────────── */}
                <Card>
                    <CardContent className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2.5">
                            <div className="flex items-center gap-2 pr-1 text-sm font-semibold text-foreground/80">
                                <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                    <Filter className="size-3.5" />
                                </span>
                                {t('common.filter', 'Filter')}
                            </div>

                            {/* Project */}
                            <div className="w-[200px] min-w-0">
                                <Select value={projectId} onValueChange={setProjectId}>
                                    <SelectTrigger className="h-10 rounded-lg border-border/60 bg-muted/40 text-sm font-medium shadow-sm transition-colors hover:bg-muted focus:ring-2 focus:ring-primary/20">
                                        <SelectValue placeholder={t('data_audit.all_projects', 'All projects')} />
                                    </SelectTrigger>
                                    <SelectContent position="popper" className="min-w-[220px]">
                                        <SelectItem value="all">{t('data_audit.all_projects', 'All projects')}</SelectItem>
                                        {projects.map((p) => (
                                            <SelectItem key={p.id} value={String(p.id)}>
                                                <span className="flex items-center gap-2">
                                                    <span
                                                        className="size-2.5 shrink-0 rounded-full"
                                                        style={{ backgroundColor: p.color ?? 'var(--muted-foreground)' }}
                                                    />
                                                    <span className="truncate">{p.name}</span>
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Completeness status */}
                            <div className="w-[170px]">
                                <Select value={status} onValueChange={setStatus}>
                                    <SelectTrigger className="h-10 rounded-lg border-border/60 bg-muted/40 text-sm font-medium shadow-sm transition-colors hover:bg-muted focus:ring-2 focus:ring-primary/20">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">{t('data_audit.all_status', 'All status')}</SelectItem>
                                        <SelectItem value="incomplete">{t('data_audit.incomplete', 'Has gaps')}</SelectItem>
                                        <SelectItem value="complete">{t('data_audit.complete', 'Complete')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Search */}
                            <div className="relative w-[220px]">
                                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    className="h-10 rounded-lg border-border/60 bg-muted/40 pl-9 text-sm shadow-sm transition-colors hover:bg-muted focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/20"
                                    placeholder={t('data_audit.search_logger', 'Search logger…')}
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>

                            <span className="text-sm text-muted-foreground">
                                {filtered.length} / {audits.length}
                            </span>

                            {hasActiveFilters && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="ml-auto h-10 gap-1 rounded-lg text-sm text-muted-foreground hover:text-foreground"
                                    onClick={clearFilters}
                                >
                                    <X className="size-4" /> {t('common.clear', 'Clear')}
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* ── Table ───────────────────────────────────────────── */}
                <Card>
                    <CardHeader>
                        <CardTitle>{t('data_audit.title', 'Data Audit')}</CardTitle>
                        <CardDescription>
                            {t('data_audit.description', 'Latest completeness summary per logger, sorted by most missing records.')}
                        </CardDescription>
                    </CardHeader>
                    <Separator />
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('data_audit.logger', 'Logger')}</TableHead>
                                    <TableHead>{t('data_audit.project', 'Project')}</TableHead>
                                    <TableHead>{t('data_audit.date', 'Date')}</TableHead>
                                    <TableHead>{t('data_audit.completeness', 'Completeness')}</TableHead>
                                    <TableHead>{t('data_audit.missing', 'Missing')}</TableHead>
                                    <TableHead className="w-[80px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                                            {audits.length === 0
                                                ? t('data_audit.no_data', 'No audit data yet.')
                                                : t('data_audit.no_match', 'No loggers match the current filters.')}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filtered.map((row) => {
                                        const pct = completenessPercent(row);
                                        return (
                                            <TableRow key={row.id}>
                                                <TableCell>
                                                    <div className="font-medium">{row.logger.name}</div>
                                                    <div className="text-xs text-muted-foreground font-mono">{row.logger.device_identifier}</div>
                                                </TableCell>
                                                <TableCell>
                                                    {row.logger.project ? (
                                                        <span className="inline-flex items-center gap-2 text-sm">
                                                            <span
                                                                className="size-2.5 shrink-0 rounded-full"
                                                                style={{ backgroundColor: row.logger.project.color ?? 'var(--muted-foreground)' }}
                                                            />
                                                            {row.logger.project.name}
                                                        </span>
                                                    ) : (
                                                        <span className="text-sm text-muted-foreground">—</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-sm">{row.date}</TableCell>
                                                <TableCell>
                                                    <span className={`text-sm font-semibold ${completenessTone(pct)}`}>
                                                        {pct}%
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-sm">{row.missing}</TableCell>
                                                <TableCell>
                                                    <Link
                                                        href={`/data-audit/${row.logger.id}?date=${row.date}`}
                                                        className="text-sm text-primary underline-offset-4 hover:underline"
                                                    >
                                                        {t('data_audit.view', 'View')}
                                                    </Link>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
