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

function isDomException(error: unknown): error is DOMException {
    return typeof DOMException !== 'undefined' && error instanceof DOMException;
}

// Menutup dialog pemilih port bukan kegagalan — Chrome menolak requestPort()
// dengan NotFoundError ("No port selected by the user.") saat operator menekan
// Cancel, jadi kasus ini harus dibedakan dari error nyata.
function isPortPickerCancelled(error: unknown): boolean {
    if (isDomException(error)) {
        return error.name === 'NotFoundError' || error.name === 'AbortError';
    }
    return error instanceof Error && /no port selected/i.test(error.message);
}

// Web Serial melempar DOMException dengan pesan internal berbahasa Inggris —
// mis. "Failed to execute 'requestPort' on 'Serial': No port selected by the
// user." Pesan itu sebelumnya tampil apa adanya di UI operator (dan terpotong
// jadi "Failed to execute" di kolom sempit). Terjemahkan kasus yang dikenali,
// dan jangan pernah menampilkan teks "Failed to execute …" mentah.
export function describeSerialError(
    error: unknown,
    fallback = 'Gagal terhubung ke logger.',
): string {
    const name = isDomException(error) ? error.name : '';
    const raw = error instanceof Error ? error.message : '';

    if (name === 'NotFoundError' || /no port selected/i.test(raw)) {
        return 'Tidak ada port USB yang dipilih.';
    }
    if (name === 'InvalidStateError' || /already open/i.test(raw)) {
        return 'Port USB ini sudah terbuka. Putuskan koneksi lama lalu coba lagi.';
    }
    if (
        name === 'NetworkError' ||
        /failed to open serial port|device has been lost/i.test(raw)
    ) {
        return 'Port USB gagal dibuka. Pastikan kabel masih tercolok dan port tidak sedang dipakai aplikasi lain (mis. Arduino IDE atau serial monitor).';
    }
    if (name === 'SecurityError' || name === 'NotAllowedError') {
        return 'Browser menolak akses port USB. Buka halaman ini lewat HTTPS atau localhost, lalu izinkan akses port serial.';
    }
    // DOMException lain masih membawa teks "Failed to execute …" yang tidak
    // berarti apa-apa bagi operator.
    if (raw === '' || /^failed to execute/i.test(raw)) return fallback;
    return raw;
}

export function useLoggerSerial() {
    const [connected, setConnected] = useState(false);
    const [portInfo, setPortInfo] = useState<SerialPortInfo | null>(null);

    const portRef = useRef<SerialPort | null>(null);
    const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
    const writerRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
    const readableClosedRef = useRef<Promise<void> | null>(null);
    const writableClosedRef = useRef<Promise<void> | null>(null);
    const bufferRef = useRef('');
    const waitersRef = useRef<Set<PendingWaiter>>(new Set());
    const listenersRef = useRef<Set<SerialListener>>(new Set());
    const closingRef = useRef(false);

    const handleLine = useCallback((line: string) => {
        const trimmed = line.replace(/\r$/, '').trim();
        if (!trimmed) return;

        let parsed: JsonRecord | null = null;
        try {
            const decoded: unknown = JSON.parse(trimmed);
            if (
                decoded &&
                typeof decoded === 'object' &&
                !Array.isArray(decoded)
            ) {
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
    }, []);

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
            } catch {
                // A pending read() rejecting during an intentional disconnect
                // (e.g. "Releasing Default reader") is expected — don't surface it.
            }
        },
        [handleLine],
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
        async (port: SerialPort) => {
            if (portRef.current) return; // already connected — avoid double-open
            await port.open(SERIAL_OPTIONS);

            if (!port.readable || !port.writable) {
                throw new Error(
                    'Port serial tidak menyediakan stream baca/tulis.',
                );
            }

            const textDecoder = new TextDecoderStream();
            readableClosedRef.current = port.readable
                .pipeTo(
                    textDecoder.writable as unknown as WritableStream<Uint8Array>,
                )
                .catch(() => undefined);
            const reader = textDecoder.readable.getReader();

            const textEncoder = new TextEncoderStream();
            writableClosedRef.current = (
                textEncoder.readable as unknown as ReadableStream<Uint8Array>
            )
                .pipeTo(port.writable as unknown as WritableStream<Uint8Array>)
                .catch(() => undefined);
            const writer = textEncoder.writable.getWriter();

            portRef.current = port;
            readerRef.current = reader;
            writerRef.current = writer;
            bufferRef.current = '';

            setConnected(true);
            setPortInfo(port.getInfo());

            void pump(reader);
        },
        [pump],
    );

    // Resolve ke false bila operator menutup dialog pemilih port — itu batal,
    // bukan gagal, jadi pemanggil tidak boleh menampilkan pesan error.
    const connect = useCallback(async (): Promise<boolean> => {
        if (!isWebSerialSupported()) {
            throw new Error('Web Serial API tidak didukung browser ini.');
        }

        let port: SerialPort;
        try {
            port = await navigator.serial.requestPort();
        } catch (error) {
            if (isPortPickerCancelled(error)) return false;
            throw new Error(describeSerialError(error));
        }

        try {
            await openPort(port);
        } catch (error) {
            // port.open() bisa sudah berhasil sebelum langkah berikutnya gagal —
            // lepaskan portnya supaya percobaan berikutnya tidak kena
            // "already open".
            try {
                await port.close();
            } catch {
                /* noop */
            }
            throw new Error(describeSerialError(error));
        }
        return true;
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
            await openPort(port);
            return true;
        } catch {
            return false;
        }
    }, [openPort]);

    const sendRaw = useCallback(async (payload: JsonRecord) => {
        if (!writerRef.current) {
            throw new Error('Belum terhubung ke logger.');
        }
        const text = JSON.stringify(payload);
        await writerRef.current.write(text + COMMAND_TERMINATOR);
    }, []);

    // Resolve on the first incoming message that satisfies `match`. Some commands
    // (e.g. PRODUCTION) stream several intermediate messages before the final one,
    // so callers can wait for the specific terminal message instead of the first.
    const sendCommandUntil = useCallback(
        (
            payload: JsonRecord,
            match: (message: JsonRecord) => boolean,
            timeoutMs = 12000,
        ): Promise<JsonRecord> => {
            return new Promise<JsonRecord>((resolve, reject) => {
                const timer = setTimeout(() => {
                    waitersRef.current.delete(waiter);
                    reject(
                        new Error('Tidak ada respons dari logger (timeout).'),
                    );
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
                    // Kabel dicabut saat menulis melempar DOMException mentah —
                    // terjemahkan seperti jalur connect().
                    reject(
                        new Error(
                            describeSerialError(
                                error,
                                'Gagal mengirim perintah.',
                            ),
                        ),
                    );
                });
            });
        },
        [sendRaw],
    );

    const sendCommand = useCallback(
        (
            payload: JsonRecord,
            expectedKey: string,
            timeoutMs = 12000,
        ): Promise<JsonRecord> => {
            return sendCommandUntil(
                payload,
                (message) =>
                    Object.prototype.hasOwnProperty.call(message, expectedKey),
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

    return {
        connected,
        portInfo,
        connect,
        tryReconnect,
        disconnect,
        sendCommand,
        sendCommandUntil,
        subscribe,
    };
}
