import { router } from '@inertiajs/react';
import { Globe2, LoaderCircle, TerminalSquare } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { postJson } from '@/lib/csrf-fetch';

export interface LoggerRemoteDevice {
    id: number;
    name: string;
    webEnabled: boolean;
    webUrl: string | null;
    canSshConnect: boolean;
    canWebConnect: boolean;
}

export function ModuleAiCard({ device }: { device: LoggerRemoteDevice }) {
    const [openingWeb, setOpeningWeb] = useState(false);
    const [webError, setWebError] = useState<string | null>(null);

    async function openWeb() {
        setOpeningWeb(true);
        setWebError(null);

        try {
            const response = await postJson(
                `/cloud-web/${device.id}/session`,
                {},
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = (await response.json()) as { url?: string };
            if (!data.url) throw new Error('URL perangkat tidak tersedia.');

            window.location.assign(data.url);
        } catch (error) {
            setWebError(
                `Gagal membuka web perangkat: ${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            setOpeningWeb(false);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <TerminalSquare className="size-5" />
                    {device.name}
                </CardTitle>
                {device.webEnabled && device.webUrl && (
                    <CardDescription>{device.webUrl}</CardDescription>
                )}
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                    {device.canSshConnect && (
                        <Button
                            onClick={() =>
                                router.visit(`/cloud-ssh/${device.id}/terminal`)
                            }
                        >
                            <TerminalSquare className="mr-1 size-4" />
                            Buka SSH
                        </Button>
                    )}
                    {device.canWebConnect && device.webEnabled && (
                        <Button
                            variant="secondary"
                            disabled={openingWeb}
                            onClick={() => void openWeb()}
                        >
                            {openingWeb ? (
                                <LoaderCircle className="mr-1 size-4 animate-spin" />
                            ) : (
                                <Globe2 className="mr-1 size-4" />
                            )}
                            Buka Web
                        </Button>
                    )}
                </div>
                {webError && (
                    <p className="text-sm text-destructive">{webError}</p>
                )}
            </CardContent>
        </Card>
    );
}
