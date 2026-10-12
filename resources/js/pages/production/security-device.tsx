import { Head, Link } from '@inertiajs/react';
import { ArrowLeft, Cctv } from 'lucide-react';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';
import { SecurityDeviceStatus } from './security-device-status';

interface Props {
    deviceId: string;
    name: string | null;
    logger: { id: string; name: string; serialNumber: string } | null;
}

export default function SecurityDeviceShow({ deviceId, name, logger }: Props) {
    const breadcrumbs: BreadcrumbItem[] = [
        { title: 'Dashboard', href: '/dashboard' },
        { title: 'Production', href: '/production' },
        { title: 'Security System', href: '/production/security-devices' },
        { title: deviceId, href: `/production/security-devices/${deviceId}` },
    ];

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={`Security System ${deviceId}`} />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                <div className="flex flex-col gap-1">
                    <Link
                        href="/production/security-devices"
                        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="size-4" /> Semua alat
                    </Link>
                    <h1 className="flex items-center gap-2 text-xl font-semibold">
                        <Cctv className="size-5" />
                        <span className="font-mono">{deviceId}</span>
                        {name && (
                            <span className="text-base font-normal text-muted-foreground">
                                {name}
                            </span>
                        )}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {logger ? (
                            <>
                                Dipasang di{' '}
                                <Link
                                    href={`/loggers/${logger.id}`}
                                    className="text-primary hover:underline"
                                >
                                    {logger.name}
                                </Link>{' '}
                                <span className="font-mono text-xs">
                                    {logger.serialNumber}
                                </span>{' '}
                                · konfigurasi (kartu, lepas alat) ada di tab
                                Security Cam logger tersebut.
                            </>
                        ) : (
                            'Unit stok, belum dipasang di logger mana pun.'
                        )}
                    </p>
                </div>

                <SecurityDeviceStatus deviceId={deviceId} />
            </div>
        </AppLayout>
    );
}
