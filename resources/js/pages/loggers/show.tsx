import { Head, Link, router } from '@inertiajs/react';
import {
    Activity,
    AlertTriangle,
    ArrowLeft,
    CheckCircle2,
    Clock,
    Cpu,
    Database,
    Download,
    HardDrive,
    MapPin,
    MemoryStick,
    Network,
    Plug,
    Power,
    Radio,
    RefreshCw,
    RotateCcw,
    Save,
    Settings,
    Signal,
    Terminal,
    Thermometer,
    Trash2,
    Upload,
    Wifi,
    XCircle,
    Zap,
} from 'lucide-react';
import { useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

interface SensorItem {
    id: number;
    name: string;
    type: string;
    value: number;
    unit: string;
    status: 'active' | 'inactive' | 'error';
    lastReading: string;
    min: number;
    max: number;
}

interface LogItem {
    id: number;
    timestamp: string;
    action: string;
    status: 'success' | 'failed' | 'pending';
    level: 'info' | 'warning' | 'error' | 'debug';
    message: string;
}

interface LoggerDetail {
    id: number;
    name: string;
    serialNumber: string;
    location: string;
    status: 'online' | 'offline' | 'warning';
    connectionType: string;
    firmwareVersion: string;
    lastSeen: string;
    ipAddress: string;
    macAddress: string;
    model: string;
    uptime: string;
    cpuUsage: number;
    memoryUsage: number;
    memoryTotal: number;
    storageUsage: number;
    storageTotal: number;
    signalStrength: number;
    dataUsage: string;
    gateway: string;
    dns: string;
    subnet: string;
    logFileCount: number;
    configBackups: number;
    lastConfigBackup: string;
    sensors: SensorItem[];
    activityLogs: LogItem[];
}

interface LoggerShowProps {
    logger: LoggerDetail;
}

function getStatusBadgeVariant(status: string): 'default' | 'destructive' | 'secondary' {
    switch (status) {
        case 'online': return 'default';
        case 'offline': return 'destructive';
        case 'warning': return 'secondary';
        default: return 'secondary';
    }
}

function getLogLevelColor(level: string) {
    switch (level) {
        case 'info': return 'text-blue-500';
        case 'warning': return 'text-amber-500';
        case 'error': return 'text-red-500';
        default: return 'text-muted-foreground';
    }
}

export default function LoggerShow({ logger }: LoggerShowProps) {
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    const breadcrumbs: BreadcrumbItem[] = [
        { title: 'Dashboard', href: '/dashboard' },
        { title: 'Loggers', href: '/loggers' },
        { title: logger.name, href: `/loggers/${logger.id}` },
    ];

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={logger.name} />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* Back link */}
                <Link href="/loggers" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
                    <ArrowLeft className="size-4" />
                    Back to loggers
                </Link>

                {/* Device Header */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-4">
                        <div className={`mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                            logger.status === 'online' ? 'bg-emerald-500/10' :
                            logger.status === 'warning' ? 'bg-amber-500/10' : 'bg-red-500/10'
                        }`}>
                            <Radio className={`size-6 ${
                                logger.status === 'online' ? 'text-emerald-500' :
                                logger.status === 'warning' ? 'text-amber-500' : 'text-red-500'
                            }`} />
                        </div>
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-xl font-bold">{logger.name}</h1>
                                <Badge variant={getStatusBadgeVariant(logger.status)} className="capitalize">
                                    {logger.status}
                                </Badge>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1">
                                    <Terminal className="size-3.5" />
                                    {logger.serialNumber}
                                </span>
                                {logger.location && (
                                    <span className="flex items-center gap-1">
                                        <MapPin className="size-3.5" />
                                        {logger.location}
                                    </span>
                                )}
                                {logger.model && (
                                    <span className="flex items-center gap-1">
                                        <Cpu className="size-3.5" />
                                        {logger.model}
                                    </span>
                                )}
                                {logger.firmwareVersion && <span className="font-mono text-xs">{logger.firmwareVersion}</span>}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5" disabled={logger.status === 'offline'}>
                            <Plug className="size-4" />
                            Connect
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5" disabled={logger.status === 'offline'}>
                            <RefreshCw className="size-4" />
                            Sync
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5" disabled={logger.status === 'offline'}>
                            <Save className="size-4" />
                            Save Config
                        </Button>
                        <Button variant="destructive" size="sm" className="gap-1.5" disabled={logger.status === 'offline'}>
                            <Power className="size-4" />
                            Reboot
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                            onClick={() => setShowDeleteDialog(true)}
                        >
                            <Trash2 className="size-4" />
                            Delete
                        </Button>
                    </div>
                </div>

                <Separator />

                {/* Tabs */}
                <Tabs defaultValue="overview" className="w-full">
                    <TabsList className="w-full justify-start overflow-x-auto">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="sensors">Sensors</TabsTrigger>
                        <TabsTrigger value="network">Network</TabsTrigger>
                        <TabsTrigger value="system">System</TabsTrigger>
                        <TabsTrigger value="storage">Storage</TabsTrigger>
                        <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
                        <TabsTrigger value="logs">Logs</TabsTrigger>
                    </TabsList>

                    {/* ==================== OVERVIEW ==================== */}
                    <TabsContent value="overview" className="mt-6">
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <InfoCard icon={Wifi} label="Connection" value={logger.connectionType.toUpperCase()} color="blue" />
                            <InfoCard icon={Signal} label="Signal Strength" value={`${logger.signalStrength}%`} color="emerald" />
                            <InfoCard icon={Clock} label="Uptime" value={logger.uptime || '—'} color="violet" />
                            <InfoCard icon={Activity} label="Active Sensors" value={`${logger.sensors.filter(s => s.status === 'active').length}/${logger.sensors.length}`} color="amber" />
                        </div>

                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                            <Card>
                                <CardHeader><CardTitle>Device Info</CardTitle></CardHeader>
                                <CardContent>
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                        <dt className="text-muted-foreground">Model</dt>
                                        <dd className="font-medium">{logger.model || '—'}</dd>
                                        <dt className="text-muted-foreground">Serial Number</dt>
                                        <dd className="font-mono text-xs">{logger.serialNumber}</dd>
                                        <dt className="text-muted-foreground">Firmware</dt>
                                        <dd className="font-mono text-xs">{logger.firmwareVersion || '—'}</dd>
                                        <dt className="text-muted-foreground">IP Address</dt>
                                        <dd className="font-mono text-xs">{logger.ipAddress || '—'}</dd>
                                        <dt className="text-muted-foreground">MAC Address</dt>
                                        <dd className="font-mono text-xs">{logger.macAddress || '—'}</dd>
                                        <dt className="text-muted-foreground">Last Seen</dt>
                                        <dd className="text-xs">{logger.lastSeen || '—'}</dd>
                                    </dl>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle>Resource Usage</CardTitle></CardHeader>
                                <CardContent className="space-y-5">
                                    <ResourceBar label="CPU" value={logger.cpuUsage} max={100} unit="%" />
                                    <ResourceBar label="Memory" value={logger.memoryUsage} max={logger.memoryTotal} unit="MB" />
                                    <ResourceBar label="Storage" value={logger.storageUsage} max={logger.storageTotal} unit="GB" />
                                </CardContent>
                            </Card>
                        </div>

                        <Card className="mt-4">
                            <CardHeader>
                                <CardTitle>Sensor Summary</CardTitle>
                                <CardDescription>Latest readings from all channels</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                    {logger.sensors.map((sensor) => (
                                        <div key={sensor.id} className="flex items-center gap-3 rounded-lg border p-3">
                                            <div className={`h-2 w-2 rounded-full ${sensor.status === 'active' ? 'bg-emerald-500' : sensor.status === 'error' ? 'bg-red-500' : 'bg-gray-400'}`} />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs text-muted-foreground">{sensor.name}</p>
                                                <p className="font-mono text-sm font-semibold">{sensor.value} <span className="text-xs font-normal text-muted-foreground">{sensor.unit}</span></p>
                                            </div>
                                        </div>
                                    ))}
                                    {logger.sensors.length === 0 && <p className="text-sm text-muted-foreground col-span-full">No sensors configured.</p>}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ==================== SENSORS ==================== */}
                    <TabsContent value="sensors" className="mt-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><Thermometer className="size-5" /> Sensor Channels</CardTitle>
                                <CardDescription>{logger.sensors.length} channels configured</CardDescription>
                            </CardHeader>
                            <Separator />
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Channel</TableHead>
                                            <TableHead>Type</TableHead>
                                            <TableHead>Value</TableHead>
                                            <TableHead>Range</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="hidden md:table-cell">Last Reading</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {logger.sensors.map((sensor) => (
                                            <TableRow key={sensor.id}>
                                                <TableCell className="font-medium">{sensor.name}</TableCell>
                                                <TableCell className="capitalize text-muted-foreground">{sensor.type.replace('-', ' ')}</TableCell>
                                                <TableCell className="font-mono font-semibold">{sensor.value} <span className="text-xs font-normal text-muted-foreground">{sensor.unit}</span></TableCell>
                                                <TableCell className="font-mono text-xs text-muted-foreground">{sensor.min} – {sensor.max} {sensor.unit}</TableCell>
                                                <TableCell>
                                                    <Badge variant={sensor.status === 'active' ? 'default' : sensor.status === 'error' ? 'destructive' : 'secondary'} className="capitalize text-xs">
                                                        {sensor.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{sensor.lastReading || '—'}</TableCell>
                                            </TableRow>
                                        ))}
                                        {logger.sensors.length === 0 && (
                                            <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground">No sensors configured.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ==================== NETWORK ==================== */}
                    <TabsContent value="network" className="mt-6">
                        <div className="grid gap-4 lg:grid-cols-2">
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><Network className="size-5" /> Network Configuration</CardTitle></CardHeader>
                                <CardContent>
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                        <dt className="text-muted-foreground">Connection Type</dt>
                                        <dd className="font-medium uppercase">{logger.connectionType}</dd>
                                        <dt className="text-muted-foreground">IP Address</dt>
                                        <dd className="font-mono text-xs">{logger.ipAddress || '—'}</dd>
                                        <dt className="text-muted-foreground">Subnet Mask</dt>
                                        <dd className="font-mono text-xs">{logger.subnet || '—'}</dd>
                                        <dt className="text-muted-foreground">Gateway</dt>
                                        <dd className="font-mono text-xs">{logger.gateway || '—'}</dd>
                                        <dt className="text-muted-foreground">DNS Server</dt>
                                        <dd className="font-mono text-xs">{logger.dns || '—'}</dd>
                                        <dt className="text-muted-foreground">MAC Address</dt>
                                        <dd className="font-mono text-xs">{logger.macAddress || '—'}</dd>
                                    </dl>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><Signal className="size-5" /> Connection Status</CardTitle></CardHeader>
                                <CardContent className="space-y-5">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-sm">
                                            <span>Signal Strength</span>
                                            <span className="font-medium">{logger.signalStrength}%</span>
                                        </div>
                                        <Progress value={logger.signalStrength} className={`h-2 ${logger.signalStrength > 70 ? '[&>div]:bg-emerald-500' : logger.signalStrength > 40 ? '[&>div]:bg-amber-500' : '[&>div]:bg-red-500'}`} />
                                    </div>
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                        <dt className="text-muted-foreground">Data Usage</dt>
                                        <dd className="font-medium">{logger.dataUsage || '—'}</dd>
                                        <dt className="text-muted-foreground">Last Seen</dt>
                                        <dd className="text-xs">{logger.lastSeen || '—'}</dd>
                                    </dl>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    {/* ==================== SYSTEM ==================== */}
                    <TabsContent value="system" className="mt-6">
                        <div className="grid gap-4 lg:grid-cols-2">
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="size-5" /> System Information</CardTitle></CardHeader>
                                <CardContent>
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                        <dt className="text-muted-foreground">Model</dt>
                                        <dd className="font-medium">{logger.model || '—'}</dd>
                                        <dt className="text-muted-foreground">Serial Number</dt>
                                        <dd className="font-mono text-xs">{logger.serialNumber}</dd>
                                        <dt className="text-muted-foreground">Device ID</dt>
                                        <dd className="font-mono text-xs">{logger.id}</dd>
                                        <dt className="text-muted-foreground">Firmware</dt>
                                        <dd className="font-mono text-xs">{logger.firmwareVersion || '—'}</dd>
                                        <dt className="text-muted-foreground">Uptime</dt>
                                        <dd className="font-medium">{logger.uptime || '—'}</dd>
                                        <dt className="text-muted-foreground">Location</dt>
                                        <dd>{logger.location || '—'}</dd>
                                    </dl>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><MemoryStick className="size-5" /> Resource Monitor</CardTitle></CardHeader>
                                <CardContent className="space-y-5">
                                    <ResourceBar label="CPU Usage" value={logger.cpuUsage} max={100} unit="%" />
                                    <ResourceBar label="Memory" value={logger.memoryUsage} max={logger.memoryTotal} unit="MB" />
                                    <ResourceBar label="Storage" value={logger.storageUsage} max={logger.storageTotal} unit="GB" />
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    {/* ==================== STORAGE ==================== */}
                    <TabsContent value="storage" className="mt-6">
                        <div className="grid gap-4 lg:grid-cols-2">
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><Database className="size-5" /> Storage Overview</CardTitle></CardHeader>
                                <CardContent className="space-y-5">
                                    <ResourceBar label="Disk Usage" value={logger.storageUsage} max={logger.storageTotal} unit="GB" />
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                        <dt className="text-muted-foreground">Log Files</dt>
                                        <dd className="font-medium">{logger.logFileCount.toLocaleString()}</dd>
                                        <dt className="text-muted-foreground">Config Backups</dt>
                                        <dd className="font-medium">{logger.configBackups}</dd>
                                        <dt className="text-muted-foreground">Last Backup</dt>
                                        <dd className="text-xs">{logger.lastConfigBackup || '—'}</dd>
                                    </dl>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="size-5" /> Storage Management</CardTitle></CardHeader>
                                <CardContent>
                                    <div className="grid gap-3">
                                        <Button variant="outline" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <Trash2 className="size-4" /> Clean Old Logs
                                        </Button>
                                        <Button variant="outline" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <Download className="size-4" /> Export Log Files
                                        </Button>
                                        <Button variant="outline" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <Save className="size-4" /> Backup Configuration
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    {/* ==================== MAINTENANCE ==================== */}
                    <TabsContent value="maintenance" className="mt-6">
                        <div className="grid gap-4 lg:grid-cols-2">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><Zap className="size-5" /> Firmware</CardTitle>
                                    <CardDescription>Current: {logger.firmwareVersion || '—'}</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid gap-3">
                                        <div className="flex items-center justify-between rounded-lg border p-3">
                                            <div>
                                                <p className="text-sm font-medium">Current Firmware</p>
                                                <p className="font-mono text-xs text-muted-foreground">{logger.firmwareVersion || '—'}</p>
                                            </div>
                                            <Badge variant="default">Up to date</Badge>
                                        </div>
                                        <Button variant="outline" className="gap-2" disabled={logger.status === 'offline'}>
                                            <Upload className="size-4" /> Upload Firmware
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><HardDrive className="size-5" /> Device Actions</CardTitle></CardHeader>
                                <CardContent>
                                    <div className="grid gap-3">
                                        <Button variant="outline" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <Power className="size-4" /> Schedule Reboot
                                        </Button>
                                        <Button variant="outline" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <Download className="size-4" /> Export Configuration
                                        </Button>
                                        <Button variant="outline" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <Upload className="size-4" /> Import Configuration
                                        </Button>
                                        <Separator />
                                        <Button variant="destructive" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <RotateCcw className="size-4" /> Factory Reset
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    {/* ==================== LOGS ==================== */}
                    <TabsContent value="logs" className="mt-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><Terminal className="size-5" /> Activity Logs</CardTitle>
                                <CardDescription>{logger.activityLogs.length} log entries</CardDescription>
                            </CardHeader>
                            <Separator />
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[180px]">Timestamp</TableHead>
                                            <TableHead>Level</TableHead>
                                            <TableHead>Action</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="hidden md:table-cell">Message</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {logger.activityLogs.map((log) => (
                                            <TableRow key={log.id}>
                                                <TableCell className="font-mono text-xs text-muted-foreground">{log.timestamp}</TableCell>
                                                <TableCell>
                                                    <span className={`text-xs font-medium uppercase ${getLogLevelColor(log.level)}`}>{log.level}</span>
                                                </TableCell>
                                                <TableCell className="font-medium">{log.action}</TableCell>
                                                <TableCell>
                                                    <Badge variant={log.status === 'success' ? 'default' : log.status === 'failed' ? 'destructive' : 'secondary'} className="text-xs">
                                                        {log.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="hidden max-w-[300px] truncate text-sm text-muted-foreground md:table-cell">{log.message}</TableCell>
                                            </TableRow>
                                        ))}
                                        {logger.activityLogs.length === 0 && (
                                            <TableRow><TableCell colSpan={5} className="py-12 text-center text-muted-foreground">No logs found.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>

                {/* Delete Dialog */}
                <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete Logger</AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to delete <strong>{logger.name}</strong> ({logger.serialNumber})?
                                This will also delete all associated sensors and activity logs. This action cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                className="bg-red-600 hover:bg-red-700"
                                onClick={() => router.delete(`/loggers/${logger.id}`)}
                            >
                                Delete Logger
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </AppLayout>
    );
}

// =============================================================================
// Helper Components
// =============================================================================

function InfoCard({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; color: string }) {
    const colorMap: Record<string, string> = {
        blue: 'bg-blue-500/10 text-blue-500',
        emerald: 'bg-emerald-500/10 text-emerald-500',
        violet: 'bg-violet-500/10 text-violet-500',
        amber: 'bg-amber-500/10 text-amber-500',
    };

    return (
        <Card>
            <CardContent className="flex items-center gap-4 pt-2">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colorMap[color] || ''}`}>
                    <Icon className="size-5" />
                </div>
                <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-lg font-bold">{value}</p>
                </div>
            </CardContent>
        </Card>
    );
}

function ResourceBar({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
    const pct = max > 0 ? (value / max) * 100 : 0;
    const barColor = pct > 80 ? '[&>div]:bg-red-500' : pct > 60 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500';

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
                <span>{label}</span>
                <span className="font-mono text-xs font-medium">{value} / {max} {unit} <span className="text-muted-foreground">({pct.toFixed(0)}%)</span></span>
            </div>
            <Progress value={pct} className={`h-2 ${barColor}`} />
        </div>
    );
}
