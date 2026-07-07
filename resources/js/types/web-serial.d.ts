export {};

declare global {
    interface SerialPortInfo {
        usbVendorId?: number;
        usbProductId?: number;
    }

    interface SerialOptions {
        baudRate: number;
        dataBits?: 7 | 8;
        stopBits?: 1 | 2;
        parity?: 'none' | 'even' | 'odd';
        bufferSize?: number;
        flowControl?: 'none' | 'hardware';
    }

    interface SerialPortRequestOptions {
        filters?: Array<{ usbVendorId?: number; usbProductId?: number }>;
    }

    interface SerialPort extends EventTarget {
        readonly readable: ReadableStream<Uint8Array> | null;
        readonly writable: WritableStream<Uint8Array> | null;
        open(options: SerialOptions): Promise<void>;
        close(): Promise<void>;
        getInfo(): SerialPortInfo;
    }

    interface Serial extends EventTarget {
        requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
        getPorts(): Promise<SerialPort[]>;
    }

    interface Navigator {
        readonly serial: Serial;
    }
}
