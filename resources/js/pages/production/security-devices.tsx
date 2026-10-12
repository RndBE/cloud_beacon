import { Head, Link, router, useForm, usePage } from '@inertiajs/react';
import { Cctv, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import type { FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface SecurityDeviceRow {
    deviceId: string;
    name: string | null;
    online: boolean;
    lastSeenAt: string | null;
    logger: { id: string; name: string; serialNumber: string } | null;
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Production', href: '/production' },
    { title: 'Security System', href: '/production/security-devices' },
];

// Online status comes from the device's last report, so refresh it periodically.
const REFRESH_MS = 30_000;

function formatTime(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString('id-ID') : 'Belum pernah';
}

export default function SecurityDevicesIndex({
    devices,
}: {
    devices: SecurityDeviceRow[];
}) {
    const { auth, flash } = usePage<{
        auth: { permissions?: string[] };
        flash: { success?: string; error?: string };
    }>().props;
    const canRegister = (auth.permissions ?? []).includes('production.create');

    const form = useForm({ device_id: '', name: '' });

    useEffect(() => {
        const interval = setInterval(
            () => router.reload({ only: ['devices'] }),
            REFRESH_MS,
        );
        return () => clearInterval(interval);
    }, []);

    function submit(e: FormEvent) {
        e.preventDefault();
        form.post('/production/security-devices', {
            preserveScroll: true,
            onSuccess: () => form.reset(),
        });
    }

    const stock = devices.filter((d) => d.logger === null).length;

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Security System" />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-semibold">
                            <Cctv className="size-5" /> Security System
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            {devices.length} unit · {stock} stok · dipasang ke
                            logger dari tab Security Cam di halaman logger.
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => router.reload({ only: ['devices'] })}
                    >
                        <RefreshCw className="size-4" /> Muat ulang
                    </Button>
                </div>

                {flash?.success && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                        {flash.success}
                    </div>
                )}

                {canRegister && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">
                                Daftarkan unit baru
                            </CardTitle>
                            <CardDescription>
                                ID alat sama dengan nomor serinya dan menjadi
                                alamat MQTT-nya (pub_/sub_&lt;ID&gt;).
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form
                                onSubmit={submit}
                                className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                            >
                                <div className="space-y-1.5">
                                    <Label htmlFor="device_id">
                                        ID / Serial Number
                                    </Label>
                                    <Input
                                        id="device_id"
                                        value={form.data.device_id}
                                        onChange={(e) =>
                                            form.setData(
                                                'device_id',
                                                e.target.value,
                                            )
                                        }
                                        placeholder="SS0001"
                                        maxLength={31}
                                        className="font-mono"
                                        required
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="name">
                                        Nama (opsional)
                                    </Label>
                                    <Input
                                        id="name"
                                        value={form.data.name}
                                        onChange={(e) =>
                                            form.setData('name', e.target.value)
                                        }
                                        placeholder="Unit produksi batch 1"
                                        maxLength={255}
                                    />
                                </div>
                                <Button
                                    type="submit"
                                    disabled={form.processing}
                                    className="gap-1.5"
                                >
                                    {form.processing ? (
                                        <LoaderCircle className="size-4 animate-spin" />
                                    ) : (
                                        <Plus className="size-4" />
                                    )}
                                    Daftarkan
                                </Button>
                                {(form.errors.device_id ||
                                    form.errors.name) && (
                                    <p className="text-xs text-red-500 sm:col-span-3">
                                        {form.errors.device_id ??
                                            form.errors.name}
                                    </p>
                                )}
                            </form>
                        </CardContent>
                    </Card>
                )}

                <Card>
                    <CardContent className="pt-6">
                        {devices.length === 0 ? (
                            <p className="py-8 text-center text-sm text-muted-foreground">
                                Belum ada unit Security System terdaftar.
                            </p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>ID / SN</TableHead>
                                        <TableHead>Nama</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Dipasang di</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {devices.map((device) => (
                                        <TableRow key={device.deviceId}>
                                            <TableCell className="font-mono font-medium">
                                                {device.deviceId}
                                            </TableCell>
                                            <TableCell>
                                                {device.name ?? (
                                                    <span className="text-muted-foreground">
                                                        —
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col gap-0.5">
                                                    <Badge
                                                        variant="outline"
                                                        className={
                                                            device.online
                                                                ? 'border-emerald-200 text-emerald-600 dark:border-emerald-900'
                                                                : 'border-red-200 text-red-600 dark:border-red-900'
                                                        }
                                                    >
                                                        {device.online
                                                            ? 'Online'
                                                            : 'Offline'}
                                                    </Badge>
                                                    <span className="text-xs text-muted-foreground">
                                                        {formatTime(
                                                            device.lastSeenAt,
                                                        )}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {device.logger ? (
                                                    <Link
                                                        href={`/loggers/${device.logger.id}`}
                                                        className="text-sm text-primary hover:underline"
                                                    >
                                                        {device.logger.name}
                                                        <span className="ml-1 font-mono text-xs text-muted-foreground">
                                                            {
                                                                device.logger
                                                                    .serialNumber
                                                            }
                                                        </span>
                                                    </Link>
                                                ) : (
                                                    <Badge variant="secondary">
                                                        Stok
                                                    </Badge>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
