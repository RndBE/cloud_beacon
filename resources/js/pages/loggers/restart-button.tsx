import { LoaderCircle, RotateCcw } from 'lucide-react';
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
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { sendAtur } from './security-atur-client';

// Restarts the device's board (signed restart op), the first remedy when it misbehaves.
export function RestartButton({
    loggerId,
    deviceId,
    onDone,
}: {
    loggerId: string;
    deviceId: string;
    onDone: (message: string) => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function restart() {
        setBusy(true);
        setError(null);
        try {
            const result = await sendAtur(loggerId, 'restart');
            onDone(
                `Alat ${deviceId}: ${result.message}. Online lagi dalam sekitar satu menit.`,
            );
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="flex flex-col items-end gap-1">
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5 text-muted-foreground"
                        disabled={busy}
                    >
                        {busy ? (
                            <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                            <RotateCcw className="size-4" />
                        )}
                        Restart alat
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Restart alat {deviceId}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Alat mati sebentar lalu menyala lagi. Selama itu
                            pintu tidak dijaga dan alat offline sekitar satu
                            menit. Kartu dan setelan tidak hilang.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void restart()}>
                            Restart alat
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            {error && (
                <p className="max-w-xs text-right text-xs text-destructive">
                    {error}
                </p>
            )}
        </div>
    );
}
