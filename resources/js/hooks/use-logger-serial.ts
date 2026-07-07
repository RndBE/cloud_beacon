import { useCallback, useEffect, useRef, useState } from 'react';

// Firmware belum mendokumentasikan terminator baris untuk command JSON via UART —
// "\n" adalah default aman untuk parser JSON per-baris di embedded UART. Ganti di sini
// kalau firmware ternyata butuh "\r\n".
const COMMAND_TERMINATOR = '\n';

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

type JsonRecord = Record<string, unknown>;

type PendingWaiter = {
    key: string;
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

            for (const waiter of [...waitersRef.current]) {
                if (Object.prototype.hasOwnProperty.call(parsed, waiter.key)) {
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
                appendLog('error', error instanceof Error ? error.message : 'Gagal membaca dari port serial.');
            }
        },
        [appendLog, handleLine],
    );

    const disconnect = useCallback(async () => {
        for (const waiter of [...waitersRef.current]) {
            waitersRef.current.delete(waiter);
            waiter.reject(new Error('Koneksi ditutup.'));
        }

        try {
            readerRef.current?.releaseLock();
        } catch {
            /* noop */
        }
        try {
            await readerRef.current?.cancel();
        } catch {
            /* noop */
        }
        try {
            writerRef.current?.releaseLock();
        } catch {
            /* noop */
        }
        try {
            await writableClosedRef.current;
        } catch {
            /* noop */
        }
        try {
            await readableClosedRef.current;
        } catch {
            /* noop */
        }
        try {
            await portRef.current?.close();
        } catch {
            /* noop */
        }

        portRef.current = null;
        readerRef.current = null;
        writerRef.current = null;
        bufferRef.current = '';
        setConnected(false);
        setPortInfo(null);
    }, []);

    const connect = useCallback(async () => {
        if (!isWebSerialSupported()) {
            throw new Error('Web Serial API tidak didukung browser ini.');
        }

        const port = await navigator.serial.requestPort();
        await port.open(SERIAL_OPTIONS);

        if (!port.readable || !port.writable) {
            throw new Error('Port serial tidak menyediakan stream baca/tulis.');
        }

        const textDecoder = new TextDecoderStream();
        readableClosedRef.current = port.readable.pipeTo(textDecoder.writable).catch(() => undefined);
        const reader = textDecoder.readable.getReader();

        const textEncoder = new TextEncoderStream();
        writableClosedRef.current = textEncoder.readable.pipeTo(port.writable).catch(() => undefined);
        const writer = textEncoder.writable.getWriter();

        portRef.current = port;
        readerRef.current = reader;
        writerRef.current = writer;
        bufferRef.current = '';

        setConnected(true);
        setPortInfo(port.getInfo());
        appendLog('info', 'Terhubung ke logger via USB.');

        void pump(reader);
    }, [appendLog, pump]);

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

    const sendCommand = useCallback(
        (payload: JsonRecord, expectedKey: string, timeoutMs = 12000): Promise<JsonRecord> => {
            return new Promise<JsonRecord>((resolve, reject) => {
                const timer = setTimeout(() => {
                    waitersRef.current.delete(waiter);
                    reject(new Error('Tidak ada respons dari logger (timeout).'));
                }, timeoutMs);

                const waiter: PendingWaiter = {
                    key: expectedKey,
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

    useEffect(() => {
        return () => {
            void disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { connected, portInfo, log, connect, disconnect, sendCommand };
}
