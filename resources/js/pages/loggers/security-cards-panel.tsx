import {
    CreditCard,
    LoaderCircle,
    Pencil,
    Plus,
    RefreshCw,
    Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { postJson } from '@/lib/csrf-fetch';
import type { AturResult } from './security-atur-client';
import { useSecurityChannel } from './security-channel';
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
    const channel = useSecurityChannel();
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
    // The add form stays hidden until asked for; by tap unless the UID is typed.
    const [adding, setAdding] = useState<null | 'tap' | 'uid'>(null);

    useEffect(() => {
        if (!notice) return;
        const timeout = setTimeout(() => setNotice(null), 6_000);
        return () => clearTimeout(timeout);
    }, [notice]);

    const base = `/loggers/${loggerId}/security/cards`;

    async function load() {
        setBusy('load');
        setError(null);
        try {
            const data = await channel.cards();
            setCards(data.cards);
            setMaxCards(data.maxCards);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
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
            return await channel.atur(op, { uid: a });
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
            setAdding(null);
        }
        await load();
    }

    function submitAdd(e: FormEvent) {
        e.preventDefault();
        void add(adding === 'uid' ? uid.trim() : '');
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

    const spinner = <LoaderCircle className="size-4 animate-spin" />;

    if (cards === null) {
        return (
            <div className="space-y-2 rounded-md border border-border/60 p-4">
                <div className="flex items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                        <CreditCard className="size-4" /> Kartu akses
                    </p>
                    <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={busy !== null}
                        onClick={() => void load()}
                    >
                        {busy === 'load' ? (
                            spinner
                        ) : (
                            <CreditCard className="size-4" />
                        )}
                        Tampilkan kartu
                    </Button>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
        );
    }

    return (
        <div className="space-y-3 rounded-md border border-border/60 p-4">
            <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                    <CreditCard className="size-4" /> Kartu akses
                    <span className="font-normal text-muted-foreground">
                        {cards.length}
                        {maxCards ? ` / ${maxCards}` : ''}
                    </span>
                </p>
                <div className="flex items-center gap-1">
                    {adding === null && (
                        <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={busy !== null}
                            onClick={() => {
                                setError(null);
                                setAdding('tap');
                            }}
                        >
                            <Plus className="size-4" /> Tambah kartu
                        </Button>
                    )}
                    <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label="Muat ulang kartu"
                        title="Muat ulang kartu"
                        disabled={busy !== null}
                        onClick={() => void load()}
                    >
                        {busy === 'load' ? (
                            spinner
                        ) : (
                            <RefreshCw className="size-4" />
                        )}
                    </Button>
                </div>
            </div>

            {busy === 'tap' ? (
                <p className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
                    <LoaderCircle className="size-4 animate-spin text-primary" />
                    Tempelkan kartu baru milik {holder.trim()} ke alat{' '}
                    {deviceId} dalam {TAP_SECONDS} detik…
                </p>
            ) : (
                adding !== null && (
                    <form
                        onSubmit={submitAdd}
                        className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2"
                    >
                        <Input
                            aria-label="Nama pemegang kartu"
                            value={holder}
                            onChange={(e) => setHolder(e.target.value)}
                            placeholder="Nama pemegang"
                            maxLength={100}
                            className="h-8 w-48"
                            autoComplete="off"
                            autoFocus
                        />
                        {adding === 'uid' && (
                            <Input
                                aria-label="UID kartu"
                                value={uid}
                                onChange={(e) => setUid(e.target.value)}
                                placeholder="UID, mis. 04:A1:B2:C3"
                                className="h-8 w-48 font-mono"
                                autoComplete="off"
                            />
                        )}
                        <Button
                            type="submit"
                            size="sm"
                            className="gap-1.5"
                            disabled={
                                busy !== null ||
                                holder.trim() === '' ||
                                (adding === 'uid' && uid.trim() === '')
                            }
                        >
                            {busy === 'add' ? (
                                spinner
                            ) : (
                                <CreditCard className="size-4" />
                            )}
                            {adding === 'tap' ? 'Tempel kartu' : 'Simpan'}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                setAdding(null);
                                setError(null);
                            }}
                        >
                            Batal
                        </Button>
                        <button
                            type="button"
                            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                            onClick={() =>
                                setAdding(adding === 'tap' ? 'uid' : 'tap')
                            }
                        >
                            {adding === 'tap' ? 'Ketik UID' : 'Pakai tap'}
                        </button>
                    </form>
                )
            )}

            {notice && (
                <p className="text-sm text-emerald-700 dark:text-emerald-300">
                    {notice}
                </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}

            {cards.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    Belum ada kartu terdaftar.
                </p>
            ) : (
                <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                    {cards.map((card) => (
                        <li
                            key={card.uid}
                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-1"
                        >
                            {editing?.uid === card.uid ? (
                                <form
                                    onSubmit={rename}
                                    className="flex flex-1 items-center gap-2 py-0.5"
                                >
                                    <Input
                                        aria-label="Nama pemegang kartu"
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
                                    <span className="flex items-center">
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="size-8 text-muted-foreground"
                                            aria-label={
                                                card.name
                                                    ? 'Ubah nama'
                                                    : 'Beri nama'
                                            }
                                            title={
                                                card.name
                                                    ? 'Ubah nama'
                                                    : 'Beri nama'
                                            }
                                            disabled={busy !== null}
                                            onClick={() =>
                                                setEditing({
                                                    uid: card.uid,
                                                    name: card.name ?? '',
                                                })
                                            }
                                        >
                                            <Pencil className="size-3.5" />
                                        </Button>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="size-8 text-muted-foreground hover:text-destructive"
                                            aria-label="Hapus kartu"
                                            title="Hapus kartu"
                                            disabled={busy !== null}
                                            onClick={() =>
                                                setConfirmUid(card.uid)
                                            }
                                        >
                                            {busy === card.uid ? (
                                                spinner
                                            ) : (
                                                <Trash2 className="size-3.5" />
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
