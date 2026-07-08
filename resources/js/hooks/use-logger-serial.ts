import { useCallback, useEffect, useRef, useState } from 'react';

// Firmware mengharapkan command JSON via UART diakhiri CRLF.
const COMMAND_TERMINATOR = '\r\n';

// UART1 115200 8N1 — lihat beacon_logger.md §1 (Arsitektur Komunikasi).
const SERIAL_OPTIONS: SerialOptions = {
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
};

export type SerialLogEntry = {
    id: number;
    direction: 'tx' | 'rx' | 'info' | 'error';
    text: string;
};

export type JsonRecord = Record<string, unknown>;

export type SerialListener = (message: JsonRecord) => void;

type PendingWaiter = {
    match: (message: JsonRecord) => boolean;
    resolve: (value: JsonRecord) => void;
    reject: (reason: Error) => void;
};

export function isWebSerialSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export function useLoggerSerial() {
    const [connected, setConnected] = useState(false);
    const [portInfo, setPortInfo] = useState<SerialPortInfo | null>(null);
    const [log, setLog] = useState<SerialLogEntry[]>([]);

    const logIdRef = useRef(0);
    const portRef = useRef<SerialPort | null>(null);
    const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
    const writerRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
    const readableClosedRef = useRef<Promise<void> | null>(null);
    const writableClosedRef = useRef<Promise<void> | null>(null);
    const bufferRef = useRef('');
    const waitersRef = useRef<Set<PendingWaiter>>(new Set());
    const listenersRef = useRef<Set<SerialListener>>(new Set());
    const closingRef = useRef(false);

    const appendLog = useCallback((direction: SerialLogEntry['direction'], text: string) => {
        logIdRef.current += 1;
        const id = logIdRef.current;
        setLog((prev) => [...prev.slice(-199), { id, direction, text }]);
    }, []);

    const handleLine = useCallback(
        (line: string) => {
            const trimmed = line.replace(/\r$/, '').trim();
            if (!trimmed) return;
            appendLog('rx', trimmed);

            let parsed: JsonRecord | null = null;
            try {
                const decoded: unknown = JSON.parse(trimmed);
                if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
                    parsed = decoded as JsonRecord;
                }
            } catch {
                return;
            }
            if (!parsed) return;

            for (const listener of [...listenersRef.current]) {
                listener(parsed);
            }

            for (const waiter of [...waitersRef.current]) {
                if (waiter.match(parsed)) {
                    waitersRef.current.delete(waiter);
                    waiter.resolve(parsed);
                }
            }
        },
        [appendLog],
    );

    const pump = useCallback(
        async (reader: ReadableStreamDefaultReader<string>) => {
            try {
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (!value) continue;
                    bufferRef.current += value;
                    const lines = bufferRef.current.split('\n');
                    bufferRef.current = lines.pop() ?? '';
                    for (const line of lines) handleLine(line);
                }
            } catch (error) {
                // A pending read() rejecting during an intentional disconnect
                // (e.g. "Releasing Default reader") is expected — don't surface it.
                if (!closingRef.current) {
                    appendLog('error', error instanceof Error ? error.message : 'Gagal membaca dari port serial.');
                }
            }
        },
        [appendLog, handleLine],
    );

    const disconnect = useCallback(async () => {
        closingRef.current = true;

        for (const waiter of [...waitersRef.current]) {
            waitersRef.current.delete(waiter);
            waiter.reject(new Error('Koneksi ditutup.'));
        }

        // Capture handles, then reset UI state IMMEDIATELY. The low-level stream
        // teardown below can be slow or reject on some devices; we must not let
        // that block the page from returning to the disconnected view.
        const reader = readerRef.current;
        const writer = writerRef.current;
        const port = portRef.current;
        const readableClosed = readableClosedRef.current;
        const writableClosed = writableClosedRef.current;

        portRef.current = null;
        readerRef.current = null;
        writerRef.current = null;
        readableClosedRef.current = null;
        writableClosedRef.current = null;
        bufferRef.current = '';
        setConnected(false);
        setPortInfo(null);

        // Best-effort teardown — cancel reader → settle read pipe → close writer
        // → settle write pipe → close port. Each step is isolated so a failure
        // never leaves the UI stuck.
        try {
            await reader?.cancel();
        } catch {
            /* noop */
        }
        try {
            await readableClosed;
        } catch {
            /* noop */
        }
        try {
            await writer?.close();
        } catch {
            /* noop */
        }
        try {
            await writableClosed;
        } catch {
            /* noop */
        }
        try {
            await port?.close();
        } catch {
            /* noop */
        }

        closingRef.current = false;
    }, []);

    const openPort = useCallback(
        async (port: SerialPort, silent: boolean) => {
            if (portRef.current) return; // already connected — avoid double-open
            await port.open(SERIAL_OPTIONS);

            if (!port.readable || !port.writable) {
                throw new Error('Port serial tidak menyediakan stream baca/tulis.');
            }

            const textDecoder = new TextDecoderStream();
            readableClosedRef.current = port.readable
                .pipeTo(textDecoder.writable as unknown as WritableStream<Uint8Array>)
                .catch(() => undefined);
            const reader = textDecoder.readable.getReader();

            const textEncoder = new TextEncoderStream();
            writableClosedRef.current = (textEncoder.readable as unknown as ReadableStream<Uint8Array>)
                .pipeTo(port.writable)
                .catch(() => undefined);
            const writer = textEncoder.writable.getWriter();

            portRef.current = port;
            readerRef.current = reader;
            writerRef.current = writer;
            bufferRef.current = '';

            setConnected(true);
            setPortInfo(port.getInfo());
            appendLog('info', silent ? 'Tersambung ulang ke logger via USB.' : 'Terhubung ke logger via USB.');

            void pump(reader);
        },
        [appendLog, pump],
    );

    const connect = useCallback(async () => {
        if (!isWebSerialSupported()) {
            throw new Error('Web Serial API tidak didukung browser ini.');
        }

        const port = await navigator.serial.requestPort();
        await openPort(port, false);
    }, [openPort]);

    // Reopen a previously-authorized port after a page reload, without the
    // port-picker dialog. Browser remembers granted ports via getPorts().
    // Returns true if a port was reopened. AUTH still has to be re-entered
    // (PIN is intentionally never persisted).
    const tryReconnect = useCallback(async (): Promise<boolean> => {
        if (!isWebSerialSupported()) return false;
        try {
            const ports = await navigator.serial.getPorts();
            const port = ports[0];
            if (!port) return false;
            await openPort(port, true);
            return true;
        } catch {
            return false;
        }
    }, [openPort]);

    const sendRaw = useCallback(
        async (payload: JsonRecord) => {
            if (!writerRef.current) {
                throw new Error('Belum terhubung ke logger.');
            }
            const text = JSON.stringify(payload);
            appendLog('tx', text);
            await writerRef.current.write(text + COMMAND_TERMINATOR);
        },
        [appendLog],
    );

    // Resolve on the first incoming message that satisfies `match`. Some commands
    // (e.g. PRODUCTION) stream several intermediate messages before the final one,
    // so callers can wait for the specific terminal message instead of the first.
    const sendCommandUntil = useCallback(
        (payload: JsonRecord, match: (message: JsonRecord) => boolean, timeoutMs = 12000): Promise<JsonRecord> => {
            return new Promise<JsonRecord>((resolve, reject) => {
                const timer = setTimeout(() => {
                    waitersRef.current.delete(waiter);
                    reject(new Error('Tidak ada respons dari logger (timeout).'));
                }, timeoutMs);

                const waiter: PendingWaiter = {
                    match,
                    resolve: (value) => {
                        clearTimeout(timer);
                        resolve(value);
                    },
                    reject: (error) => {
                        clearTimeout(timer);
                        reject(error);
                    },
                };

                waitersRef.current.add(waiter);
                sendRaw(payload).catch((error: unknown) => {
                    waitersRef.current.delete(waiter);
                    clearTimeout(timer);
                    reject(error instanceof Error ? error : new Error('Gagal mengirim perintah.'));
                });
            });
        },
        [sendRaw],
    );

    const sendCommand = useCallback(
        (payload: JsonRecord, expectedKey: string, timeoutMs = 12000): Promise<JsonRecord> => {
            return sendCommandUntil(
                payload,
                (message) => Object.prototype.hasOwnProperty.call(message, expectedKey),
                timeoutMs,
            );
        },
        [sendCommandUntil],
    );

    // Observe every incoming JSON message (e.g. to render provisioning progress).
    // Returns an unsubscribe function.
    const subscribe = useCallback((listener: SerialListener): (() => void) => {
        listenersRef.current.add(listener);
        return () => {
            listenersRef.current.delete(listener);
        };
    }, []);

    useEffect(() => {
        return () => {
            void disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { connected, portInfo, log, connect, tryReconnect, disconnect, sendCommand, sendCommandUntil, subscribe };
}
