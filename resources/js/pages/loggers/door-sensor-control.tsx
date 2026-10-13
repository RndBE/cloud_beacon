import { DoorClosed, DoorOpen, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { sendAtur } from './security-atur-client';

type SensorMode = 'NO' | 'NC';

const MODES: { mode: SensorMode; label: string }[] = [
    { mode: 'NO', label: 'NO' },
    { mode: 'NC', label: 'NC' },
];

// The door sensor's contact type (signed set_sensor op). A wrong mode reads a closed
// door as open, so the device answers with how it now reads the door, and the
// installer can check it on the spot.
export function DoorSensorControl({
    loggerId,
    sensor,
    doorOpen,
    onDone,
}: {
    loggerId: string;
    sensor: SensorMode | null;
    doorOpen: boolean | null;
    onDone: () => void;
}) {
    const [busy, setBusy] = useState<SensorMode | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    // Telemetry only arrives once a minute, so after a change the control follows
    // the device's reply until `until`, then falls back to the reported state.
    const [override, setOverride] = useState<{
        sensor: SensorMode;
        doorOpen: boolean | null;
        until: number;
    } | null>(null);

    useEffect(() => {
        if (!override) return;
        const timeout = setTimeout(
            () => setOverride(null),
            Math.max(0, override.until - Date.now()),
        );
        return () => clearTimeout(timeout);
    }, [override]);

    const mode = override ? override.sensor : sensor;
    const open = override ? override.doorOpen : doorOpen;

    async function choose(next: SensorMode) {
        setBusy(next);
        setMessage(null);
        try {
            const result = await sendAtur(loggerId, 'set_sensor', {
                mode: next,
            });
            // "mode sensor NC, pintu terbaca TERTUTUP"
            const read = result.message.match(/TERBUKA|TERTUTUP/)?.[0];
            setOverride({
                sensor: next,
                doorOpen: read ? read === 'TERBUKA' : null,
                until: Date.now() + 60_000,
            });
            setFailed(false);
            setMessage(
                `${result.message.charAt(0).toUpperCase()}${result.message.slice(1)}.`,
            );
            onDone();
        } catch (e) {
            setFailed(true);
            setMessage(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="space-y-4 rounded-md border border-border/60 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
                {open ? (
                    <DoorOpen className="size-4" />
                ) : (
                    <DoorClosed className="size-4" />
                )}
                Sensor pintu
                <Badge
                    variant="outline"
                    className={
                        open
                            ? 'border-amber-200 text-amber-700 dark:border-amber-900 dark:text-amber-300'
                            : ''
                    }
                >
                    {open === true
                        ? 'Pintu terbuka'
                        : open === false
                          ? 'Pintu tertutup'
                          : 'Belum diketahui'}
                </Badge>
            </p>

            <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase">
                    Mode
                </p>
                <div
                    role="radiogroup"
                    aria-label="Mode sensor pintu"
                    className="inline-flex overflow-hidden rounded-md border border-input"
                >
                    {MODES.map(({ mode: value, label }, i) => (
                        <Button
                            key={value}
                            role="radio"
                            aria-checked={mode === value}
                            size="sm"
                            variant={mode === value ? 'secondary' : 'ghost'}
                            className={`gap-1.5 rounded-none ${i > 0 ? 'border-l border-input' : ''}`}
                            disabled={busy !== null}
                            onClick={() => mode !== value && void choose(value)}
                        >
                            {busy === value && (
                                <LoaderCircle className="size-4 animate-spin" />
                            )}
                            {label}
                        </Button>
                    ))}
                </div>
            </div>

            {message && (
                <p
                    className={`text-sm ${failed ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-300'}`}
                >
                    {message}
                </p>
            )}
        </div>
    );
}
