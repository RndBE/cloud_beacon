import { LoaderCircle, Usb, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usbSupported } from '@/lib/security-setup-link';
import type { Via } from './security-channel';

// Switches the configurator between the internet and a USB cable to the board.
export function CableConnect({
    via,
    busy,
    onConnect,
    onDisconnect,
}: {
    via: Via;
    busy: boolean;
    onConnect: () => void;
    onDisconnect: () => void;
}) {
    if (via !== 'internet') {
        return (
            <Badge variant="outline" className="h-8 gap-1.5 pr-1">
                <Usb className="size-3.5" />
                Lewat USB
                <Button
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    aria-label="Putuskan sambungan kabel"
                    title="Putuskan, kembali lewat internet"
                    onClick={onDisconnect}
                >
                    <X className="size-3.5" />
                </Button>
            </Badge>
        );
    }

    const supported = usbSupported();
    return (
        <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Atur lewat kabel USB"
            title={
                supported
                    ? 'Atur lewat kabel USB'
                    : 'Kabel USB butuh Chrome atau Edge di komputer'
            }
            disabled={busy || !supported}
            onClick={onConnect}
        >
            {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
            ) : (
                <Usb className="size-4" />
            )}
        </Button>
    );
}
