import { Activity, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { postJson } from '@/lib/csrf-fetch';
import { errorMessage } from './security-pairing-panel';

// Connection test (CTRL PING): does the device answer right now, and how fast.
export function PingButton({
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

    async function ping() {
        setBusy(true);
        setError(null);
        try {
            const response = await postJson(
                `/loggers/${loggerId}/security/ping`,
                {},
            );
            if (!response.ok) {
                setError(await errorMessage(response));
                return;
            }
            const data = (await response.json()) as { milliseconds: number };
            onDone(
                `Alat ${deviceId} menjawab dalam ${(data.milliseconds / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} detik.`,
            );
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="flex flex-col items-end gap-1">
            <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground"
                disabled={busy}
                onClick={() => void ping()}
            >
                {busy ? (
                    <LoaderCircle className="size-4 animate-spin" />
                ) : (
                    <Activity className="size-4" />
                )}
                Tes koneksi
            </Button>
            {error && (
                <p className="max-w-xs text-right text-xs text-destructive">
                    {error}
                </p>
            )}
        </div>
    );
}
