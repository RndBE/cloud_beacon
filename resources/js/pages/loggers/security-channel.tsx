import { createContext, useContext } from 'react';
import { postJson, putJson } from '@/lib/csrf-fetch';
import type { SetupLink } from '@/lib/security-setup-link';
import { sendAtur } from './security-atur-client';
import type { AturParams, AturResult } from './security-atur-client';
import { errorMessage } from './security-pairing-panel';

/**
 * How the Security Cam configurator reaches the device: over the internet (MQTT,
 * through the server) or over a USB cable from this browser, for a device
 * without WiFi. Over a cable the server still signs every change (sign endpoint), so
 * the device password never reaches the browser, and the outcome is still logged.
 */

export type AturOp = Parameters<typeof sendAtur>[1];
export type Via = 'internet' | 'usb';

export interface ChannelCard {
    uid: string;
    name: string | null;
}

export interface CtrlResult {
    message: string;
    // PING: round trip.
    milliseconds?: number;
    // SNAP over the internet: the newest photo id before it, to wait for the new one.
    afterId?: number;
}

export interface SecurityChannel {
    via: Via;
    atur(op: AturOp, params?: AturParams): Promise<AturResult>;
    ctrl(act: 'SIREN_OFF' | 'SNAP' | 'PING'): Promise<CtrlResult>;
    cards(): Promise<{ cards: ChannelCard[]; maxCards: number | null }>;
    ssid(): Promise<string | null>;
}

const capitalize = (text: string) =>
    `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

async function json<T>(response: Response): Promise<T> {
    if (!response.ok) throw new Error(await errorMessage(response));
    return (await response.json()) as T;
}

export function internetChannel(loggerId: string): SecurityChannel {
    const base = `/loggers/${loggerId}/security`;
    const get = <T,>(url: string) =>
        fetch(url, { headers: { Accept: 'application/json' } }).then(json<T>);

    return {
        via: 'internet',
        atur: (op, params) => sendAtur(loggerId, op, params),
        async ctrl(act) {
            if (act === 'PING') {
                return json<CtrlResult>(
                    await postJson(`${base}/ping`, {}),
                ).then((r) => ({ ...r, message: 'pong' }));
            }
            return json<CtrlResult>(
                await postJson(
                    act === 'SNAP' ? `${base}/snap` : `${base}/siren-off`,
                    {},
                ),
            );
        },
        cards: () =>
            get<{ cards: ChannelCard[]; maxCards: number | null }>(
                `${base}/cards`,
            ),
        ssid: () =>
            get<{ ssid: string | null }>(`${base}/wifi`).then((r) => r.ssid),
    };
}

type Reply = Record<string, unknown>;

// Replies the device sends while a request waits: one request at a time, as the
// firmware asks.
interface Waiter {
    match: (reply: Reply) => boolean;
    resolve: (reply: Reply) => void;
    reject: (error: Error) => void;
}

// The device's own rejection of a signed command, as the internet path words it.
function refusal(reply: Reply): string {
    const reason = String(reply.msg ?? '');
    if (reason.includes('password salah')) {
        return 'Alat menolak tanda tangan server: password alat di server tidak cocok. Hubungi admin (alat menolak perubahan 10 menit setelah 5 kali gagal).';
    }
    return `Alat menolak perintah: ${reason || 'autentikasi gagal'}.`;
}

export interface CableProof {
    deviceId: string;
    // With a pairing: its state after the proof (installed).
    pairing?: { id: number; deviceId: string; status: string };
}

export interface CableChannel extends SecurityChannel {
    // Feed every {"SECURITY":...} reply from the link here.
    handle(reply: Reply | string): void;
    // "Bukti kabel": the board proves to the server that it is this logger's device
    // (or, with a pairing, the device being installed, which installs it). Retried
    // while the board is still booting (it reads input ~10 s after a reset).
    prove(pairingId?: number): Promise<CableProof>;
    close(): Promise<void>;
}

export function cableChannel(loggerId: string, link: SetupLink): CableChannel {
    const base = `/loggers/${loggerId}/security`;
    const via = link.kind;
    let waiter: Waiter | null = null;
    let queue: Promise<unknown> = Promise.resolve();

    // Commands go one after another; each waits for its own reply.
    function serial<T>(task: () => Promise<T>): Promise<T> {
        const run = queue.then(task, task);
        queue = run.catch(() => undefined);
        return run;
    }

    function request(
        command: Record<string, string>,
        match: (reply: Reply) => boolean,
        timeoutMs: number,
    ): Promise<Reply> {
        return new Promise<Reply>((resolve, reject) => {
            const timer = setTimeout(() => {
                waiter = null;
                reject(
                    new Error(
                        'Alat tidak menjawab lewat kabel. Pastikan kabel tersambung, lalu coba lagi.',
                    ),
                );
            }, timeoutMs);
            waiter = {
                match,
                resolve: (reply) => {
                    clearTimeout(timer);
                    waiter = null;
                    resolve(reply);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    waiter = null;
                    reject(error);
                },
            };
            link.send({ SECURITY: command }).catch(() =>
                waiter?.reject(
                    new Error('Gagal mengirim ke alat lewat kabel.'),
                ),
            );
        });
    }

    async function get(): Promise<Reply> {
        const reply = await request(
            { cmd: 'GET' },
            (r) => r.cmd === 'GET',
            5_000,
        );
        if (reply.status !== 'OK')
            throw new Error(capitalize(String(reply.msg ?? 'Alat menolak.')));
        return reply;
    }

    async function signedOnce(
        op: AturOp,
        params: AturParams,
    ): Promise<{ reply: Reply; logId: number; afterEventId: number }> {
        const challenge = await request(
            { cmd: 'CHALLENGE' },
            (r) => r.cmd === 'CHALLENGE',
            5_000,
        );
        if (challenge.status !== 'OK') {
            const wait = Number(challenge.sisa ?? 0);
            throw new Error(
                `${capitalize(String(challenge.msg ?? 'Alat menolak tantangan'))}${wait ? ` (coba lagi dalam ${Math.ceil(wait / 60)} menit)` : ''}.`,
            );
        }
        const signed = await json<{
            nonce: string;
            data: string;
            mac: string;
            logId: number;
            afterEventId: number;
        }>(
            await postJson(`${base}/sign`, {
                op,
                ...params,
                salt: String(challenge.salt),
                nonce: String(challenge.nonce),
                via,
            }),
        );
        const tap = op === 'kartu_tambah' && !params.uid;
        let reply: Reply;
        try {
            reply = await request(
                {
                    cmd: 'SET',
                    nonce: signed.nonce,
                    data: signed.data,
                    mac: signed.mac,
                },
                (r) => r.cmd === 'SET' && r.msg !== 'menunggu',
                tap ? 25_000 : 8_000,
            );
        } catch (e) {
            // No reply: the change log would otherwise stay "waiting" for good.
            await report(signed.logId, {
                ok: false,
                message: e instanceof Error ? e.message : String(e),
            });
            throw e;
        }
        return {
            reply,
            logId: signed.logId,
            afterEventId: signed.afterEventId,
        };
    }

    async function report(logId: number, body: Record<string, unknown>) {
        await putJson(`${base}/serial-log/${logId}`, body).catch(
            () => undefined,
        );
    }

    return {
        via,
        handle(reply) {
            if (!waiter) return;
            if (typeof reply === 'string') {
                waiter.reject(new Error(`Alat menolak: ${reply}`));
            } else if (waiter.match(reply)) {
                waiter.resolve(reply);
            }
        },
        close: () => link.close(),
        prove: (pairingId) =>
            serial(async () => {
                const { nonce } = await json<{ nonce: string }>(
                    await postJson(`${base}/cable/nonce`, {
                        pairing: pairingId ?? null,
                    }),
                );
                let reply: Reply | null = null;
                for (let attempt = 0; reply === null; attempt++) {
                    try {
                        reply = await request(
                            { cmd: 'BUKTI', nonce },
                            (r) => r.cmd === 'BUKTI',
                            2_500,
                        );
                    } catch (e) {
                        if (attempt >= 7) throw e;
                    }
                }
                if (reply.status !== 'OK') {
                    const reason = String(reply.msg ?? 'alat menolak');
                    throw new Error(
                        reason.includes('ID alat belum diatur')
                            ? 'ID alat belum diatur. Isi dulu lewat Setup alat di Production › Modul.'
                            : `Alat menolak dibuktikan: ${reason}.`,
                    );
                }
                return json<CableProof>(
                    await postJson(`${base}/cable/proof`, {
                        salt: String(reply.salt ?? ''),
                        mac: String(reply.mac ?? ''),
                        via,
                    }),
                );
            }),
        atur: (op, params = {}) =>
            serial(async () => {
                let attempt = await signedOnce(op, params);
                // One nonce for all paths: a challenge from the server in between voids
                // ours. Take a fresh one once.
                if (
                    attempt.reply.status !== 'OK' &&
                    attempt.reply.op === '' &&
                    /nonce tidak cocok|tidak ada tantangan/.test(
                        String(attempt.reply.msg ?? ''),
                    )
                ) {
                    await report(attempt.logId, {
                        ok: false,
                        message: refusal(attempt.reply),
                    });
                    attempt = await signedOnce(op, params);
                }
                const { reply, logId, afterEventId } = attempt;
                const ok = reply.status === 'OK';
                const message =
                    !ok && reply.op === ''
                        ? refusal(reply)
                        : String(reply.msg ?? '');
                await report(logId, {
                    ok,
                    message,
                    uid: typeof reply.uid === 'string' ? reply.uid : null,
                });
                if (!ok) {
                    throw new Error(
                        reply.op === ''
                            ? message
                            : `Ditolak alat: ${message}${reply.uid ? ` (${String(reply.uid)})` : ''}.`,
                    );
                }
                return {
                    op: String(reply.op ?? op),
                    message,
                    uid: typeof reply.uid === 'string' ? reply.uid : null,
                    maxSeconds:
                        reply.maks_detik !== undefined
                            ? Number(reply.maks_detik)
                            : null,
                    breach: Boolean(reply.pembobolan),
                    afterEventId,
                };
            }),
        ctrl: (act) =>
            serial(async () => {
                const started = performance.now();
                const reply = await request(
                    { cmd: 'CTRL', act },
                    (r) => r.cmd === 'CTRL',
                    5_000,
                );
                const ok = reply.status === 'OK';
                const message = String(reply.msg ?? '');
                if (act !== 'PING') {
                    await postJson(`${base}/serial-log`, {
                        action: act === 'SNAP' ? 'foto' : 'sirine_mati',
                        ok,
                        message,
                        via,
                    }).catch(() => undefined);
                }
                if (!ok)
                    throw new Error(capitalize(message || 'Alat menolak.'));
                return {
                    message: `${capitalize(message)}.`,
                    milliseconds: Math.round(performance.now() - started),
                };
            }),
        cards: () =>
            serial(async () => {
                const reply = await get();
                const { holders } = await json<{
                    holders: Record<string, string | null>;
                }>(
                    await fetch(`${base}/cards/holders`, {
                        headers: { Accept: 'application/json' },
                    }),
                );
                const uids = Array.isArray(reply.kartu_uid)
                    ? (reply.kartu_uid as string[])
                    : [];
                return {
                    cards: uids.map((uid) => ({
                        uid,
                        name: holders[uid] ?? null,
                    })),
                    maxCards:
                        reply.maks_kartu !== undefined
                            ? Number(reply.maks_kartu)
                            : null,
                };
            }),
        ssid: () =>
            serial(async () => {
                const reply = await get();
                return typeof reply.ssid === 'string' && reply.ssid !== ''
                    ? reply.ssid
                    : null;
            }),
    };
}

const SecurityChannelContext = createContext<SecurityChannel | null>(null);

export const SecurityChannelProvider = SecurityChannelContext.Provider;

export function useSecurityChannel(): SecurityChannel {
    const channel = useContext(SecurityChannelContext);
    if (!channel) throw new Error('SecurityChannelProvider is missing.');
    return channel;
}
