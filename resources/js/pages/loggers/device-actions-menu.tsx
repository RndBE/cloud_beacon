import {
    Activity,
    LoaderCircle,
    MoreHorizontal,
    RotateCcw,
    Unplug,
} from 'lucide-react';
import { useState } from 'react';
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
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteJson, postJson } from '@/lib/csrf-fetch';
import { sendAtur } from './security-atur-client';
import { errorMessage } from './security-pairing-panel';

/**
 * The installed device's occasional actions, kept out of sight in one menu:
 * connection test (CTRL PING), restart (signed) and unpair. Restart and unpair ask
 * first. Results go to the card through onNotice / onError.
 */
export function DeviceActionsMenu({
    loggerId,
    deviceId,
    onNotice,
    onError,
    onChanged,
}: {
    loggerId: string;
    deviceId: string;
    onNotice: (message: string) => void;
    onError: (message: string | null) => void;
    // The device's state changed (restarted, unpaired): reload the card.
    onChanged: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState<'restart' | 'unpair' | null>(null);

    async function run(action: () => Promise<string | null>) {
        setBusy(true);
        onError(null);
        try {
            const notice = await action();
            if (notice) onNotice(notice);
        } catch (e) {
            onError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    const ping = () =>
        run(async () => {
            const response = await postJson(
                `/loggers/${loggerId}/security/ping`,
                {},
            );
            if (!response.ok) throw new Error(await errorMessage(response));
            const data = (await response.json()) as { milliseconds: number };
            onChanged();
            return `Alat ${deviceId} menjawab dalam ${(data.milliseconds / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} detik.`;
        });

    const restart = () =>
        run(async () => {
            const result = await sendAtur(loggerId, 'restart');
            onChanged();
            return `Alat ${deviceId}: ${result.message}. Online lagi dalam sekitar satu menit.`;
        });

    const unpair = () =>
        run(async () => {
            const response = await deleteJson(
                `/loggers/${loggerId}/security/device`,
            );
            if (!response.ok) throw new Error(await errorMessage(response));
            onChanged();
            return `Alat ${deviceId} dilepas dan kembali menjadi stok.`;
        });

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label="Tindakan alat"
                        title="Tindakan alat"
                        disabled={busy}
                    >
                        {busy ? (
                            <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                            <MoreHorizontal className="size-4" />
                        )}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void ping()}>
                        <Activity /> Tes koneksi
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setConfirm('restart')}>
                        <RotateCcw /> Restart alat
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setConfirm('unpair')}
                    >
                        <Unplug /> Lepas alat
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <AlertDialog
                open={confirm !== null}
                onOpenChange={(open) => !open && setConfirm(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {confirm === 'unpair'
                                ? `Lepas alat ${deviceId}?`
                                : `Restart alat ${deviceId}?`}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirm === 'unpair'
                                ? 'Alat dilepas dari logger ini dan kembali menjadi stok. Untuk memasangnya lagi, teknisi harus menempelkan kartu ke pembacanya.'
                                : 'Alat mati sebentar lalu menyala lagi. Selama itu pintu tidak dijaga dan alat offline sekitar satu menit. Kartu dan setelan tidak hilang.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() =>
                                void (confirm === 'unpair'
                                    ? unpair()
                                    : restart())
                            }
                        >
                            {confirm === 'unpair'
                                ? 'Lepas alat'
                                : 'Restart alat'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
