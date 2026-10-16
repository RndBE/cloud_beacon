import { Link } from '@inertiajs/react';
import { Cctv, Unplug } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { ModuleFirmware, ProductionModule } from './production-modules';
import { SecuritySetupPanel } from './security-setup-panel';

const QC_LABEL: Record<ProductionModule['qcStatus'], string> = {
    passed: 'QC passed',
    pending: 'QC pending',
    failed: 'QC failed',
};

/**
 * The Modul view of the Setup USB page: pick a Security System unit registered in
 * Production › Modul, then flash and set it up over its USB cable.
 */
export function ModuleUsbSetup({
    modules,
    firmwares,
    initialDeviceId,
    loggerConnected,
    onDisconnectLogger,
}: {
    // Security System units only: the other module kinds have nothing to set up.
    modules: ProductionModule[];
    firmwares: Record<string, ModuleFirmware>;
    // From ?device=, e.g. the setup button in Production › Modul.
    initialDeviceId: string | null;
    // The Logger view's port: one browser tab cannot hold the same port twice.
    loggerConnected: boolean;
    onDisconnectLogger: () => void;
}) {
    const [deviceId, setDeviceId] = useState<string | null>(() =>
        modules.some((m) => m.deviceId === initialDeviceId)
            ? initialDeviceId
            : null,
    );
    const selected = modules.find((m) => m.deviceId === deviceId) ?? null;

    return (
        <div className="grid gap-4 lg:grid-cols-[minmax(340px,1fr)_minmax(260px,0.55fr)]">
            <Card className="self-start">
                <CardHeader>
                    <CardTitle className="text-base">
                        Setup modul Security System
                    </CardTitle>
                    <CardDescription>
                        Pasang firmware, isi WiFi, ID dan password alat lewat
                        kabel USB.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {loggerConnected && (
                        <div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between dark:text-amber-200">
                            Port USB masih dipakai tab Logger.
                            <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                                onClick={onDisconnectLogger}
                            >
                                <Unplug className="size-4" /> Putuskan logger
                            </Button>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label htmlFor="module-usb-device">Modul</Label>
                        <Select
                            value={deviceId ?? ''}
                            onValueChange={(value) => setDeviceId(value)}
                        >
                            <SelectTrigger
                                id="module-usb-device"
                                className="w-full"
                            >
                                <SelectValue placeholder="Pilih modul yang dicolok" />
                            </SelectTrigger>
                            <SelectContent>
                                {modules.map((m) => (
                                    <SelectItem
                                        key={m.key}
                                        value={m.deviceId ?? m.serialNumber}
                                    >
                                        <span className="font-mono">
                                            {m.deviceId}
                                        </span>
                                        {m.serialNumber !== m.deviceId && (
                                            <span className="text-muted-foreground">
                                                {' '}
                                                · {m.serialNumber}
                                            </span>
                                        )}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {modules.length === 0 && (
                            <p className="text-xs text-muted-foreground">
                                Belum ada modul Security System. Daftarkan dulu
                                di{' '}
                                <Link
                                    href="/production?view=modul"
                                    className="text-primary hover:underline"
                                >
                                    Production › Modul
                                </Link>
                                .
                            </p>
                        )}
                    </div>

                    {selected?.deviceId && (
                        <SecuritySetupPanel
                            key={selected.deviceId}
                            deviceId={selected.deviceId}
                            serialNumber={selected.serialNumber}
                            firmwares={firmwares}
                        />
                    )}
                </CardContent>
            </Card>

            <Card className="self-start">
                <CardHeader>
                    <CardTitle className="text-base">Modul terdaftar</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {modules.map((m) => (
                        <button
                            key={m.key}
                            type="button"
                            onClick={() => setDeviceId(m.deviceId)}
                            className={`flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50 ${
                                m.deviceId === deviceId
                                    ? 'border-primary/50 bg-muted/50'
                                    : 'border-border/60'
                            }`}
                        >
                            <div className="min-w-0 space-y-0.5">
                                <p className="flex items-center gap-1.5 text-sm font-medium">
                                    <Cctv className="size-3.5" />
                                    <span className="font-mono">
                                        {m.deviceId}
                                    </span>
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                    {QC_LABEL[m.qcStatus]}
                                    {m.logger
                                        ? ` · di ${m.logger.name}`
                                        : ' · stok'}
                                </p>
                            </div>
                            <Badge
                                variant="outline"
                                className={
                                    m.online
                                        ? 'border-emerald-200 text-emerald-600 dark:border-emerald-900'
                                        : 'border-red-200 text-red-600 dark:border-red-900'
                                }
                            >
                                {m.online ? 'Online' : 'Offline'}
                            </Badge>
                        </button>
                    ))}
                    {modules.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                            Belum ada modul.
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
