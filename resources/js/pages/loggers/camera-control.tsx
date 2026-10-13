import { Camera, Download, Eye, LoaderCircle, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { postJson } from '@/lib/csrf-fetch';
import { sendAtur } from './security-atur-client';
import { errorMessage } from './security-pairing-panel';

interface SnapPhoto {
    id: number;
    url: string | null;
    downloadName: string;
    capturedAt: string | null;
}

// The photo travels in chunks over MQTT, so it shows up some seconds after the request.
const POLL_MS = 3_000;
const WAIT_MS = 90_000;

export type FlashMode = 'AUTO' | 'ON' | 'OFF';

// `short` fits beside the photo button; the list shows the full label.
const FLASH_MODES: { mode: FlashMode; short: string; label: string }[] = [
    { mode: 'AUTO', short: 'Otomatis', label: 'Otomatis (hanya malam)' },
    { mode: 'ON', short: 'Nyala', label: 'Selalu nyala' },
    { mode: 'OFF', short: 'Mati', label: 'Mati' },
];

// The camera's flash for every photo (signed set_flash op). AUTO, the device's
// default, flashes only at night so breach photos after dark are not black.
function FlashModeSelect({
    loggerId,
    flash,
    onDone,
    onError,
}: {
    loggerId: string;
    flash: FlashMode | null;
    onDone: () => void;
    onError: (message: string | null) => void;
}) {
    const [busy, setBusy] = useState<FlashMode | null>(null);
    // Telemetry only arrives once a minute, so after a change the control follows
    // the camera's confirmation until `until`, then falls back to the reported mode.
    const [override, setOverride] = useState<{
        flash: FlashMode;
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

    const current = override ? override.flash : flash;

    async function choose(next: FlashMode) {
        setBusy(next);
        onError(null);
        try {
            await sendAtur(loggerId, 'set_flash', { flash: next });
            setOverride({ flash: next, until: Date.now() + 60_000 });
            onDone();
        } catch (e) {
            onError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(null);
        }
    }

    return (
        <Select
            value={current ?? undefined}
            disabled={busy !== null}
            onValueChange={(value) =>
                value !== current && void choose(value as FlashMode)
            }
        >
            <SelectTrigger
                size="sm"
                aria-label="Mode flash kamera"
                title="Mode flash kamera"
                className="w-auto gap-1.5"
            >
                {busy ? (
                    <LoaderCircle className="size-4 animate-spin" />
                ) : (
                    <Zap className="size-4" />
                )}
                <SelectValue placeholder="Flash">
                    {FLASH_MODES.find((m) => m.mode === current)?.short}
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                {FLASH_MODES.map(({ mode, label }) => (
                    <SelectItem key={mode} value={mode}>
                        {label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

// Takes a photo now (CTRL SNAP) and offers it once it has arrived; also the flash mode.
export function CameraControl({
    loggerId,
    flash,
    onDone,
}: {
    loggerId: string;
    flash: FlashMode | null;
    onDone: () => void;
}) {
    const [busy, setBusy] = useState(false);
    // The newest photo id before the request; set while waiting for the new one.
    const [waitAfter, setWaitAfter] = useState<{
        id: number;
        until: number;
    } | null>(null);
    const [photo, setPhoto] = useState<SnapPhoto | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!waitAfter) return;
        let stopped = false;

        async function check() {
            if (Date.now() > waitAfter!.until) {
                setWaitAfter(null);
                setFailed(true);
                setMessage(
                    'Foto belum masuk. Coba lagi, atau lihat nanti di halaman status.',
                );
                return;
            }
            try {
                const response = await fetch(
                    `/loggers/${loggerId}/security/photo?after=${waitAfter!.id}`,
                    { headers: { Accept: 'application/json' } },
                );
                if (stopped || !response.ok) return;
                const data = (await response.json()) as {
                    photo: SnapPhoto | null;
                };
                if (data.photo && !stopped) {
                    setPhoto(data.photo);
                    setWaitAfter(null);
                    setMessage(null);
                }
            } catch {
                // Try again on the next tick.
            }
        }

        const interval = setInterval(() => void check(), POLL_MS);
        return () => {
            stopped = true;
            clearInterval(interval);
        };
    }, [loggerId, waitAfter]);

    async function snap() {
        setBusy(true);
        setMessage(null);
        try {
            const response = await postJson(
                `/loggers/${loggerId}/security/snap`,
                {},
            );
            if (!response.ok) {
                setFailed(true);
                setMessage(await errorMessage(response));
                return;
            }
            const data = (await response.json()) as { afterId: number };
            setFailed(false);
            setWaitAfter({ id: data.afterId, until: Date.now() + WAIT_MS });
        } finally {
            setBusy(false);
        }
    }

    const waiting = waitAfter !== null;

    return (
        <div className="space-y-4 rounded-md border border-border/60 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
                <Camera className="size-4" /> Kamera
            </p>

            <div className="flex flex-wrap items-center gap-2">
                <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={busy || waiting}
                    onClick={() => void snap()}
                >
                    {busy || waiting ? (
                        <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                        <Camera className="size-4" />
                    )}
                    {waiting ? 'Menunggu foto…' : 'Ambil foto sekarang'}
                </Button>
                <FlashModeSelect
                    loggerId={loggerId}
                    flash={flash}
                    onDone={onDone}
                    onError={(text) => {
                        setFailed(text !== null);
                        setMessage(text);
                    }}
                />
            </div>

            {photo?.url && (
                <div className="flex flex-wrap gap-2">
                    <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                    >
                        <a href={photo.url} target="_blank" rel="noreferrer">
                            <Eye className="size-4" /> Lihat
                        </a>
                    </Button>
                    <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                    >
                        <a href={photo.url} download={photo.downloadName}>
                            <Download className="size-4" /> Unduh
                        </a>
                    </Button>
                </div>
            )}

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
