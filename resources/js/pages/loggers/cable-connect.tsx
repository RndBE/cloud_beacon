import { Bluetooth, Cable, LoaderCircle, Usb, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { bluetoothSupported, usbSupported } from '@/lib/security-setup-link';
import type { Via } from './security-channel';

// Switches the configurator between the internet and a USB cable / Bluetooth link.
export function CableConnect({
    via,
    busy,
    onConnect,
    onDisconnect,
}: {
    via: Via;
    busy: boolean;
    onConnect: (kind: 'usb' | 'bluetooth') => void;
    onDisconnect: () => void;
}) {
    if (via !== 'internet') {
        return (
            <Badge variant="outline" className="h-8 gap-1.5 pr-1">
                {via === 'usb' ? (
                    <Usb className="size-3.5" />
                ) : (
                    <Bluetooth className="size-3.5" />
                )}
                Lewat {via === 'usb' ? 'USB' : 'Bluetooth'}
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

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label="Atur lewat kabel USB atau Bluetooth"
                    title="Atur lewat kabel USB atau Bluetooth"
                    disabled={busy}
                >
                    {busy ? (
                        <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                        <Cable className="size-4" />
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem
                    disabled={!usbSupported()}
                    onSelect={() => onConnect('usb')}
                >
                    <Usb /> Lewat kabel USB
                </DropdownMenuItem>
                <DropdownMenuItem
                    disabled={!bluetoothSupported()}
                    onSelect={() => onConnect('bluetooth')}
                >
                    <Bluetooth /> Lewat Bluetooth
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
