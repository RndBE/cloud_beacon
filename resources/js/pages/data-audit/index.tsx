import { Head, Link } from '@inertiajs/react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    return Math.round((row.present / row.expected) * 100);
}

function completenessTone(pct: number): string {
    if (pct >= 99) return 'text-emerald-600 dark:text-emerald-400';
    if (pct >= 90) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
}

export default function DataAuditIndex({ audits }: DataAuditIndexProps) {
    const { t } = useTranslation();

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Data Audit" />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle>{t('data_audit.title', 'Data Audit')}</CardTitle>
                                <CardDescription>
                                    {t('data_audit.description', 'Latest completeness summary per logger, sorted by most missing records.')}
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <Separator />
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('data_audit.logger', 'Logger')}</TableHead>
                                    <TableHead>{t('data_audit.date', 'Date')}</TableHead>
                                    <TableHead>{t('data_audit.completeness', 'Completeness')}</TableHead>
                                    <TableHead>{t('data_audit.missing', 'Missing')}</TableHead>
                                    <TableHead className="w-[80px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {audits.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                                            {t('data_audit.no_data', 'No audit data yet.')}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    audits.map((row) => {
                                        const pct = completenessPercent(row);
                                        return (
                                            <TableRow key={row.id}>
                                                <TableCell>
                                                    <div className="font-medium">{row.logger.name}</div>
                                                    <div className="text-xs text-muted-foreground font-mono">{row.logger.device_identifier}</div>
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
