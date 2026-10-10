import { Cctv, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';

export interface SecurityCamLog {
    id: number | string;
    capturedAt: string;
    camera: string;
    event: string;
    message: string | null;
    snapshotUrl: string | null;
}

// Placeholder slot: no camera feed is wired yet, so the logger page renders it with no logs.
export function SecurityCamCard({ logs = [] }: { logs?: SecurityCamLog[] }) {
    return (
        <Card>
            <CardHeader className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base">
                    <Cctv className="size-4" />
                    Security Cam Logs
                </CardTitle>
                <CardDescription>
                    Riwayat event kamera keamanan yang terpasang di logger.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {logs.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border/60 px-4 py-10 text-center">
                        <Cctv className="size-8 text-muted-foreground" />
                        <p className="text-sm font-medium">
                            Belum ada log Security Cam
                        </p>
                        <p className="max-w-md text-xs text-muted-foreground">
                            Event dari kamera (gerakan, akses pintu, kamera
                            offline) akan tampil di sini setelah kamera
                            terhubung ke logger.
                        </p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Waktu</TableHead>
                                <TableHead>Kamera</TableHead>
                                <TableHead>Event</TableHead>
                                <TableHead>Keterangan</TableHead>
                                <TableHead className="text-right">
                                    Snapshot
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {logs.map((log) => (
                                <TableRow key={log.id}>
                                    <TableCell className="whitespace-nowrap">
                                        {new Date(
                                            log.capturedAt,
                                        ).toLocaleString('id-ID')}
                                    </TableCell>
                                    <TableCell>{log.camera}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline">
                                            {log.event}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {log.message ?? '—'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {log.snapshotUrl ? (
                                            <a
                                                href={log.snapshotUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                                            >
                                                Lihat
                                                <ExternalLink className="size-3" />
                                            </a>
                                        ) : (
                                            '—'
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}
