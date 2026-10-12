import { CreditCard, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { sendAtur } from './security-atur-client';
import type { AturResult } from './security-atur-client';
import { errorMessage } from './security-pairing-panel';

type Busy = null | 'load' | 'tap' | 'add' | string; // string = UID being removed

const TAP_SECONDS = 15;

export function SecurityCardsPanel({
    loggerId,
    deviceId,
    password,
}: {
    loggerId: string;
    deviceId: string;
    // Typed once in the configurator; only ever used to sign in this browser.
    password: string;
}) {
    const [cards, setCards] = useState<string[] | null>(null);
    const [maxCards, setMaxCards] = useState<number | null>(null);
    const [uid, setUid] = useState('');
    const [confirmUid, setConfirmUid] = useState<string | null>(null);
    const [busy, setBusy] = useState<Busy>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const base = `/loggers/${loggerId}/security/cards`;

    async function load() {
        setBusy('load');
        setError(null);
        try {
            const response = await fetch(base, {
                headers: { Accept: 'application/json' },
            });
            if (!response.ok) {
                setError(await errorMessage(response));
                return;
            }
            const data = (await response.json()) as {
                cards: string[];
                maxCards: number | null;
            };
            setCards(data.cards);
            setMaxCards(data.maxCards);
        } finally {
            setBusy(null);
        }
    }

    async function atur(
        op: 'kartu_tambah' | 'kartu_hapus',
        a: string,
        state: Busy,
    ): Promise<AturResult | null> {
        setBusy(state);
        setError(null);
        setNotice(null);
        try {
            const tap = op === 'kartu_tambah' && a === '';
            const result = await sendAtur(loggerId, password, op, a, tap);
            await load();
            return result;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return null;
        } finally {
            setBusy(null);
        }
    }

    async function addByTap() {
        const result = await atur('kartu_tambah', '', 'tap');
        if (result) setNotice(`Kartu ${result.uid ?? ''} ditambahkan.`);
    }

    async function addByUid(e: FormEvent) {
        e.preventDefault();
        if (uid.trim() === '') return;
        const result = await atur('kartu_tambah', uid.trim(), 'add');
        if (result) {
            setNotice(`Kartu ${result.uid ?? uid.trim()} ditambahkan.`);
            setUid('');
        }
    }

    async function remove(card: string) {
        setConfirmUid(null);
        const result = await atur('kartu_hapus', card, card);
        if (result) setNotice(`Kartu ${result.uid ?? card} dihapus.`);
    }

    if (cards === null) {
        return (
            <div className="flex flex-col items-start gap-2 rounded-md border border-border/60 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold">
                    <CreditCard className="size-4" /> Kartu akses
                </p>
                <p className="text-xs text-muted-foreground">
                    Daftar kartu dibaca langsung dari alat {deviceId}.
                </p>
                <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={busy !== null}
                    onClick={() => void load()}
                >
                    {busy === 'load' ? (
                        <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                        <CreditCard className="size-4" />
                    )}
                    Tampilkan kartu
                </Button>
                {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
        );
    }

    return (
        <div className="space-y-4 rounded-md border border-border/60 p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="flex items-center gap-2 text-sm font-semibold">
                        <CreditCard className="size-4" /> Kartu akses
                        <span className="font-normal text-muted-foreground">
                            {cards.length}
                            {maxCards ? ` / ${maxCards}` : ''}
                        </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                        Kartu terdaftar bisa menonaktifkan alarm dan membuka
                        pintu tanpa memicu sirine.
                    </p>
                </div>
                <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    disabled={busy !== null}
                    onClick={() => void load()}
                >
                    {busy === 'load' ? (
                        <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                        <RefreshCw className="size-4" />
                    )}
                    Muat ulang
                </Button>
            </div>

            {busy === 'tap' ? (
                <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-3 text-sm">
                    <LoaderCircle className="size-4 animate-spin text-primary" />
                    Tempelkan kartu BARU ke pembaca alat {deviceId} dalam{' '}
                    {TAP_SECONDS} detik…
                </div>
            ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={busy !== null}
                        onClick={() => void addByTap()}
                    >
                        <CreditCard className="size-4" /> Tambah lewat tap
                    </Button>
                    <span className="text-xs text-muted-foreground sm:pb-2">
                        atau
                    </span>
                    <form
                        onSubmit={addByUid}
                        className="flex flex-1 gap-2 sm:max-w-sm"
                    >
                        <Input
                            value={uid}
                            onChange={(e) => setUid(e.target.value)}
                            placeholder="UID, mis. 04:A1:B2:C3"
                            className="h-8 font-mono"
                            autoComplete="off"
                        />
                        <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={busy !== null || uid.trim() === ''}
                        >
                            {busy === 'add' ? (
                                <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                                <Plus className="size-4" />
                            )}
                            Tambah UID
                        </Button>
                    </form>
                </div>
            )}

            {notice && (
                <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                    {notice}
                </p>
            )}
            {error && (
                <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                    {error}
                </p>
            )}

            {cards.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    Belum ada kartu terdaftar.
                </p>
            ) : (
                <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                    {cards.map((card) => (
                        <li
                            key={card}
                            className="flex items-center justify-between gap-2 px-3 py-1.5"
                        >
                            <span className="font-mono text-sm">{card}</span>
                            {confirmUid === card ? (
                                <span className="flex items-center gap-1">
                                    <span className="text-xs text-muted-foreground">
                                        Hapus kartu ini?
                                    </span>
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        onClick={() => void remove(card)}
                                    >
                                        Hapus
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setConfirmUid(null)}
                                    >
                                        Batal
                                    </Button>
                                </span>
                            ) : (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-muted-foreground"
                                    disabled={busy !== null}
                                    onClick={() => setConfirmUid(card)}
                                >
                                    {busy === card ? (
                                        <LoaderCircle className="size-4 animate-spin" />
                                    ) : (
                                        'Hapus'
                                    )}
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
