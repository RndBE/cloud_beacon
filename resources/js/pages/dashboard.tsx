import { Head, Link } from '@inertiajs/react';
import { lazy, Suspense } from 'react';
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    CloudDownload,
    HardDrive,
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

export default function Dashboard({ stats, recentActivity, loggers }: DashboardProps) {
    const activeAlerts = stats.warningLoggers + stats.offlineLoggers;

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Dashboard" />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* Stats Row */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardContent className="flex items-center gap-4 pt-2">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-500/10">
                                <Radio className="size-6 text-blue-500" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm text-muted-foreground">Total Loggers</p>
                                <p className="text-2xl font-bold">{stats.totalLoggers}</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="flex items-center gap-4 pt-2">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
                                <Wifi className="size-6 text-emerald-500" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm text-muted-foreground">Online</p>
                                <p className="text-2xl font-bold text-emerald-600">{stats.onlineLoggers}</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="flex items-center gap-4 pt-2">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-500/10">
                                <AlertTriangle className="size-6 text-red-500" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm text-muted-foreground">Active Alerts</p>
                                <p className="text-2xl font-bold text-red-600">{activeAlerts}</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="flex items-center gap-4 pt-2">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-500/10">
                                <Activity className="size-6 text-violet-500" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm text-muted-foreground">Active Sensors</p>
                                <p className="text-2xl font-bold">{stats.activeSensors}<span className="text-sm font-normal text-muted-foreground">/{stats.totalSensors}</span></p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Logger Map */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <MapPin className="size-5" />
                            Logger Distribution Map
                        </CardTitle>
                        <CardDescription>Geographic overview of all loggers</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Suspense fallback={
                            <div className="flex h-[400px] items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                                Loading map...
                            </div>
                        }>
                            <LoggerMap loggers={loggers} />
                        </Suspense>
                    </CardContent>
                </Card>

                {/* Middle Row */}
                <div className="grid gap-4 lg:grid-cols-3">
                    <Card className="lg:col-span-2">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Server className="size-5" />
                                Logger Health
                            </CardTitle>
                            <CardDescription>Connection status overview</CardDescription>
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

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <HardDrive className="size-5" />
                                Quick Actions
                            </CardTitle>
                            <CardDescription>Batch operations</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-3">
                                <Button variant="outline" className="justify-start gap-2">
                                    <RefreshCw className="size-4" />
                                    Sync All Configs
                                </Button>
                                <Button variant="outline" className="justify-start gap-2">
                                    <Power className="size-4" />
                                    Reboot All Devices
                                </Button>
                                <Button variant="outline" className="justify-start gap-2">
                                    <Save className="size-4" />
                                    Backup All Configs
                                </Button>
                                <Button variant="outline" className="justify-start gap-2">
                                    <CloudDownload className="size-4" />
                                    Check Firmware Updates
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Recent Activity */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Activity className="size-5" />
                                    Recent Activity
                                </CardTitle>
                                <CardDescription>Latest events across all loggers</CardDescription>
                            </div>
                            <Link href="/loggers">
                                <Button variant="ghost" size="sm" className="gap-1">
                                    View all loggers
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
                                    <TableHead className="w-[180px]">Timestamp</TableHead>
                                    <TableHead>Device</TableHead>
                                    <TableHead>Action</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="hidden lg:table-cell">Message</TableHead>
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
                                            No recent activity.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
