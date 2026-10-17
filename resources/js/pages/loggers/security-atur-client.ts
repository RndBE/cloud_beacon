import { postJson } from '@/lib/csrf-fetch';
import { errorMessage } from './security-pairing-panel';

export interface AturResult {
    op: string;
    message: string;
    uid: string | null;
    // sirine_nyala: seconds until the device silences the siren itself.
    maxSeconds: number | null;
    // sirine_nyala: the siren was already sounding for a breach; nothing changed.
    breach: boolean;
    // The newest event before the command; set_wifi's outcome is an event after it.
    afterEventId: number;
}

export interface AturParams {
    // kartu_tambah / kartu_hapus
    uid?: string;
    // set_sensor: the door sensor's contact.
    mode?: 'NO' | 'NC';
    // set_flash: AUTO (night only), ON or OFF.
    flash?: 'AUTO' | 'ON' | 'OFF';
    // set_wifi
    ssid?: string;
    wifi_password?: string;
}

/**
 * One setting change on the device installed on a logger. The server signs it with
 * the device password (the user never handles it) and relays it. Throws an Error with
 * a message for the user when anything fails or the device rejects the command.
 */
export async function sendAtur(
    loggerId: string,
    op:
        | 'kartu_tambah'
        | 'kartu_hapus'
        | 'sirine_nyala'
        | 'set_sensor'
        | 'set_flash'
        | 'set_wifi'
        | 'restart',
    params: AturParams = {},
): Promise<AturResult> {
    const response = await postJson(`/loggers/${loggerId}/security/command`, {
        op,
        ...params,
    });
    if (!response.ok) throw new Error(await errorMessage(response));

    const result = (await response.json()) as AturResult & { ok: boolean };
    if (!result.ok) {
        throw new Error(
            `Ditolak alat: ${result.message}${result.uid ? ` (${result.uid})` : ''}.`,
        );
    }
    return result;
}
