import {
    CreditCard,
    LoaderCircle,
    Pencil,
    Plus,
    RefreshCw,
} from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { postJson } from '@/lib/csrf-fetch';
import { sendAtur } from './security-atur-client';
import type { AturResult } from './security-atur-client';
import { errorMessage } from './security-pairing-panel';

interface Card {
    uid: string;
    // Kept on the server per device; the device itself only knows the UID.
    name: string | null;
}

type Busy = null | 'load' | 'tap' | 'add' | string; // string = UID being changed

const TAP_SECONDS = 15;

// Same rule as SecurityCard::normalizeUid: 4 or 7 bytes, the device stores at most 7.
function validUid(uid: string): boolean {
    return /^(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{14})$/.test(
        uid.replace(/[:\s-]/g, ''),
    );
}

export function SecurityCardsPanel({
    loggerId,
    deviceId,
}: {
    loggerId: string;
    deviceId: string;
}) {
    const [cards, setCards] = useState<Card[] | null>(null);
    const [maxCards, setMaxCards] = useState<number | null>(null);
    const [holder, setHolder] = useState('');
    const [uid, setUid] = useState('');
    const [confirmUid, setConfirmUid] = useState<string | null>(null);
    const [editing, setEditing] = useState<{
        uid: string;
        name: string;
    } | null>(null);
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
                cards: Card[];
                maxCards: number | null;
            };
            setCards(data.cards);
            setMaxCards(data.maxCards);
        } finally {
            setBusy(null);
        }
    }

    async function saveHolder(cardUid: string, name: string): Promise<boolean> {
        const response = await postJson(`${base}/holder`, {
            uid: cardUid,
            name,
        });
        if (!response.ok) {
            setError(await errorMessage(response));
            return false;
        }
        return true;
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
            return await sendAtur(loggerId, op, { uid: a });
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return null;
        } finally {
            setBusy(null);
        }
    }

    // The holder name is required up front and saved once the device has confirmed
    // the card (by tap, the UID is only known from the device's reply).
    async function add(cardUid: string) {
        const name = holder.trim();
        if (name === '') {
            setError('Isi nama pemegang kartu dulu.');
            return;
        }
        if (cardUid !== '' && !validUid(cardUid)) {
            setError('UID kartu harus 4 atau 7 byte, mis. 04:A1:B2:C3.');
            return;
        }
        const result = await atur(
            'kartu_tambah',
            cardUid,
            cardUid === '' ? 'tap' : 'add',
        );
        if (!result) return;

        const added = result.uid ?? cardUid;
        if (await saveHolder(added, name)) {
            setNotice(`Kartu ${added} milik ${name} ditambahkan.`);
            setHolder('');
            setUid('');
        }
        await load();
    }

    function addByUid(e: FormEvent) {
        e.preventDefault();
        if (uid.trim() !== '') void add(uid.trim());
    }

    async function rename(e: FormEvent) {
        e.preventDefault();
        if (!editing || editing.name.trim() === '') return;
        setBusy(editing.uid);
        setError(null);
        try {
            if (await saveHolder(editing.uid, editing.name.trim())) {
                setEditing(null);
                await load();
            }
        } finally {
            setBusy(null);
        }
    }

    async function remove(card: Card) {
        setConfirmUid(null);
        const result = await atur('kartu_hapus', card.uid, card.uid);
        if (result) {
            setNotice(
                `Kartu ${card.name ? `milik ${card.name} ` : ''}(${card.uid}) dihapus.`,
            );
            await load();
        }
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
                    Tempelkan kartu BARU milik {holder.trim()} ke pembaca alat{' '}
                    {deviceId} dalam {TAP_SECONDS} detik…
                </div>
            ) : (
                <div className="space-y-2 rounded-md bg-muted/40 p-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="security-card-holder">
                            Nama pemegang kartu baru
                        </Label>
                        <Input
                            id="security-card-holder"
                            value={holder}
                            onChange={(e) => setHolder(e.target.value)}
                            placeholder="mis. Budi Santoso"
                            maxLength={100}
                            className="h-8 max-w-sm"
                            autoComplete="off"
                        />
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Button
                            size="sm"
                            className="gap-1.5"
                            disabled={busy !== null || holder.trim() === ''}
                            onClick={() => void add('')}
                        >
                            <CreditCard className="size-4" /> Tambah lewat tap
                        </Button>
                        <span className="text-xs text-muted-foreground">
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
                                disabled={
                                    busy !== null ||
                                    holder.trim() === '' ||
                                    uid.trim() === ''
                                }
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
                            key={card.uid}
                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5"
                        >
                            {editing?.uid === card.uid ? (
                                <form
                                    onSubmit={rename}
                                    className="flex flex-1 items-center gap-2"
                                >
                                    <Input
                                        value={editing.name}
                                        onChange={(e) =>
                                            setEditing({
                                                uid: card.uid,
                                                name: e.target.value,
                                            })
                                        }
                                        placeholder="Nama pemegang"
                                        maxLength={100}
                                        className="h-8 max-w-xs"
                                        autoFocus
                                    />
                                    <Button
                                        type="submit"
                                        size="sm"
                                        disabled={
                                            busy !== null ||
                                            editing.name.trim() === ''
                                        }
                                    >
                                        Simpan
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setEditing(null)}
                                    >
                                        Batal
                                    </Button>
                                </form>
                            ) : (
                                <span className="flex min-w-0 items-baseline gap-2">
                                    {card.name ? (
                                        <span className="text-sm font-medium">
                                            {card.name}
                                        </span>
                                    ) : (
                                        <span className="text-sm text-amber-600">
                                            Belum bernama
                                        </span>
                                    )}
                                    <span className="font-mono text-xs text-muted-foreground">
                                        {card.uid}
                                    </span>
                                </span>
                            )}

                            {editing?.uid !== card.uid &&
                                (confirmUid === card.uid ? (
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
                                    <span className="flex items-center gap-1">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="gap-1.5 text-muted-foreground"
                                            disabled={busy !== null}
                                            onClick={() =>
                                                setEditing({
                                                    uid: card.uid,
                                                    name: card.name ?? '',
                                                })
                                            }
                                        >
                                            <Pencil className="size-3.5" />
                                            {card.name
                                                ? 'Ubah nama'
                                                : 'Beri nama'}
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-muted-foreground"
                                            disabled={busy !== null}
                                            onClick={() =>
                                                setConfirmUid(card.uid)
                                            }
                                        >
                                            {busy === card.uid ? (
                                                <LoaderCircle className="size-4 animate-spin" />
                                            ) : (
                                                'Hapus'
                                            )}
                                        </Button>
                                    </span>
                                ))}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
