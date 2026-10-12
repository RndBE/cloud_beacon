import { postJson } from '@/lib/csrf-fetch';
import { signAtur } from '@/lib/security-atur';
import { errorMessage } from './security-pairing-panel';

export interface AturResult {
    op: string;
    message: string;
    uid: string | null;
    // sirine_nyala: seconds until the device silences the siren itself.
    maxSeconds: number | null;
    // sirine_nyala: the siren was already sounding for a breach; nothing changed.
    breach: boolean;
}

/**
 * One signed "atur" command to the device installed on a logger: fetch a fresh
 * challenge (the nonce is single-use and lives 60 s), sign it in the browser with
 * the device password, and relay it. Throws an Error with a message for the user
 * when anything along the way fails or the device rejects the command.
 */
export async function sendAtur(
    loggerId: string,
    password: string,
    op: string,
    a = '',
    tap = false,
): Promise<AturResult> {
    if (password === '') throw new Error('Isi password alat dulu.');

    const base = `/loggers/${loggerId}/security/cards`;
    const challenge = await postJson(`${base}/challenge`, {});
    if (!challenge.ok) throw new Error(await errorMessage(challenge));
    const { salt, nonce } = (await challenge.json()) as {
        salt: string;
        nonce: string;
    };

    const signed = await signAtur(salt, nonce, password, op, a);
    const response = await postJson(`${base}/set`, { ...signed, tap });
    if (!response.ok) throw new Error(await errorMessage(response));

    const result = (await response.json()) as AturResult & { ok: boolean };
    if (!result.ok) {
        // An empty op means the device could not verify the signature.
        throw new Error(
            result.op === ''
                ? 'Password alat salah. Setelah 5 kali salah, alat menolak perubahan selama 10 menit.'
                : `Ditolak alat: ${result.message}${result.uid ? ` (${result.uid})` : ''}.`,
        );
    }
    return result;
}
