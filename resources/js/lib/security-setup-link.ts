import { describeSerialError } from '@/hooks/use-logger-serial';

/**
 * Talks to a Security System board's console over a USB cable (Web Serial), for
 * first-time setup and configuring a device on site. Commands are one JSON line;
 * replies are the lines carrying {"SETUP":...} among the console's own log and menu
 * output, which is ignored (but handed to onLine for the raw log view).
 */

export type SetupReply = {
    ok: boolean;
    cmd: string;
    msg?: string;
    [key: string]: unknown;
};

export interface SetupLink {
    kind: 'usb';
    send(command: Record<string, unknown>): Promise<void>;
    close(): Promise<void>;
}

export interface SetupLinkHandlers {
    onReply: (reply: SetupReply) => void;
    // Replies to module commands ({"SECURITY":...}), the same as over MQTT. A string
    // is the device refusing a malformed command ("ERR act tidak dikenal: ...").
    onSecurity?: (reply: Record<string, unknown> | string) => void;
    // Every console line, for the raw log.
    onLine: (line: string) => void;
    // The link dropped (cable pulled).
    onClosed: () => void;
}

// WCH USB-serial chips: CH343 on the bench board, CH340 on the PCB.
const WCH_VENDOR_ID = 0x1a86;
const BAUD_RATE = 115200;

const MARKER = '{"SETUP":';
const SECURITY_MARKER = '{"SECURITY":';

export function usbSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
}

// Splits the console stream into lines and picks out the setup replies.
function lineReader(handlers: SetupLinkHandlers): (text: string) => void {
    let buffer = '';
    return (text) => {
        buffer += text;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const raw of lines) {
            const line = raw.replaceAll('\r', '');
            if (line.trim() === '') continue;
            handlers.onLine(line);
            const setupAt = line.indexOf(MARKER);
            const securityAt = line.indexOf(SECURITY_MARKER);
            try {
                if (setupAt >= 0) {
                    const parsed = JSON.parse(line.slice(setupAt)) as {
                        SETUP?: SetupReply;
                    };
                    if (parsed.SETUP) handlers.onReply(parsed.SETUP);
                } else if (securityAt >= 0) {
                    const parsed = JSON.parse(line.slice(securityAt)) as {
                        SECURITY?: Record<string, unknown> | string;
                        msg?: string;
                    };
                    if (typeof parsed.SECURITY === 'string') {
                        handlers.onSecurity?.(
                            parsed.msg
                                ? `${parsed.SECURITY} (${parsed.msg})`
                                : parsed.SECURITY,
                        );
                    } else if (parsed.SECURITY) {
                        handlers.onSecurity?.(parsed.SECURITY);
                    }
                }
            } catch {
                // A reply cut by noise: the next request or poll brings a fresh one.
            }
        }
        // A line without its newline yet should not grow without bound.
        if (buffer.length > 4096) buffer = buffer.slice(-4096);
    };
}

function cancelled(error: unknown): boolean {
    return (
        error instanceof DOMException &&
        (error.name === 'NotFoundError' || error.name === 'AbortError')
    );
}

/** Resolves to null when the user closes the port picker. */
export async function openUsbLink(
    handlers: SetupLinkHandlers,
): Promise<SetupLink | null> {
    let port: SerialPort;
    try {
        port = await navigator.serial.requestPort({
            filters: [{ usbVendorId: WCH_VENDOR_ID }],
        });
    } catch (error) {
        if (cancelled(error)) return null;
        throw new Error(describeSerialError(error, 'Gagal membuka port USB.'));
    }

    try {
        await port.open({ baudRate: BAUD_RATE });
        // RTS is wired to the board's reset: left active it holds the board in reset.
        await port.setSignals({
            dataTerminalReady: false,
            requestToSend: false,
        });
    } catch (error) {
        try {
            await port.close();
        } catch {
            /* noop */
        }
        throw new Error(describeSerialError(error, 'Gagal membuka port USB.'));
    }
    if (!port.readable || !port.writable) {
        await port.close();
        throw new Error('Port USB tidak bisa dibaca atau ditulis.');
    }

    const reader = port.readable.getReader();
    const writer = port.writable.getWriter();
    const feed = lineReader(handlers);
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let closing = false;

    void (async () => {
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) feed(decoder.decode(value, { stream: true }));
            }
        } catch {
            // Cable pulled or port lost.
        }
        if (!closing) handlers.onClosed();
    })();

    return {
        kind: 'usb',
        async send(command) {
            await writer.write(encoder.encode(`${JSON.stringify(command)}\n`));
        },
        async close() {
            closing = true;
            try {
                await reader.cancel();
            } catch {
                /* noop */
            }
            reader.releaseLock();
            writer.releaseLock();
            try {
                await port.close();
            } catch {
                /* noop */
            }
        },
    };
}
