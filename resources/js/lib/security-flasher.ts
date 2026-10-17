import { ESPLoader, Transport } from 'esptool-js';
import { describeSerialError } from '@/hooks/use-logger-serial';

/**
 * Flashes a Security System board over USB from the browser (Web Serial + esptool-js),
 * so production needs no PlatformIO: the factory image (bootloader, partition table
 * and app merged from address 0) goes onto a blank board in one write.
 */

// WCH USB-serial chips on both boards: CH343 (main board, bench) and CH340.
const WCH_VENDOR_ID = 0x1a86;
const FLASH_BAUD = 460800;

export type FlashTarget = 'main' | 'camera';

// The chip each board must be (esptool-js CHIP_NAME), so a camera image never lands
// on the main board or the other way round.
const EXPECTED_CHIP: Record<FlashTarget, string> = {
    main: 'ESP32-S3',
    camera: 'ESP32',
};

export interface FlashProgress {
    stage: 'download' | 'connect' | 'write' | 'done';
    // 0..1 while writing.
    fraction?: number;
    chip?: string;
}

/** Resolves to false when the user closes the port picker. */
export async function flashFactoryImage(
    target: FlashTarget,
    imageUrl: string,
    onProgress: (progress: FlashProgress) => void,
    onLog: (line: string) => void,
): Promise<boolean> {
    onProgress({ stage: 'download' });
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(
            `File firmware tidak bisa diunduh (HTTP ${response.status}).`,
        );
    }
    const image = new Uint8Array(await response.arrayBuffer());

    let port: SerialPort;
    try {
        port = await navigator.serial.requestPort({
            filters: [{ usbVendorId: WCH_VENDOR_ID }],
        });
    } catch (error) {
        if (
            error instanceof DOMException &&
            (error.name === 'NotFoundError' || error.name === 'AbortError')
        ) {
            return false;
        }
        throw new Error(describeSerialError(error, 'Gagal membuka port USB.'));
    }

    // esptool-js types the port with the w3c-web-serial typings; it is the same object.
    const transport = new Transport(
        port as unknown as ConstructorParameters<typeof Transport>[0],
    );
    let line = '';
    const loader = new ESPLoader({
        transport,
        baudrate: FLASH_BAUD,
        terminal: {
            clean: () => undefined,
            write: (data) => {
                line += data;
            },
            writeLine: (data) => {
                onLog(line + data);
                line = '';
            },
        },
    });

    try {
        onProgress({ stage: 'connect' });
        // Resets the board into its ROM bootloader (DTR/RTS) and identifies the chip.
        const chip = await loader.main();
        if (loader.chip.CHIP_NAME !== EXPECTED_CHIP[target]) {
            throw new Error(
                `Port ini tersambung ke ${chip}, bukan ${target === 'main' ? 'papan utama ESP32-S3' : 'kamera ESP32'}. Pilih port yang benar.`,
            );
        }
        onProgress({ stage: 'write', fraction: 0, chip });
        await loader.writeFlash({
            fileArray: [{ data: image, address: 0x0 }],
            flashMode: 'keep',
            flashFreq: 'keep',
            flashSize: 'keep',
            eraseAll: false,
            compress: true,
            reportProgress: (_index, written, total) =>
                onProgress({
                    stage: 'write',
                    fraction: total ? written / total : 0,
                    chip,
                }),
        });
        // Back into the new firmware.
        await loader.after('hard_reset');
        onProgress({ stage: 'done', fraction: 1, chip });
        return true;
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('Port ini')) {
            throw error;
        }
        throw new Error(
            `Gagal memasang firmware: ${error instanceof Error ? error.message : String(error)}. Pastikan kabel tersambung dan port tidak dipakai aplikasi lain, lalu coba lagi.`,
        );
    } finally {
        try {
            await transport.disconnect();
        } catch {
            /* noop */
        }
    }
}
